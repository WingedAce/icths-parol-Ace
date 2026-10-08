import { useRef, useState } from "react";

import type {
  PinMapping,
  PinType,
  ProjectNode,
  TricolorGroup,
  Zone,
} from "../types";
import {
  ANALOG_PIN_COUNT,
  ANALOG_PIN_OFFSET,
  formatPin,
  isAnalogPin,
  isPwmPin,
  LED_MAX_PER_PIN,
  LED_PAROL_LIMIT,
  LED_PAROL_WARN,
  LED_WARN_LIMIT,
  groupOfPin,
  ledsInZone,
  parsePin,
  pinLedLoad,
  totalLeds,
} from "../utils/pins";

const SEGMENT_API_URL =
  import.meta.env.VITE_SEGMENT_API_URL ?? "http://localhost:8000/segment";

// Pins the board keeps for itself: 0 and 1 are the serial line (USB), 53 is
// the Mega's SPI select pin.
const RESERVED_PINS = [0, 1, 53];

// The pin selector slides through these pages, 16 or so pins at a time.
// Digital pages and the analog (A0-A15) page are shown depending on the
// Pin Type toggle.
function pinRange(first: number, length: number) {
  return Array.from({ length }, (_, i) => first + i);
}

const DIGITAL_PAGES = [
  { title: "Digital 2–17", pins: pinRange(2, 16) },
  { title: "Digital 18–33", pins: pinRange(18, 16) },
  { title: "Digital 34–52", pins: pinRange(34, 19) },
];

const ANALOG_PAGES = [
  {
    title: `Analog A0–A${ANALOG_PIN_COUNT - 1}`,
    pins: pinRange(ANALOG_PIN_OFFSET, ANALOG_PIN_COUNT),
  },
];

type ZoneMapperProps = {
  node: ProjectNode;
  onZonesReady: (zones: Zone[], imageWidth: number, imageHeight: number) => void;
  onPinMappingsChange: (pinMappings: PinMapping[]) => void;
  onTricolorGroupsChange: (groups: TricolorGroup[]) => void;
  onClearZones: () => void;
};

// Converts the data URL we already have stored on the node back into a
// File, so we can POST it to the segmentation endpoint without asking
// the student to upload anything twice.
async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type });
}

// Default color of a freshly merged tricolor LED in the previews.
const DEFAULT_TRICOLOR = "#ffffff";

// A tiny picture of one zone's shape, cropped to its bounding box. Lets the
// LED list show *which* zone a row is, since the zone ids (58, 133...) mean
// nothing to the person using the app.
function ZoneThumb({ zone }: { zone: Zone }) {
  const xs = zone.polygon.map((p) => p[0]);
  const ys = zone.polygon.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(Math.max(...xs) - minX, 1);
  const h = Math.max(Math.max(...ys) - minY, 1);
  const pad = Math.max(w, h) * 0.15;

  return (
    <svg
      viewBox={`${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`}
      className="h-7 w-7 shrink-0 rounded-md bg-black/60"
      aria-hidden="true"
    >
      <polygon
        points={zone.polygon.map((p) => p.join(",")).join(" ")}
        fill="#e8e4d8"
        fillOpacity={0.9}
      />
    </svg>
  );
}

function clampLeds(n: number) {
  if (!Number.isFinite(n)) return 1;
  return Math.min(LED_MAX_PER_PIN, Math.max(1, Math.round(n)));
}

