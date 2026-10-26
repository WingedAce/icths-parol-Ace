import type {
  AudioAnalysis,
  Frame,
  PinMapping,
  TricolorGroup,
} from "../types";
import { buildInbetweens } from "./audioTiming";
import { segmentBpmAt } from "./bpmChanges";
import {
  groupOfPin,
  isPwmPin,
  levelOf,
  tricolorColor,
  FULL_LEVEL,
  PIN_COLORS,
} from "./pins";

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
  tricolor: { id: string; pins: [number, number, number]; color: string }[];
  warnings: string[];
};

// How a lit tricolor LED is driven on the board.
//   true:  the 3 legs are dimmed/switched to mix the color picked for each
//          frame, so the board shows the same colors as the preview. The
//          lowest pin is the RED leg, the middle pin the GREEN leg and the
//          highest pin the BLUE leg. Works best on PWM pins (2-13 and 44-46
//          on the Mega); on other pins each leg is only fully on or off.
//   false: all 3 legs are switched on together, so the LED is always white.
const TRICOLOR_MIX_COLOR = true;

// What each of the 8 palette colors is mixed from on the real LED. The
// preview uses screen colors (like #ff4d4d for Red) that look washed out
// on an LED if copied as-is, so these are the leg levels (red, green, blue,
// 0-255) that look right on the LED. Tweak a row if a color looks off on
// your LED.
const LED_MIX: Record<string, [number, number, number]> = {
  "#ff4d4d": [255, 0, 0], // Red
  "#0a9bff": [0, 0, 255], // Blue
  "#ffd60a": [255, 170, 0], // Yellow
  "#34c759": [0, 255, 0], // Green
  "#ff8a1f": [255, 60, 0], // Orange
  "#ffffff": [255, 255, 255], // White
  "#ff6fb5": [255, 30, 110], // Pink
  "#b86bff": [150, 0, 255], // Purple
};

// "#ff4d4d" -> "Red" for the eight palette colors, otherwise the hex code.
const colorName = (hex: string) =>
  PIN_COLORS.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.name ??
  hex;

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

  // Only groups whose 3 pins are all still mapped. Pins in ascending order
  // are the red, green and blue legs.
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

  // Same frame list the Sequence preview uses.
  const keys = [...frames].sort((a, b) => a.time - b.time);
  const inbetweens = buildInbetweens(analysis, keys, analog, groups);
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
      // With BPM change points the tempo can change inside a section, so the
      // note uses the tempo in effect at this time.
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
    // A pin that can't dim is only ever fully on or fully off.
    const value = dimmable.has(pin) ? wanted : wanted >= 128 ? 255 : 0;
    if (current.get(pin) === value) return;
    current.set(pin, value);
    events.push({ timeMs, pin, value, note });
  };

  for (const frame of all) {
    const timeMs = Math.max(0, Math.round(frame.time * 1000));
    const lit = new Set(frame.litPins);
    // Which color each lit tricolor LED has in this frame.
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

    // A tricolor LED is one thing: when it is on, its 3 legs (red, green,
    // blue) are set to mix the color picked for this frame. When it is off,
    // all 3 are off. (With TRICOLOR_MIX_COLOR off, all 3 are just fully on.)
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
