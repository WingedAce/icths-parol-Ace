import { useRef, useState } from "react";

import type { PinMapping, ProjectNode, Zone } from "../types";

const SEGMENT_API_URL =
  import.meta.env.VITE_SEGMENT_API_URL ?? "http://localhost:8000/segment";

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

  // Draft colors per pin, before "Apply color" commits them. Not yet
  // committed values start at the pin's already-saved color (if any) or a
  // neutral default the moment that pin first appears in the drafts map.
  const [colorDrafts, setColorDrafts] = useState<Record<number, string>>({});

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
    const pinValue = pinInput.trim();
    if (!pinValue || Number.isNaN(Number(pinValue))) {
      setWarning("Enter a valid pin number.");
      return;
    }
    if (selected.size === 0) return;

    const pin = Number(pinValue);
    const withoutSelected = pinMappings.filter((m) => !selected.has(m.zoneId));
    const added: PinMapping[] = Array.from(selected).map((zoneId) => ({
      zoneId,
      pin,
    }));

    onPinMappingsChange([...withoutSelected, ...added]);
    setSelected(new Set());
    setPinInput("");
  }

  function clearSelection() {
    setSelected(new Set());
    setWarning("");
  }

  function resetAllPins() {
    onPinMappingsChange([]);
    setSelected(new Set());
  }

  function selectPinGroup(pin: number) {
    const ids = pinMappings.filter((m) => m.pin === pin).map((m) => m.zoneId);
    setSelected(new Set(ids));
    setPinInput(String(pin));
  }

  function setPinColor(pin: number, color: string) {
    onPinMappingsChange(
      pinMappings.map((m) => (m.pin === pin ? { ...m, color } : m)),
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 lg:flex-row lg:items-start">
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
                        {pin}
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

      {/* Right: zone selection + pin assignment, styled to match the entry
          form (uppercase label + rounded-xl input + solid white button). */}
      <div className="flex w-full flex-col gap-5 lg:w-80 lg:shrink-0">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/30">
            Selection
          </p>
          <p className="mt-2 font-serif text-2xl font-light">
            {selected.size} zone{selected.size === 1 ? "" : "s"} selected
          </p>
        </div>

        <div>
          <label className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-white/30">
            Pin Number
          </label>
          <input
            value={pinInput}
            onChange={(event) => setPinInput(event.target.value)}
            inputMode="numeric"
            placeholder="e.g. 7"
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white outline-none placeholder:text-white/20 focus:border-white/30"
          />
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
            <div className="flex flex-wrap gap-2">
              {groupedPins.map((pin) => {
                const count = pinMappings.filter((m) => m.pin === pin).length;
                return (
                  <button
                    key={pin}
                    onClick={() => selectPinGroup(pin)}
                    className="cursor-pointer rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-serif text-xs text-white/50 hover:text-white"
                  >
                    Pin <b className="text-white">{pin}</b> — {count} zone
                    {count === 1 ? "" : "s"}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {groupedPins.length > 0 && (
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.3em] text-white/30">
              Apply Color
            </p>
            <p className="mb-3 text-[11px] text-white/25">
              Records the real LED color you're soldering onto each pin — a
              preview only, the actual color is fixed by the hardware, not
              this website.
            </p>
            <div className="flex flex-col gap-2">
              {groupedPins.map((pin) => {
                const savedColor = pinMappings.find(
                  (m) => m.pin === pin && m.color,
                )?.color;
                const draft = colorDrafts[pin] ?? savedColor ?? "#2f6f4f";

                return (
                  <div
                    key={pin}
                    className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                  >
                    <span className="font-serif text-sm text-white/70">
                      Pin <b className="text-white">{pin}</b>
                    </span>

                    <input
                      type="color"
                      value={draft}
                      onChange={(event) =>
                        setColorDrafts((previous) => ({
                          ...previous,
                          [pin]: event.target.value,
                        }))
                      }
                      className="h-8 w-8 cursor-pointer rounded-md border border-white/10 bg-transparent p-0"
                    />

                    <button
                      onClick={() => setPinColor(pin, draft)}
                      className="ml-auto cursor-pointer rounded-lg border border-white/10 px-3 py-1.5 font-serif text-xs text-white/60 hover:border-white/30 hover:text-white"
                    >
                      Apply color
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-2 flex flex-col gap-2">
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
