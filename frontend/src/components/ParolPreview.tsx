import { useId } from "react";

import { FULL_LEVEL, levelOf } from "../utils/pins";
import type { PinLevels, ProjectNode } from "../types";

// Used when a pin has no color recorded on the Zone Map tab yet.
const DEFAULT_LIT_COLOR = "#ffd98a";

type ParolPreviewProps = {
  // The Group node. It owns the drawing, the detected zones and the pin
  // mappings, so the preview reads everything it draws from here.
  node: ProjectNode;
  // Pins that are on right now (a Frame's litPins).
  litPins: number[];
  // How bright the analog pins are (a Frame's levels). Missing means full
  // brightness, and digital pins are always at full brightness.
  levels?: PinLevels;
};

function ParolPreview({ node, litPins, levels }: ParolPreviewProps) {
  // Unique id for the glow filter, with the colons React adds removed so
  // url(#...) references resolve in every browser.
  const glowId = `glow-${useId().replace(/:/g, "")}`;

  const zones = node.zones ?? [];
  const pinMappings = node.pinMappings ?? [];

  if (!node.imageDataUrl || zones.length === 0 || pinMappings.length === 0) {
    return (
      <p className="text-center text-sm text-white/30">
        Detect zones and assign pins on the Zone Map tab to see the parol
        light up here.
      </p>
    );
  }

  const imageWidth = node.imageWidth ?? 1;
  const imageHeight = node.imageHeight ?? 1;

  const lit = new Set(litPins);
  const zoneToMapping = new Map(pinMappings.map((m) => [m.zoneId, m]));

  // Only zones whose pin is currently on get drawn. Everything else stays
  // as the dimmed drawing underneath.
  const litZones = zones.filter((zone) => {
    const mapping = zoneToMapping.get(zone.id);
    return mapping !== undefined && lit.has(mapping.pin);
  });

  // Glow size scales with the drawing's own resolution, same idea as the
  // pin labels in ZoneMapper.
  const glowBlur = Math.max(imageWidth, imageHeight) * 0.008;

  function pointsOf(polygon: [number, number][]) {
    return polygon.map((p) => p.join(",")).join(" ");
  }

  function colorOf(zoneId: number) {
    return zoneToMapping.get(zoneId)?.color ?? DEFAULT_LIT_COLOR;
  }

  // 0..1. Only analog pins can be dimmed.
  function brightnessOf(zoneId: number) {
    const mapping = zoneToMapping.get(zoneId);
    if (!mapping || mapping.pinType !== "analog") return 1;
    return levelOf(levels, mapping.pin) / FULL_LEVEL;
  }

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0b]"
      style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}
    >
      <img
        src={node.imageDataUrl}
        alt="Parol drawing"
        className="absolute inset-0 h-full w-full object-fill"
        style={{ filter: "invert(1) brightness(0.45)" }}
      />

      <svg
        viewBox={`0 0 ${imageWidth} ${imageHeight}`}
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <filter
            id={glowId}
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feGaussianBlur stdDeviation={glowBlur} />
          </filter>
        </defs>

        {/* Soft glow underneath */}
        <g filter={`url(#${glowId})`}>
          {litZones.map((zone) => (
            <polygon
              key={`glow-${zone.id}`}
              points={pointsOf(zone.polygon)}
              fill={colorOf(zone.id)}
              fillOpacity={0.9 * brightnessOf(zone.id)}
              stroke="none"
            />
          ))}
        </g>

        {/* Crisp lit zones on top */}
        {litZones.map((zone) => (
          <polygon
            key={zone.id}
            points={pointsOf(zone.polygon)}
            fill={colorOf(zone.id)}
            fillOpacity={0.85 * brightnessOf(zone.id)}
            stroke="none"
          />
        ))}
      </svg>
    </div>
  );
}

export default ParolPreview;