function ZoneMapper({
  node,
  onZonesReady,
  onPinMappingsChange,
  onTricolorGroupsChange,
  onClearZones,
}: ZoneMapperProps) {
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pinInput, setPinInput] = useState("");
  const [warning, setWarning] = useState("");
  // Non-blocking heads-up (more than 6 LEDs on a pin).
  const [notice, setNotice] = useState("");

  // The zone being pointed at, either in the LED list or on the drawing.
  // Both sides light up together so a row can be matched to its zone.
  const [hoverZone, setHoverZone] = useState<number | null>(null);

  // LED count typed for each selected zone, keyed by zone id. Filled when a
  // zone is clicked (from its saved count, or 1) and saved on "Assign pin".
  const [ledDraft, setLedDraft] = useState<Record<number, number>>({});
  // Pins ticked for merging into one tricolor LED (needs exactly 3).
  const [mergeSel, setMergeSel] = useState<number[]>([]);

  // Which header the next assignment uses: the digital pins (2-52) or the
  // A0-A15 header. D1 and A1 are different pins, so both can be mixed in one
  // project. This is NOT the dimming setting; that is each pin's "Pin type"
  // (Digital or Analog) further down, saved on the pin mappings.
  const [pinHeader, setPinHeader] = useState<"digital" | "a-header">("digital");
  const useAnalog = pinHeader === "a-header";

  // Which page of the sliding pin selector is showing.
  const [pinPage, setPinPage] = useState(0);

  // Zoom/pan so tiny zones in dense designs can be made physically bigger
  // on screen before tapping — the reliable fix for "the shape is correctly
  // detected but too small to tap accurately," which no amount of backend
  // tuning can solve on its own.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // Pin-number labels on top of each colored zone — on by default, but
  // dense designs with many small zones can turn into a wall of numbers,
  // so students can hide them to see the plain colored map underneath.
  // This only hides the text labels; assigned zone colors stay visible.
  const [showPinNumbers, setShowPinNumbers] = useState(true);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const didDrag = useRef(false);

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 6;
  const ZOOM_STEP = 0.6;

  function clampZoom(value: number) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  }

  function zoomIn() {
    setZoom((z) => clampZoom(z + ZOOM_STEP));
  }

  function zoomOut() {
    setZoom((z) => {
      const next = clampZoom(z - ZOOM_STEP);
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
      return next;
    });
  }

  function resetZoom() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (zoom === 1) return;
    // Don't start a pan from the on-screen buttons (Hide Pins, -, %, +).
    if ((event.target as HTMLElement).closest("button")) return;
    setIsPanning(true);
    didDrag.current = false;
    panStart.current = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!isPanning) return;
    const dx = event.clientX - panStart.current.x;
    const dy = event.clientY - panStart.current.y;
    if (!didDrag.current) {
      // Still just a click: wait for a real drag before taking over.
      if (Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return;
      didDrag.current = true;
      // Capture only now, so plain clicks on zones and buttons still work.
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setPan({ x: panStart.current.panX + dx, y: panStart.current.panY + dy });
  }

  function handlePointerUp() {
    setIsPanning(false);
  }

  const zones = node.zones ?? [];
  const pinMappings = node.pinMappings ?? [];
  const zoneToPin = new Map(pinMappings.map((m) => [m.zoneId, m.pin]));
  const tricolorGroups = node.tricolorGroups ?? [];
  // Merged pins take the color of their tricolor group instead of a pin color.
  const zoneToColor = new Map(
    pinMappings.map((m) => [
      m.zoneId,
      groupOfPin(tricolorGroups, m.pin)?.color ?? m.color,
    ]),
  );

  // Saves new pin mappings and drops any tricolor group that lost a pin.
  function commitMappings(next: PinMapping[]) {
    const live = new Set(next.map((m) => m.pin));
    const kept = tricolorGroups.filter((g) => g.pins.every((p) => live.has(p)));
    if (kept.length !== tricolorGroups.length) onTricolorGroupsChange(kept);
    onPinMappingsChange(next);
  }

  async function runSegmentation() {
    if (!node.imageDataUrl) return;
    setIsSegmenting(true);
    setError(null);

    try {
      const file = await dataUrlToFile(node.imageDataUrl, "drawing.png");
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(SEGMENT_API_URL, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? `Segmentation failed (${response.status})`);
      }

      const data = await response.json();
      const parsedZones: Zone[] = data.zones.map(
        (z: { id: string; points: [number, number][]; cx: number; cy: number }) => ({
          id: Number(z.id.replace(/^z/, "")),
          polygon: z.points,
          cx: z.cx,
          cy: z.cy,
        }),
      );

      onZonesReady(parsedZones, data.width, data.height);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not reach the segmentation server. Is it running?",
      );
    } finally {
      setIsSegmenting(false);
    }
  }

  function toggleSelect(zoneId: number) {
    if (didDrag.current) return;
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(zoneId)) next.delete(zoneId);
      else next.add(zoneId);
      return next;
    });
    // Clicking a zone asks how many LEDs are in it: start from the saved
    // count if it already has one.
    setLedDraft((previous) => {
      if (previous[zoneId] !== undefined) return previous;
      const saved = pinMappings.find((m) => m.zoneId === zoneId);
      return { ...previous, [zoneId]: saved ? ledsInZone(saved) : 1 };
    });
    setWarning("");
    setNotice("");
  }

  function setZoneLeds(zoneId: number, value: number) {
    setLedDraft((previous) => ({ ...previous, [zoneId]: clampLeds(value) }));
    setWarning("");
  }

  function setAllLeds(value: number) {
    setLedDraft((previous) => {
      const next = { ...previous };
      selected.forEach((id) => {
        next[id] = clampLeds(value);
      });
      return next;
    });
  }

  function draftOf(zoneId: number) {
    return ledDraft[zoneId] ?? 1;
  }

  function assignPin() {
    if (selected.size === 0) return;

    const pin = parsePin(pinInput, useAnalog);
    if (pin === null) {
      setWarning(
        useAnalog
          ? `Enter an analog pin from A0 to A${ANALOG_PIN_COUNT - 1}.`
          : "Enter a valid pin (2–52 or A0–A15).",
      );
      return;
    }
    if (RESERVED_PINS.includes(pin)) {
      setWarning("Pins 0, 1, and 53 are reserved.");
      return;
    }

    // LED limit: other zones already on this pin + the selected zones.
    const others = pinMappings.filter(
      (m) => m.pin === pin && !selected.has(m.zoneId),
    );
    const otherLeds = others.reduce((sum, m) => sum + ledsInZone(m), 0);
    const newLeds = Array.from(selected).reduce(
      (sum, id) => sum + draftOf(id),
      0,
    );
    const load = otherLeds + newLeds;
    if (load > LED_MAX_PER_PIN) {
      setWarning(
        `Pin ${formatPin(pin)} can hold at most ${LED_MAX_PER_PIN} LEDs, and this would make ${load}. Lower the LED counts or use another pin.`,
      );
      return;
    }

    const withoutSelected = pinMappings.filter((m) => !selected.has(m.zoneId));
    // Zones joining a pin that already exists take on that pin's type.
    const existingType = pinMappings.find(
      (m) => m.pin === pin && m.pinType,
    )?.pinType;
    const added: PinMapping[] = Array.from(selected).map((zoneId) => ({
      zoneId,
      pin,
      ledCount: draftOf(zoneId),
      ...(existingType ? { pinType: existingType } : {}),
    }));

    const nextMappings = [...withoutSelected, ...added];
    const nextTotal = totalLeds(nextMappings, tricolorGroups);

    commitMappings(nextMappings);
    setSelected(new Set());
    setLedDraft({});
    setPinInput("");
    setWarning("");

    const messages: string[] = [];
    if (load > LED_WARN_LIMIT) {
      messages.push(
        `Pin ${formatPin(pin)} now drives ${load} LEDs. More than ${LED_WARN_LIMIT} on one pin can cause problems (dim LEDs, too much current). Consider splitting them across pins.`,
      );
    }
    if (nextTotal > LED_PAROL_LIMIT) {
      messages.push(
        `The parol now has ${nextTotal} LEDs, which is over the ${LED_PAROL_LIMIT} LED limit.`,
      );
    }
    setNotice(messages.length > 0 ? `Warning: ${messages.join(" ")}` : "");
  }

  function clearSelection() {
    setSelected(new Set());
    setLedDraft({});
    setWarning("");
    setNotice("");
  }

  function resetAllPins() {
    const hasPins =
      (node.pinMappings?.length ?? 0) > 0 ||
      (node.tricolorGroups?.length ?? 0) > 0;
    if (
      hasPins &&
      !window.confirm(
        "Reset all pin assignments?\n\n" +
          "This removes the pin, LED color and LED count of every zone, " +
          "and all tricolor merges. The design is shared by all three " +
          "rounds, so Round 1, Round 2 and Round 3 are all affected.\n\n" +
          "The keyframes in each round are kept, but they will not match " +
          "any pin until you assign the pins again.\n\n" +
          "Continue?",
      )
    ) {
      return;
    }

    onPinMappingsChange([]);
    onTricolorGroupsChange([]);
    setSelected(new Set());
    setLedDraft({});
    setMergeSel([]);
    setPinInput("");
    setNotice("");
  }

  // ---- Tricolor merge ----
  function toggleMergePin(pin: number) {
    setMergeSel((previous) =>
      previous.includes(pin)
        ? previous.filter((p) => p !== pin)
        : previous.length >= 3
          ? previous
          : [...previous, pin],
    );
  }

  function mergeTricolor() {
    if (mergeSel.length !== 3) return;
    const pins = [...mergeSel].sort((a, b) => a - b) as [number, number, number];
    // Merged pins share one type so the three channels dim together.
    const type = pinTypeOf(pins[0]);
    onPinMappingsChange(
      pinMappings.map((m) => (pins.includes(m.pin) ? { ...m, pinType: type } : m)),
    );
    onTricolorGroupsChange([
      ...tricolorGroups,
      { id: `tri-${Date.now()}`, pins, color: DEFAULT_TRICOLOR },
    ]);
    setMergeSel([]);
  }

  function unmerge(id: string) {
    onTricolorGroupsChange(tricolorGroups.filter((g) => g.id !== id));
  }

  // Fills the pin box from a saved pin number, switching the Pin Type toggle
  // and the selector page to match.
  function showPinInInput(pin: number) {
    const analog = isAnalogPin(pin);
    const pages = analog ? ANALOG_PAGES : DIGITAL_PAGES;
    setPinHeader(analog ? "a-header" : "digital");
    setPinPage(Math.max(0, pages.findIndex((page) => page.pins.includes(pin))));
    setPinInput(String(analog ? pin - ANALOG_PIN_OFFSET : pin));
    setWarning("");
  }

  function selectPinGroup(pin: number) {
    const ids = pinMappings.filter((m) => m.pin === pin).map((m) => m.zoneId);
    setSelected(new Set(ids));
    setLedDraft(
      Object.fromEntries(
        pinMappings
          .filter((m) => m.pin === pin)
          .map((m) => [m.zoneId, ledsInZone(m)]),
      ),
    );
    showPinInInput(pin);
  }

  function deletePin(pin: number) {
    const ids = new Set(
      pinMappings.filter((m) => m.pin === pin).map((m) => m.zoneId),
    );
    commitMappings(pinMappings.filter((m) => m.pin !== pin));
    setMergeSel((previous) => previous.filter((p) => p !== pin));
    setSelected((previous) => {
      const next = new Set(previous);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setPinInput("");
  }

  function changePinHeader(type: "digital" | "a-header") {
    setPinHeader(type);
    setPinPage(0);
    setWarning("");
  }

  // Typing "A3" works too: the letter switches the toggle and is dropped.
  function handlePinInputChange(raw: string) {
    let text = raw.toUpperCase();
    if (text.startsWith("A")) {
      setPinHeader("a-header");
      setPinPage(0);
      text = text.slice(1);
    } else if (text.startsWith("D")) {
      setPinHeader("digital");
      text = text.slice(1);
    }
    setPinInput(text.replace(/\D/g, ""));
    setWarning("");
  }

  // Digital pins are simply on or off. Analog pins can be dimmed, which the
  // Preview, Gallery and Sequence tabs use for brightness and Fade.
  function pinTypeOf(pin: number): PinType {
    return (
      pinMappings.find((m) => m.pin === pin && m.pinType)?.pinType ?? "digital"
    );
  }

  // ---- No zones yet: show the segmentation trigger ----
  if (zones.length === 0) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-6 text-center">
        <img
          src={node.imageDataUrl}
          alt="Uploaded parol drawing"
          className="max-h-80 rounded-2xl border border-white/10 object-contain"
          style={{ filter: "invert(1) brightness(0.75)" }}
        />

        <button
          onClick={runSegmentation}
          disabled={isSegmenting}
          className="cursor-pointer rounded-xl bg-white px-6 py-3 font-serif text-black transition hover:bg-white/90 disabled:cursor-default disabled:opacity-50"
        >
          {isSegmenting ? "Detecting zones…" : "Detect zones from drawing"}
        </button>

        {error && <p className="max-w-md text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  // ---- Zones exist: the tap-to-select / assign-pin map ----
  const groupedPins = Array.from(new Set(pinMappings.map((m) => m.pin))).sort(
    (a, b) => a - b,
  );

  const imageWidth = node.imageWidth ?? 1;
  const imageHeight = node.imageHeight ?? 1;

  const pinPages = useAnalog ? ANALOG_PAGES : DIGITAL_PAGES;
  const currentPinPage = pinPages[Math.min(pinPage, pinPages.length - 1)];
  const typedPin = parsePin(pinInput, useAnalog);

  // LEDs the typed pin would drive if the selected zones were assigned to it.
  const pendingLoad =
    typedPin !== null && selected.size > 0
      ? pinMappings
          .filter((m) => m.pin === typedPin && !selected.has(m.zoneId))
          .reduce((sum, m) => sum + ledsInZone(m), 0) +
        Array.from(selected).reduce((sum, id) => sum + draftOf(id), 0)
      : null;

  const mergedPinSet = new Set(tricolorGroups.flatMap((g) => g.pins));

  // ---- LED budget for the whole parol ----
  const currentTotal = totalLeds(pinMappings, tricolorGroups);
  // What the total becomes if the selected zones are assigned now. With a
  // valid pin typed this is exact (tricolor pins count 3x); without one it's
  // the plain difference in LEDs.
  const projectedTotal =
    selected.size === 0
      ? currentTotal
      : typedPin !== null
        ? totalLeds(
            [
              ...pinMappings.filter((m) => !selected.has(m.zoneId)),
              ...Array.from(selected).map((zoneId) => ({
                zoneId,
                pin: typedPin,
                ledCount: draftOf(zoneId),
              })),
            ],
            tricolorGroups,
          )
        : currentTotal +
          Array.from(selected).reduce((sum, id) => sum + draftOf(id), 0) -
          pinMappings
            .filter((m) => selected.has(m.zoneId))
            .reduce((sum, m) => sum + ledsInZone(m), 0);
  const shownTotal = Math.max(currentTotal, projectedTotal);
  const budgetState =
    shownTotal > LED_PAROL_LIMIT
      ? "over"
      : shownTotal >= LED_PAROL_WARN
        ? "near"
        : "ok";

  // Selected zones in the order they were clicked. Their position here is
  // the number shown on the drawing and in the LED list (1, 2, 3...).
  const selectedList = Array.from(selected);
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  // Any zone whose bounding-box diagonal is under ~3% of the drawing's
  // overall size gets an invisible, larger "assist" circle centered on it,
  // so a near-miss tap close to a tiny shape still resolves correctly.
  // Drawn *underneath* the real zone polygons, so it never steals a click
  // that was clearly meant for a bigger neighboring zone.
  const assistRadius = Math.max(imageWidth, imageHeight) * 0.015;
  const tinyZoneThreshold = Math.max(imageWidth, imageHeight) * 0.03;

  // Pin-number labels scale with the drawing's own resolution instead of a
  // fixed size — a fixed size looked fine on a 480px-wide test drawing but
  // was nearly invisible on a 2048px one, since the SVG viewBox units are
  // the drawing's own pixel space.
  const pinFontSize = Math.max(20, Math.max(imageWidth, imageHeight) * 0.024);
  const pinStrokeWidth = pinFontSize * 0.22;

  function boundingDiagonal(polygon: [number, number][]) {
    const xs = polygon.map((p) => p[0]);
    const ys = polygon.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    return Math.sqrt(w * w + h * h);
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 lg:flex-row lg:items-start">
      {/* Left: the parol drawing itself */}
      <div className="flex w-full flex-col items-center gap-4 lg:max-w-xl lg:flex-1">
        <div
          className="relative w-full touch-none select-none overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0b]"
          style={{
            aspectRatio: `${imageWidth} / ${imageHeight}`,
            cursor: zoom > 1 ? (isPanning ? "grabbing" : "grab") : "default",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <div
            className="absolute inset-0 h-full w-full"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: isPanning ? "none" : "transform 0.15s ease-out",
            }}
          >
            <img
              src={node.imageDataUrl}
              alt="Uploaded parol drawing"
              className="absolute inset-0 h-full w-full object-fill"
              style={{ filter: "invert(1) brightness(0.75)" }}
            />
            <svg
              viewBox={`0 0 ${imageWidth} ${imageHeight}`}
              className="absolute inset-0 h-full w-full"
            >
              {zones.map((zone) => {
                const pin = zoneToPin.get(zone.id);
                const isSelected = selected.has(zone.id);
                const assignedColor = zoneToColor.get(zone.id);
                const fill = isSelected
                  ? "#e8e4d8"
                  : pin !== undefined
                    ? (assignedColor ?? "#2f6f4f")
                    : "transparent";
                const fillOpacity = isSelected
                  ? 0.45
                  : pin !== undefined
                    ? assignedColor
                      ? 0.75
                      : 0.4
                    : 0;

                const isHot = isSelected && hoverZone === zone.id;

                return (
                  <g key={zone.id}>
                    <polygon
                      points={zone.polygon.map((p) => p.join(",")).join(" ")}
                      fill={isHot ? "#ffffff" : fill}
                      fillOpacity={isHot ? 0.85 : fillOpacity}
                      stroke={isHot ? "#ffffff" : "none"}
                      strokeWidth={pinStrokeWidth}
                      className="cursor-pointer"
                      onClick={() => toggleSelect(zone.id)}
                      onMouseEnter={() => setHoverZone(zone.id)}
                      onMouseLeave={() => setHoverZone(null)}
                    />
                    {showPinNumbers && pin !== undefined && !isSelected && (
                      <text
                        x={zone.cx}
                        y={zone.cy}
                        fontSize={pinFontSize}
                        fontWeight={700}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#fff"
                        stroke="#000"
                        strokeWidth={pinStrokeWidth}
                        paintOrder="stroke"
                        style={{ pointerEvents: "none" }}
                      >
                        {formatPin(pin)}
                      </text>
                    )}
                  </g>
                );
              })}
              {/* Numbered markers on the selected zones. The number matches
                  the row in "LEDs in each zone". */}
              {selectedList.map((zoneId, index) => {
                const zone = zoneById.get(zoneId);
                if (!zone) return null;
                const hot = hoverZone === zoneId;

                // Keep the marker small enough that the zone's shape still
                // shows: it shrinks with the zone (never below a readable
                // minimum, never above the max).
                const zxs = zone.polygon.map((pt) => pt[0]);
                const zys = zone.polygon.map((pt) => pt[1]);
                const zoneSpan = Math.min(
                  Math.max(...zxs) - Math.min(...zxs),
                  Math.max(...zys) - Math.min(...zys),
                );
                const markerR = Math.min(
                  pinFontSize * 0.52,
                  Math.max(pinFontSize * 0.3, zoneSpan * 0.26),
                );

                return (
                  <g key={`marker-${zoneId}`} style={{ pointerEvents: "none" }}>
                    <circle
                      cx={zone.cx}
                      cy={zone.cy}
                      r={markerR}
                      fill={hot ? "#ffffff" : "#e8e4d8"}
                      fillOpacity={0.92}
                      stroke="#000"
                      strokeWidth={pinStrokeWidth * 0.4}
                    />
                    <text
                      x={zone.cx}
                      y={zone.cy}
                      fontSize={markerR * 1.15}
                      fontWeight={700}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#000"
                    >
                      {index + 1}
                    </text>
                  </g>
                );
              })}

              {/* Assist circles drawn LAST (on top in SVG draw order) so a tap
                  near a tiny zone's center always wins the hit-test, even when
                  a larger neighboring zone's polygon also covers that same
                  pixel. Drawing these first (as before) meant the bigger
                  zone's polygon, being on top, silently ate the click instead —
                  that was the actual cause of "tapped the small symbol, the
                  whole big shape got selected instead." */}
              {zones.map((zone) => {
                if (boundingDiagonal(zone.polygon) >= tinyZoneThreshold) return null;
                return (
                  <circle
                    key={`assist-${zone.id}`}
                    cx={zone.cx}
                    cy={zone.cy}
                    r={assistRadius}
                    fill="transparent"
                    className="cursor-pointer"
                    onClick={() => toggleSelect(zone.id)}
                    onMouseEnter={() => setHoverZone(zone.id)}
                    onMouseLeave={() => setHoverZone(null)}
                  />
                );
              })}
            </svg>
          </div>

          <div className="absolute bottom-3 left-3 rounded-full border border-white/10 bg-black/70 p-1 backdrop-blur">
            <button
              onClick={() => setShowPinNumbers((v) => !v)}
              className="cursor-pointer rounded-full px-3 py-1 text-[11px] uppercase tracking-wider text-white/70 hover:text-white"
            >
              {showPinNumbers ? "Hide Pins" : "Show Pins"}
            </button>
          </div>

          <div className="absolute bottom-3 right-3 flex gap-1 rounded-full border border-white/10 bg-black/70 p-1 backdrop-blur">
            <button
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              className="cursor-pointer rounded-full px-3 py-1 text-sm text-white/70 hover:text-white disabled:cursor-default disabled:opacity-30"
            >
              −
            </button>
            <button
              onClick={resetZoom}
              disabled={zoom === 1}
              className="cursor-pointer rounded-full px-2 py-1 text-[10px] uppercase tracking-wider text-white/50 hover:text-white disabled:cursor-default disabled:opacity-30"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              className="cursor-pointer rounded-full px-3 py-1 text-sm text-white/70 hover:text-white disabled:cursor-default disabled:opacity-30"
            >
              +
            </button>
          </div>
        </div>

        <p className="text-center text-[11px] text-white/25">
          Zoom in for dense areas, then drag to pan around before tapping a tiny zone.
        </p>
      </div>

      {/* Divider — vertical on desktop (side by side), horizontal on mobile
          (stacked), separating the drawing from the pin-assignment panel. */}
      <div className="h-px w-full bg-white/10 lg:h-auto lg:w-px lg:self-stretch" />

      {/* Right: zone selection and pin assignment. Pin type and LED color live in the Pins tab. */}
      <div className="flex w-full flex-col gap-6 lg:flex-1">
        <div>
          {/* Pin controls */}
          <div className="flex min-w-0 flex-col gap-5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-white/30">
                Selection
              </p>
              <p className="mt-2 font-serif text-2xl font-light">
                {selected.size} zone{selected.size === 1 ? "" : "s"} selected
              </p>
              <p className="mt-1 text-[11px] text-white/30">
                Total pins assigned: {groupedPins.length}
              </p>
            </div>

            {/* LED budget: how many LEDs the parol has so far */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <p className="text-[10px] uppercase tracking-[0.25em] text-white/30">
                  LEDs in the parol
                </p>
                <p className="font-serif text-sm text-white/80">
                  <b
                    className={
                      budgetState === "over"
                        ? "text-red-400"
                        : budgetState === "near"
                          ? "text-amber-300"
                          : "text-white"
                    }
                  >
                    {currentTotal}
                  </b>{" "}
                  / {LED_PAROL_LIMIT}
                </p>
              </div>

              <div
                className="relative h-2 w-full overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={LED_PAROL_LIMIT}
                aria-valuenow={currentTotal}
                aria-label="LEDs used out of the limit"
              >
                {/* What this selection would add, shown lighter underneath */}
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-white/25"
                  style={{
                    width: `${Math.min(100, (projectedTotal / LED_PAROL_LIMIT) * 100)}%`,
                  }}
                />
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-all ${
                    budgetState === "over"
                      ? "bg-red-400"
                      : budgetState === "near"
                        ? "bg-amber-300"
                        : "bg-white/70"
                  }`}
                  style={{
                    width: `${Math.min(100, (currentTotal / LED_PAROL_LIMIT) * 100)}%`,
                  }}
                />
              </div>

              <p
                className={`mt-2 text-[11px] ${
                  budgetState === "over"
                    ? "text-red-400"
                    : budgetState === "near"
                      ? "text-amber-300/80"
                      : "text-white/35"
                }`}
              >
                {selected.size > 0 && projectedTotal !== currentTotal
                  ? `Assigning this selection makes it ${projectedTotal} LEDs. `
                  : ""}
                {budgetState === "over"
                  ? `Over the ${LED_PAROL_LIMIT} LED limit by ${shownTotal - LED_PAROL_LIMIT}. Remove some LEDs before building.`
                  : budgetState === "near"
                    ? `Close to the ${LED_PAROL_LIMIT} LED limit — ${LED_PAROL_LIMIT - shownTotal} left.`
                    : `${LED_PAROL_LIMIT - shownTotal} LEDs left before the ${LED_PAROL_LIMIT} LED limit.`}
              </p>
            </div>

            {/* LED count for every selected zone */}
            {selected.size > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-white/30">
                    LEDs in each zone
                  </p>
                  {selected.size > 1 && (
                    <label className="flex items-center gap-2 text-[11px] text-white/40">
                      Set all
                      <input
                        type="number"
                        min={1}
                        max={LED_MAX_PER_PIN}
                        placeholder="–"
                        onChange={(e) => {
                          if (e.target.value !== "") setAllLeds(Number(e.target.value));
                        }}
                        className="w-14 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-center text-white outline-none focus:border-white/30"
                      />
                    </label>
                  )}
                </div>
                <p className="mb-2 text-[11px] text-white/30">
                  Each number matches the marker on the drawing. Point at a
                  row to light up its zone.
                </p>
                <div className="flex max-h-60 flex-col gap-1.5 overflow-y-auto pr-1">
                  {selectedList.map((zoneId, index) => {
                    const zone = zoneById.get(zoneId);
                    const currentPin = zoneToPin.get(zoneId);
                    const isHot = hoverZone === zoneId;
                    const n = index + 1;
                    return (
                      <div
                        key={zoneId}
                        onMouseEnter={() => setHoverZone(zoneId)}
                        onMouseLeave={() => setHoverZone(null)}
                        className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 transition ${
                          isHot
                            ? "bg-white/[0.12] ring-1 ring-white/30"
                            : "bg-white/[0.03]"
                        }`}
                      >
                        <div
                          className="flex min-w-0 items-center gap-2.5"
                          title={`Zone ${zoneId}`}
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e8e4d8] text-[10px] font-semibold text-black">
                            {n}
                          </span>
                          {zone && <ZoneThumb zone={zone} />}
                          <span className="truncate text-xs text-white/50">
                            {currentPin !== undefined
                              ? `On pin ${formatPin(currentPin)}`
                              : "No pin yet"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setZoneLeds(zoneId, draftOf(zoneId) - 1)}
                            disabled={draftOf(zoneId) <= 1}
                            aria-label={`Fewer LEDs in zone ${n}`}
                            className="h-7 w-7 cursor-pointer rounded-full border border-white/10 text-white/60 hover:text-white disabled:cursor-default disabled:opacity-30"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={LED_MAX_PER_PIN}
                            value={draftOf(zoneId)}
                            onChange={(e) => setZoneLeds(zoneId, Number(e.target.value))}
                            aria-label={`LEDs in zone ${n}`}
                            className="w-12 rounded-lg border border-white/10 bg-white/[0.03] py-1 text-center text-white outline-none focus:border-white/30"
                          />
                          <button
                            onClick={() => setZoneLeds(zoneId, draftOf(zoneId) + 1)}
                            disabled={draftOf(zoneId) >= LED_MAX_PER_PIN}
                            aria-label={`More LEDs in zone ${n}`}
                            className="h-7 w-7 cursor-pointer rounded-full border border-white/10 text-white/60 hover:text-white disabled:cursor-default disabled:opacity-30"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {pendingLoad !== null && (
                  <p
                    className={`mt-2 text-[11px] ${
                      pendingLoad > LED_MAX_PER_PIN
                        ? "text-red-400"
                        : pendingLoad > LED_WARN_LIMIT
                          ? "text-amber-300/80"
                          : "text-white/40"
                    }`}
                  >
                    Pin {formatPin(typedPin as number)} would drive {pendingLoad} LED
                    {pendingLoad === 1 ? "" : "s"}
                    {pendingLoad > LED_MAX_PER_PIN
                      ? ` — over the ${LED_MAX_PER_PIN} LED limit, it can't be assigned.`
                      : pendingLoad > LED_WARN_LIMIT
                        ? ` — more than ${LED_WARN_LIMIT} on one pin can cause problems.`
                        : "."}
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-white/30">
                Pin Header
              </label>
              <div className="mb-4 flex gap-2">
                {(
                  [
                    { id: "digital", label: "Digital" },
                    { id: "a-header", label: `A0–A${ANALOG_PIN_COUNT - 1}` },
                  ] as const
                ).map((option) => {
                  const active = pinHeader === option.id;
                  return (
                    <button
                      key={option.id}
                      onClick={() => changePinHeader(option.id)}
                      aria-pressed={active}
                      className={`cursor-pointer rounded-full border px-4 py-1.5 font-serif text-sm transition ${
                        active
                          ? "border-white/40 bg-white/[0.08] text-white"
                          : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <label className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-white/30">
                Pin Number
              </label>
              <p className="mb-2 text-[10px] tracking-[0.15em] text-white/40">
                Analog pins A0–A{ANALOG_PIN_COUNT - 1} are the same as pins{" "}
                {ANALOG_PIN_OFFSET}–{ANALOG_PIN_OFFSET + ANALOG_PIN_COUNT - 1}.
              </p>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-serif text-white/50">
                  {useAnalog ? "A" : "D"}
                </span>
                <input
                  value={pinInput}
                  onChange={(event) => handlePinInputChange(event.target.value)}
                  inputMode="numeric"
                  placeholder={useAnalog ? "e.g. 1" : "e.g. 7"}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-3 pl-9 pr-4 text-white outline-none placeholder:text-white/20 focus:border-white/30"
                />
              </div>
            </div>

            {/* Sliding pin selector */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-3 flex items-center justify-between">
                <button
                  onClick={() => setPinPage((page) => Math.max(0, page - 1))}
                  disabled={pinPage === 0}
                  aria-label="Previous pins"
                  className="cursor-pointer rounded-full border border-white/10 px-3 py-1 text-white/60 transition hover:border-white/30 hover:text-white disabled:cursor-default disabled:opacity-20"
                >
                  ←
                </button>
                <div className="text-center">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-white/30">
                    Pin Selector
                  </p>
                  <p className="mt-1 font-serif text-sm text-white/80">
                    {currentPinPage.title}
                  </p>
                </div>
                <button
                  onClick={() =>
                    setPinPage((page) => Math.min(pinPages.length - 1, page + 1))
                  }
                  disabled={pinPage >= pinPages.length - 1}
                  aria-label="Next pins"
                  className="cursor-pointer rounded-full border border-white/10 px-3 py-1 text-white/60 transition hover:border-white/30 hover:text-white disabled:cursor-default disabled:opacity-20"
                >
                  →
                </button>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {currentPinPage.pins.map((pin) => {
                  const isActive = typedPin === pin;
                  const isAssigned = pinMappings.some((m) => m.pin === pin);
                  return (
                    <button
                      key={pin}
                      onClick={() => showPinInInput(pin)}
                      className={`cursor-pointer rounded-lg border px-2 py-2 text-xs transition ${
                        isActive
                          ? "border-white/40 bg-white/[0.12] text-white"
                          : isAssigned
                            ? "border-white/20 bg-white/[0.06] text-white/70"
                            : "border-white/10 bg-white/[0.02] text-white/40 hover:border-white/25 hover:text-white"
                      }`}
                    >
                      {formatPin(pin)}
                      {isPwmPin(pin) ? "~" : ""}
                    </button>
                  );
                })}
              </div>

              <p className="mt-3 text-center text-[10px] text-white/30">
                ~ can dim an LED (PWM pin)
              </p>

              {pinPages.length > 1 && (
                <div className="mt-3 flex justify-center gap-1">
                  {pinPages.map((page, index) => (
                    <button
                      key={page.title}
                      onClick={() => setPinPage(index)}
                      className={`h-1.5 rounded-full transition-all ${
                        index === pinPage
                          ? "w-5 bg-white/70"
                          : "w-1.5 bg-white/20 hover:bg-white/40"
                      }`}
                      aria-label={`Go to pin page ${index + 1}`}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={assignPin}
                disabled={selected.size === 0}
                className="flex-1 cursor-pointer rounded-xl bg-white px-4 py-3 font-serif text-black transition hover:bg-white/90 disabled:cursor-default disabled:opacity-40"
              >
                Assign pin
              </button>
              <button
                onClick={clearSelection}
                disabled={selected.size === 0}
                className="cursor-pointer rounded-xl border border-white/10 px-4 py-3 font-serif text-sm text-white/50 hover:text-white disabled:cursor-default disabled:opacity-40"
              >
                Deselect
              </button>
            </div>

            {warning && <p className="text-xs text-red-400">{warning}</p>}
            {notice && <p className="text-xs text-amber-300/80">⚠ {notice}</p>}

            {groupedPins.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] uppercase tracking-[0.3em] text-white/30">
                  Pin groups
                </p>
                <div className="flex max-w-full flex-wrap gap-2">
                  {groupedPins.map((pin) => {
                    const count = pinMappings.filter((m) => m.pin === pin).length;
                    const leds = pinLedLoad(pinMappings, pin);
                    const merged = mergedPinSet.has(pin);
                    const ticked = mergeSel.includes(pin);
                    return (
                      <div
                        key={pin}
                        className={`flex items-center gap-1 rounded-full border bg-white/[0.03] ${
                          ticked ? "border-white/50" : "border-white/10"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={ticked}
                          disabled={merged || (!ticked && mergeSel.length >= 3)}
                          onChange={() => toggleMergePin(pin)}
                          title={
                            merged
                              ? "Already part of a tricolor LED"
                              : "Tick 3 pins to merge them into a tricolor LED"
                          }
                          aria-label={`Select pin ${formatPin(pin)} for tricolor merge`}
                          className="ml-3 cursor-pointer disabled:cursor-default disabled:opacity-30"
                        />
                        <button
                          onClick={() => selectPinGroup(pin)}
                          className="cursor-pointer rounded-full px-3 py-1 font-serif text-xs text-white/50 hover:text-white"
                        >
                          Pin <b className="text-white">{formatPin(pin)}</b> —{" "}
                          {count} zone{count === 1 ? "" : "s"} · {leds} LED
                          {leds === 1 ? "" : "s"}
                          {leds > LED_WARN_LIMIT && (
                            <span className="text-amber-300"> ⚠</span>
                          )}
                          {merged && " · tricolor"}
                          {pinTypeOf(pin) === "analog" &&
                            (isPwmPin(pin) ? " · analog" : " · analog ⚠")}
                        </button>
                        <button
                          onClick={() => deletePin(pin)}
                          title={`Delete pin ${formatPin(pin)}`}
                          className="mr-1 cursor-pointer rounded-full px-2 py-1 text-xs text-red-300/50 hover:bg-red-400/10 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    onClick={mergeTricolor}
                    disabled={mergeSel.length !== 3}
                    className="cursor-pointer rounded-xl border border-white/20 px-4 py-2 font-serif text-sm text-white/80 transition hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-35"
                  >
                    Merge into tricolor LED
                  </button>
                  <p className="text-[11px] text-white/35">
                    {mergeSel.length}/3 pins ticked — merging needs exactly 3.
                    One tricolor LED counts as 3 LEDs.
                  </p>
                </div>
              </div>
            )}

            {tricolorGroups.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] uppercase tracking-[0.3em] text-white/30">
                  Tricolor LEDs
                </p>
                <div className="flex flex-col gap-2">
                  {tricolorGroups.map((g) => {
                    const each = Math.max(
                      ...g.pins.map((p) => pinLedLoad(pinMappings, p)),
                    );
                    const uneven = g.pins.some(
                      (p) => pinLedLoad(pinMappings, p) !== each,
                    );
                    return (
                      <div
                        key={g.id}
                        className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="flex items-center gap-2 font-serif text-xs text-white/60">
                            <span
                              className="h-3 w-3 rounded-full border border-white/20"
                              style={{ backgroundColor: g.color ?? DEFAULT_TRICOLOR }}
                            />
                            Pins{" "}
                            <b className="text-white">
                              {g.pins.map(formatPin).join(" + ")}
                            </b>{" "}
                            — {each * 3} LEDs ({each} tricolor)
                          </p>
                          <button
                            onClick={() => unmerge(g.id)}
                            className="cursor-pointer rounded-full px-2 py-1 text-xs text-red-300/50 hover:bg-red-400/10 hover:text-red-300"
                          >
                            Unmerge
                          </button>
                        </div>
                        {uneven && (
                          <p className="mt-1 text-[11px] text-amber-300/80">
                            ⚠ The 3 pins have different LED counts. Each tricolor LED uses
                            one LED on every pin, so they should match.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-white/30">
                  Change a tricolor LED's color in the previews (Sequence and
                  Keyframes tabs).
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-white/5 pt-4">
          <button
            onClick={resetAllPins}
            className="w-fit cursor-pointer rounded-full border border-white/10 px-4 py-2 text-left text-xs uppercase tracking-[0.15em] text-white/60 transition hover:border-white/25 hover:text-white"
          >
            Reset all pin assignments
          </button>
          <button
            onClick={onClearZones}
            className="w-fit cursor-pointer rounded-full border border-white/10 px-4 py-2 text-left text-xs uppercase tracking-[0.15em] text-white/60 transition hover:border-white/25 hover:text-white"
          >
            Re-scan drawing (forces a fresh detection from the server)
          </button>
        </div>
      </div>
    </div>
  );
}

export default ZoneMapper;
