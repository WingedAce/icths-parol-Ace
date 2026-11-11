import type {
  AudioAnalysis,
  Frame,
  PinMapping,
  TricolorGroup,
  Zone,
} from "../types";
import { buildInbetweens } from "./audioTiming";
import { segmentBpmAt } from "./bpmChanges";
import {
  groupOfPin,
  isPwmPin,
  pinPositions,
  levelOf,
  tricolorColor,
  FULL_LEVEL,
  PIN_COLORS,
} from "./pins";

export const ROWS_PER_TABLE = 15000;
export const MAX_SHOW_ROWS = 55000;

export type SketchEvent = {
  timeMs: number;
  pin: number;
  value: number;
  note: string;
};

export type SequenceBuild = {
  events: SketchEvent[];
  dimmablePins: number[];
  tricolor: { id: string; pins: [number, number, number]; color: string }[];
  warnings: string[];
};

const TRICOLOR_MIX_COLOR = true;

const LED_MIX: Record<string, [number, number, number]> = {
  "#ff4d4d": [255, 0, 0],
  "#0a9bff": [0, 0, 255],
  "#ffd60a": [255, 170, 0],
  "#34c759": [0, 255, 0],
  "#ff8a1f": [255, 60, 0],
  "#ffffff": [255, 255, 255],
  "#ff6fb5": [255, 30, 110],
  "#b86bff": [150, 0, 255],
};

const colorName = (hex: string) =>
  PIN_COLORS.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.name ??
  hex;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toValue = (level: number) =>
  Math.max(0, Math.min(255, Math.round((level * 255) / FULL_LEVEL)));

