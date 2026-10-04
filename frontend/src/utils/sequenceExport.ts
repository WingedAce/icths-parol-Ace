import type {
  AudioAnalysis,
  Frame,
  PinMapping,
  TricolorGroup,
} from "../types";
import { buildInbetweens } from "./audioTiming";
import { groupOfPin, isPwmPin, levelOf, FULL_LEVEL } from "./pins";

// Turns the song's keyframes into the list of "at this millisecond, put this
// pin at this value" rows that the Arduino sketch plays back. Plain sorting
// and comparing, no AI: the same project always gives the same table.
//
// It uses the exact same frames as the Sequence preview (keyframes plus the
// in-betweens that buildInbetweens works out), and the same rule: the lights
// hold the last frame's pins until the next frame. So the delays on the board
// match what the preview shows, beat for beat.

export type SketchEvent = {
  timeMs: number;
  pin: number;
  // 0-255. Digital pins only ever get 0 or 255.
  value: number;
  // Human-readable comment written next to the row.
  note: string;
};

export type SequenceBuild = {
  events: SketchEvent[];
  // Pins that can really dim (PWM pins the Zone Map marked as analog).
  dimmablePins: number[];
  // Tricolor groups that are fully mapped: pins are [red, green, blue].
  tricolor: { pins: [number, number, number]; color: string }[];
  warnings: string[];
};

const DEFAULT_TRICOLOR = "#ffffff";

// "#ff8a1f" -> [255, 138, 31]
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
): SequenceBuild {
  const warnings: string[] = [];

  const pins = Array.from(new Set(pinMappings.map((m) => m.pin))).sort(
    (a, b) => a - b,
  );
  const analog = new Set(
    pinMappings.filter((m) => m.pinType === "analog").map((m) => m.pin),
  );
  // Pins of a tricolor LED are the red, green and blue legs, so they always
  // dim when the pin has PWM; that is how the color gets mixed.
  const inTricolor = new Set(
    tricolorGroups
      .filter((g) => g.pins.every((p) => pins.includes(p)))
      .flatMap((g) => g.pins),
  );
  const dimmable = new Set(
    pins.filter((p) => isPwmPin(p) && (analog.has(p) || inTricolor.has(p))),
  );

  for (const p of pins) {
    if (inTricolor.has(p) && !isPwmPin(p)) {
      warnings.push(
        `Pin ${p} is part of a tricolor LED but has no PWM on the Mega, so that color leg can only be fully on or off and the mixed color will be approximate. Use pins 2-13 or 44-46 for tricolor LEDs.`,
      );
    } else if (analog.has(p) && !isPwmPin(p)) {
      warnings.push(
        `Pin ${p} is set to dim but it has no PWM on the Mega, so on the board it will only switch on and off.`,
      );
    }
  }

  // Only groups whose 3 pins are all still mapped. Pins in ascending order
  // are the red, green and blue legs.
  const groups = tricolorGroups
    .filter((g) => g.pins.every((p) => pins.includes(p)))
    .map((g) => ({
      pins: [...g.pins].sort((a, b) => a - b) as [number, number, number],
      color: g.color ?? DEFAULT_TRICOLOR,
    }));

  if (!analysis || frames.length === 0) {
    return {
      events: [],
      dimmablePins: Array.from(dimmable),
      tricolor: groups,
      warnings,
    };
  }

  // Same frame list the Sequence preview uses.
  const keys = [...frames].sort((a, b) => a.time - b.time);
  const inbetweens = buildInbetweens(analysis, keys, analog);
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
      parts.push(
        `section ${sectionNo} (${Math.round(section.bpm * 10) / 10} BPM)`,
      );
    }
    return parts.join(" · ");
  };

  const current = new Map<number, number>(pins.map((p) => [p, 0]));
  const events: SketchEvent[] = [];

  const emit = (timeMs: number, pin: number, wanted: number, note: string) => {
    // A pin that can't dim is only ever fully on or fully off.
    const value = dimmable.has(pin) ? wanted : wanted >= 128 ? 255 : 0;
    if (current.get(pin) === value) return;
    current.set(pin, value);
    events.push({ timeMs, pin, value, note });
  };

  for (const frame of all) {
    const timeMs = Math.max(0, Math.round(frame.time * 1000));
    const note = noteFor(frame.time);
    const lit = new Set(frame.litPins);

    for (const pin of pins) {
      if (groupOfPin(groups, pin)) continue;
      const level = lit.has(pin)
        ? analog.has(pin)
          ? levelOf(frame.levels, pin)
          : FULL_LEVEL
        : 0;
      emit(timeMs, pin, toValue(level), note);
    }

    // A tricolor LED is on when any of its 3 pins is on, as bright as its
    // brightest pin, in the color picked in the preview.
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
      const rgb = hexToRgb(g.color);
      g.pins.forEach((pin, i) => {
        emit(timeMs, pin, Math.round((rgb[i] * level) / FULL_LEVEL), note);
      });
    }
  }

  // Everything goes dark when the song ends.
  const lastMs = events.length > 0 ? events[events.length - 1].timeMs : 0;
  const endMs = Math.max(lastMs, Math.round(analysis.duration * 1000));
  for (const pin of pins) {
    if ((current.get(pin) ?? 0) !== 0) {
      current.set(pin, 0);
      events.push({ timeMs: endMs, pin, value: 0, note: "song ends" });
    }
  }

  return {
    events,
    dimmablePins: Array.from(dimmable).sort((a, b) => a - b),
    tricolor: groups,
    warnings,
  };
}