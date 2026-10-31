import type { Transition } from "../types";
import type { Point } from "./pins";

// Puts the units that change between two keyframes into the order a sweep
// preset changes them in. A unit is one pin, or the three pins of a tricolor
// LED. Positions come from the zone map (see pinPositions); when a unit has
// no known position, or the preset is not a sweep, the units stay in pin
// order, which is what Ripple does.

const TWO_PI = Math.PI * 2;

// Small deterministic hash, so Random looks identical in the preview, the
// video and the exported code.
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function orderUnits(
  units: number[][],
  mode: Transition,
  positions: Map<number, Point>,
  // Seeds the Random order so each keyframe gets its own fixed scramble.
  seed: string,
): number[][] {
  const byPin = (a: number[], b: number[]) => Math.min(...a) - Math.min(...b);
  const base = [...units].sort(byPin);

  if (mode === "scatter") {
    const key = (u: number[]) => hash(`${seed}:${Math.min(...u)}`);
    return base.sort((a, b) => key(a) - key(b) || byPin(a, b));
  }

  const isSpatial =
    mode === "spin-cw" ||
    mode === "spin-ccw" ||
    mode === "outwards" ||
    mode === "inwards" ||
    mode === "wipe-down" ||
    mode === "wipe-up" ||
    mode === "wipe-right" ||
    mode === "wipe-left";
  if (!isSpatial || positions.size === 0) return base;

  const unitPoint = (unit: number[]): Point | null => {
    const pts = unit
      .map((p) => positions.get(p))
      .filter((p): p is Point => p !== undefined);
    if (pts.length === 0) return null;
    return [
      pts.reduce((s, p) => s + p[0], 0) / pts.length,
      pts.reduce((s, p) => s + p[1], 0) / pts.length,
    ];
  };
  const points = base.map((u) => unitPoint(u));
  if (points.some((p) => p === null)) return base;

  // Middle of the whole parol: the center of the box around every pin.
  const all = Array.from(positions.values());
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;

  // Angle clockwise from straight up (the screen's y axis points down).
  const angleOf = (p: Point) => Math.atan2(p[0] - cx, -(p[1] - cy));
  const distOf = (p: Point) => Math.hypot(p[0] - cx, p[1] - cy);
  // A pin a hair "before" the start angle is the start, not a full turn away.
  const norm = (a: number) => {
    const v = ((a % TWO_PI) + TWO_PI) % TWO_PI;
    return v > TWO_PI - 1e-6 ? 0 : v;
  };

  // Spins start at the uppermost pin of the whole parol.
  let top: Point = all[0];
  for (const p of all) if (p[1] < top[1]) top = p;
  const startAngle = angleOf(top);

  const rows = base.map((unit, i) => ({ unit, p: points[i] as Point }));
  const cw = (p: Point) => norm(angleOf(p) - startAngle);

  const primary = (p: Point): number => {
    switch (mode) {
      case "spin-cw":
        return cw(p);
      case "spin-ccw":
        return norm(startAngle - angleOf(p));
      case "outwards":
        return distOf(p);
      case "inwards":
        return -distOf(p);
      case "wipe-down":
        return p[1];
      case "wipe-up":
        return -p[1];
      case "wipe-right":
        return p[0];
      default:
        return -p[0]; // wipe-left
    }
  };
  const secondary = (p: Point): number => {
    switch (mode) {
      case "spin-cw":
      case "spin-ccw":
        return distOf(p);
      case "outwards":
      case "inwards":
        return cw(p);
      case "wipe-down":
      case "wipe-up":
        return p[0];
      default:
        return p[1];
    }
  };

  // Two values closer than this count as a tie (pins on the same row, or at
  // the same angle), so the secondary value decides.
  const EPS = 1e-6;
  rows.sort((a, b) => {
    const d = primary(a.p) - primary(b.p);
    if (Math.abs(d) > EPS) return d;
    const e = secondary(a.p) - secondary(b.p);
    if (Math.abs(e) > EPS) return e;
    return byPin(a.unit, b.unit);
  });
  return rows.map((r) => r.unit);
}