export function buildSequence(
  analysis: AudioAnalysis | undefined,
  frames: Frame[],
  pinMappings: PinMapping[],
  tricolorGroups: TricolorGroup[],
  zones: Zone[] = [],
): SequenceBuild {
  const warnings: string[] = [];

  const pins = Array.from(new Set(pinMappings.map((m) => m.pin))).sort(
    (a, b) => a - b,
  );
  const analog = new Set(
    pinMappings.filter((m) => m.pinType === "analog").map((m) => m.pin),
  );
  const inTricolor = new Set(
    tricolorGroups
      .filter((g) => g.pins.every((p) => pins.includes(p)))
      .flatMap((g) => g.pins),
  );
  const dimmable = new Set(
    pins.filter(
      (p) =>
        isPwmPin(p) &&
        (analog.has(p) || (TRICOLOR_MIX_COLOR && inTricolor.has(p))),
    ),
  );

  for (const p of pins) {
    if (TRICOLOR_MIX_COLOR && inTricolor.has(p) && !isPwmPin(p)) {
      warnings.push(
        `Pin ${p} is part of a tricolor LED but has no PWM on the Mega, so that color leg can only be fully on or off and the mixed color will be approximate. Use pins 2-13 or 44-46 for tricolor LEDs.`,
      );
    } else if (analog.has(p) && !isPwmPin(p)) {
      warnings.push(
        `Pin ${p} is set to dim but it has no PWM on the Mega, so on the board it will only switch on and off.`,
      );
    }
  }

  const groups = tricolorGroups
    .filter((g) => g.pins.every((p) => pins.includes(p)))
    .map((g) => ({
      id: g.id,
      pins: [...g.pins].sort((a, b) => a - b) as [number, number, number],
      color: tricolorColor(g, undefined),
    }));

  if (!analysis || frames.length === 0) {
    return {
      events: [],
      dimmablePins: Array.from(dimmable),
      tricolor: groups,
      warnings,
    };
  }

  const keys = [...frames].sort((a, b) => a.time - b.time);
  const inbetweens = buildInbetweens(
    analysis,
    keys,
    analog,
    groups,
    pinPositions(zones, pinMappings),
  );
  const all = [...keys, ...inbetweens].sort((a, b) => a.time - b.time);

  const beats = analysis.beatTimes;
  const noteFor = (t: number) => {
    const section =
      analysis.sections.find((s) => t >= s.start && t < s.end) ??
      analysis.sections[analysis.sections.length - 1];
    const sectionNo = section ? analysis.sections.indexOf(section) + 1 : 0;
    let best = -1;
    let bestDistance = Infinity;
    beats.forEach((b, i) => {
      const d = Math.abs(b - t);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    const parts = [`${t.toFixed(2)}s`];
    if (best >= 0 && bestDistance < 0.05) parts.push(`beat ${best + 1}`);
    if (section) {
      const bpmHere = analysis.tempoSegments
        ? segmentBpmAt(analysis.tempoSegments, t)
        : section.bpm;
      parts.push(
        `section ${sectionNo} (${Math.round(bpmHere * 10) / 10} BPM)`,
      );
    }
    return parts.join(" · ");
  };

  const current = new Map<number, number>(pins.map((p) => [p, 0]));
  const events: SketchEvent[] = [];

  const emit = (timeMs: number, pin: number, wanted: number, note: string) => {
    const value = dimmable.has(pin) ? wanted : wanted >= 128 ? 255 : 0;
    if (current.get(pin) === value) return;
    current.set(pin, value);
    events.push({ timeMs, pin, value, note });
  };

  for (const frame of all) {
    const timeMs = Math.max(0, Math.round(frame.time * 1000));
    const lit = new Set(frame.litPins);
    const tricolorNote = groups
      .filter((g) => g.pins.some((p) => lit.has(p)))
      .map(
        (g) =>
          `tricolor ${g.pins.join("+")}: ${colorName(tricolorColor(g, frame.tricolors))}`,
      )
      .join(" · ");
    const note = [noteFor(frame.time), tricolorNote]
      .filter((part) => part.length > 0)
      .join(" · ");

    for (const pin of pins) {
      if (groupOfPin(groups, pin)) continue;
      const level = lit.has(pin)
        ? analog.has(pin)
          ? levelOf(frame.levels, pin)
          : FULL_LEVEL
        : 0;
      emit(timeMs, pin, toValue(level), note);
    }

    for (const g of groups) {
      const onPins = g.pins.filter((p) => lit.has(p));
      const level =
        onPins.length === 0
          ? 0
          : Math.max(
              ...onPins.map((p) =>
                analog.has(p) ? levelOf(frame.levels, p) : FULL_LEVEL,
              ),
            );
      const colorHex = tricolorColor(g, frame.tricolors);
      const rgb = LED_MIX[colorHex.toLowerCase()] ?? hexToRgb(colorHex);
      g.pins.forEach((pin, i) => {
        const value = TRICOLOR_MIX_COLOR
          ? Math.round((rgb[i] * level) / FULL_LEVEL)
          : level === 0
            ? 0
            : toValue(level);
        emit(timeMs, pin, value, note);
      });
    }
  }

  const lastMs = events.length > 0 ? events[events.length - 1].timeMs : 0;
  const endMs = Math.max(lastMs, Math.round(analysis.duration * 1000));
  for (const pin of pins) {
    if ((current.get(pin) ?? 0) !== 0) {
      current.set(pin, 0);
      events.push({ timeMs: endMs, pin, value: 0, note: "song ends" });
    }
  }

  if (events.length > MAX_SHOW_ROWS) {
    warnings.push(
      `This show has ${events.length.toLocaleString()} light changes, but the Arduino Mega can only hold about ${MAX_SHOW_ROWS.toLocaleString()} (the sketch will not fit in its flash). Most come from Fade and Alternate transitions, or a high Custom in-between count: every in-between that changes a pin adds a row. Lower the in-between count on those keyframes, or use Hold, Ripple or a sweep preset, which change each pin only once.`,
    );
  }

  return {
    events,
    dimmablePins: Array.from(dimmable).sort((a, b) => a - b),
    tricolor: groups,
    warnings,
  };
}
