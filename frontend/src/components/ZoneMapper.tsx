import { useRef, useState } from "react";

import type { PinMapping, PinType, ProjectNode, Zone } from "../types";
import {
  ANALOG_PIN_COUNT,
  ANALOG_PIN_OFFSET,
  PWM_PINS,
  formatPin,
  isAnalogPin,
  isPwmPin,
  parsePin,
} from "../utils/pins";

const SEGMENT_API_URL =
  import.meta.env.VITE_SEGMENT_API_URL ?? "http://localhost:8000/segment";

// The only LED colors available for the build — the palette is fixed to
// these eight, so there's no free color picker.
const PIN_COLORS = [
  { name: "Red", hex: "#ff4d4d" },
  { name: "Blue", hex: "#0a9bff" },
  { name: "Yellow", hex: "#ffd60a" },
  { name: "Green", hex: "#34c759" },
  { name: "Orange", hex: "#ff8a1f" },
  { name: "White", hex: "#ffffff" },
  { name: "Pink", hex: "#ff6fb5" },
  { name: "Purple", hex: "#b86bff" },
] as const;

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

function colorName(hex?: string) {
  return PIN_COLORS.find((c) => c.hex.toLowerCase() === hex?.toLowerCase())?.name;
}

type ZoneMapperProps = {
  node: ProjectNode;
  onZonesReady: (zones: Zone[], imageWidth: number, imageHeight: number) => void;
  onPinMappingsChange: (pinMappings: PinMapping[]) => void;
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

function ZoneMapper({ node, onZonesReady, onPinMappingsChange, onClearZones }: ZoneMapperProps) {
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pinInput, setPinInput] = useState("");
  const [warning, setWarning] = useState("");

  // Which header the next assignment uses: the digital pins (2-52) or the
  // A0-A15 header. D1 and A1 are different pins, so both can be mixed in one
  // project. This is NOT the dimming setting; that is each pin's "Pin type"
  // (Digital or Analog) further down, saved on the pin mappings.
  const [pinHeader, setPinHeader] = useState<"digital" | "a-header">("digital");
  const useAnalog = pinHeader === "a-header";

  // Which page of the sliding pin selector is showing.
  const [pinPage, setPinPage] = useState(0);

  // Which pin's color swatches are open (only one at a time). Opens when
  // "Assign color" is pressed, closes as soon as a color is picked.
  const [colorPickerPin, setColorPickerPin] = useState<number | null>(null);

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
  const zoneToColor = new Map(pinMappings.map((m) => [m.zoneId, m.color]));

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
    setWarning("");
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

    const withoutSelected = pinMappings.filter((m) => !selected.has(m.zoneId));
    // Zones joining a pin that already exists take on that pin's type.
    const existingType = pinMappings.find(
      (m) => m.pin === pin && m.pinType,
    )?.pinType;
    const added: PinMapping[] = Array.from(selected).map((zoneId) => ({
      zoneId,
      pin,
      ...(existingType ? { pinType: existingType } : {}),
    }));

    onPinMappingsChange([...withoutSelected, ...added]);
    setSelected(new Set());
    setPinInput("");
    setWarning("");
  }

  function clearSelection() {
    setSelected(new Set());
    setWarning("");
  }

  function resetAllPins() {
    onPinMappingsChange([]);
    setSelected(new Set());
    setPinInput("");
    setColorPickerPin(null);
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
    showPinInInput(pin);
  }

  function deletePin(pin: number) {
    const ids = new Set(
      pinMappings.filter((m) => m.pin === pin).map((m) => m.zoneId),
    );
    onPinMappingsChange(pinMappings.filter((m) => m.pin !== pin));
    setSelected((previous) => {
      const next = new Set(previous);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setColorPickerPin(null);
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

  function setPinType(pin: number, pinType: PinType) {
    onPinMappingsChange(
      pinMappings.map((m) => (m.pin === pin ? { ...m, pinType } : m)),
    );
  }

  function setPinColor(pin: number, color: string) {
    onPinMappingsChange(
      pinMappings.map((m) => (m.pin === pin ? { ...m, color } : m)),
    );
    setColorPickerPin(null);
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

                return (
                  <g key={zone.id}>
                    <polygon
                      points={zone.polygon.map((p) => p.join(",")).join(" ")}
                      fill={fill}
                      fillOpacity={fillOpacity}
                      stroke="none"
                      className="cursor-pointer"
                      onClick={() => toggleSelect(zone.id)}
                    />
                    {showPinNumbers && pin !== undefined && (
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

      {/* Right: zone selection, pin assignment and LED colors. */}
      <div className="flex w-full flex-col gap-6 lg:flex-1">
        <div className="grid gap-6 lg:grid-cols-2">
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

            {groupedPins.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] uppercase tracking-[0.3em] text-white/30">
                  Pin groups
                </p>
                <div className="flex max-w-full flex-wrap gap-2">
                  {groupedPins.map((pin) => {
                    const count = pinMappings.filter((m) => m.pin === pin).length;
                    return (
                      <div
                        key={pin}
                        className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03]"
                      >
                        <button
                          onClick={() => selectPinGroup(pin)}
                          className="cursor-pointer rounded-full px-3 py-1 font-serif text-xs text-white/50 hover:text-white"
                        >
                          Pin <b className="text-white">{formatPin(pin)}</b> —{" "}
                          {count} zone{count === 1 ? "" : "s"}
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
              </div>
            )}
          </div>

          {/* Right column: pin type (dimming) and LED colors */}
          {groupedPins.length > 0 && (
            <div className="flex min-w-0 flex-col gap-6">
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <p className="mb-2 text-[10px] uppercase tracking-[0.3em] text-white/30">
                Pin Type
              </p>
              <p className="mb-3 text-[11px] leading-relaxed text-white/25">
                Digital pins are simply on or off. Analog pins can be dimmed to
                any brightness, so they need a PWM-capable pin (marked ~). On
                an Arduino Mega those are {PWM_PINS.join(", ")}. The A0–A15
                pins can't dim an LED.
              </p>
              <div className="flex flex-col gap-2">
                {groupedPins.map((pin) => {
                  const type = pinTypeOf(pin);
                  const cannotDim = type === "analog" && !isPwmPin(pin);

                  return (
                    <div
                      key={pin}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                    >
                      <span className="font-serif text-sm text-white/70">
                        Pin <b className="text-white">{formatPin(pin)}</b>
                      </span>

                      <div className="ml-auto flex gap-1">
                        {(["digital", "analog"] as PinType[]).map((option) => (
                          <button
                            key={option}
                            onClick={() => setPinType(pin, option)}
                            aria-pressed={type === option}
                            className={`cursor-pointer rounded-lg border px-3 py-1.5 font-serif text-xs capitalize transition ${
                              type === option
                                ? "border-white/40 bg-white/[0.08] text-white"
                                : "border-white/10 text-white/50 hover:text-white"
                            }`}
                          >
                            {option}
                          </button>
                        ))}
                      </div>

                      {cannotDim && (
                        <p className="basis-full text-[11px] text-amber-200/70">
                          Pin {formatPin(pin)} can't dim an LED on an Arduino
                          Mega. Use one of the PWM pins ({PWM_PINS.join(", ")})
                          or switch this pin back to Digital.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <p className="mb-2 text-[10px] uppercase tracking-[0.3em] text-white/30">
                LED Color
              </p>
              <p className="mb-3 text-[11px] leading-relaxed text-white/25">
                Pick the real LED color soldered onto each pin — a preview
                only, the actual color is fixed by the hardware, not this
                website.
              </p>
              <div className="flex flex-col gap-2">
                {groupedPins.map((pin) => {
                  const savedColor = pinMappings.find(
                    (m) => m.pin === pin && m.color,
                  )?.color;
                  const isOpen = colorPickerPin === pin;

                  return (
                    <div
                      key={pin}
                      className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-serif text-sm text-white/70">
                          Pin <b className="text-white">{formatPin(pin)}</b>
                        </span>

                        {savedColor && (
                          <span className="flex items-center gap-1.5 text-xs text-white/40">
                            <span
                              className="h-3 w-3 rounded-full border border-white/20"
                              style={{ backgroundColor: savedColor }}
                            />
                            {colorName(savedColor)}
                          </span>
                        )}

                        <button
                          onClick={() => setColorPickerPin(isOpen ? null : pin)}
                          className={`ml-auto cursor-pointer rounded-lg border px-3 py-1.5 font-serif text-xs transition hover:text-white ${
                            isOpen
                              ? "border-white/40 bg-white/[0.08] text-white"
                              : "border-white/10 text-white/60 hover:border-white/30"
                          }`}
                        >
                          Assign color
                        </button>
                      </div>

                      {isOpen && (
                        <div className="mt-3 grid grid-cols-4 gap-1 border-t border-white/10 pt-3">
                          {PIN_COLORS.map((c) => {
                            const isPicked =
                              savedColor?.toLowerCase() === c.hex.toLowerCase();
                            return (
                              <button
                                key={c.name}
                                onClick={() => setPinColor(pin, c.hex)}
                                title={c.name}
                                aria-label={`${c.name} for pin ${formatPin(pin)}`}
                                aria-pressed={isPicked}
                                className={`flex cursor-pointer items-center justify-center rounded-xl border p-1.5 transition ${
                                  isPicked
                                    ? "border-white/40 bg-white/[0.08]"
                                    : "border-transparent hover:bg-white/[0.06]"
                                }`}
                              >
                                <span
                                  className="block aspect-square w-full rounded-lg"
                                  style={{ backgroundColor: c.hex }}
                                />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-white/5 pt-4">
          <button
            onClick={resetAllPins}
            className="cursor-pointer text-left text-xs text-white/30 underline underline-offset-2 hover:text-white/60"
          >
            Reset all pin assignments
          </button>
          <button
            onClick={onClearZones}
            className="cursor-pointer text-left text-xs text-white/30 underline underline-offset-2 hover:text-white/60"
          >
            Re-scan drawing (forces a fresh detection from the server)
          </button>
        </div>
      </div>
    </div>
  );
}

export default ZoneMapper;
