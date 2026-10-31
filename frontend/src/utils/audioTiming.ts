import type { AudioAnalysis, Frame, PinLevels, Transition } from "../types";
import { FULL_LEVEL, levelOf, pruneLevels, type Point } from "./pins";
import { isSweep } from "./transitionPresets";
import { orderUnits } from "./transitionOrder";

// One empty key frame at the start of each song section.
export function makeKeyFrames(analysis: AudioAnalysis): Frame[] {
  return analysis.sections.map((section): Frame => ({
    id: crypto.randomUUID(),
    kind: "key",
    sectionId: section.id,
    time: section.start,
    litPins: [],
  }));
}

// Beat times that fall between two key frames (where in-betweens go).
export function beatsBetween(
  analysis: AudioAnalysis,
  start: number,
  end: number,
): number[] {
  return analysis.beatTimes.filter((t) => t > start && t < end);
}

// ---- When the in-betweens of a transition sit ----

// The most in-betweens that fit between two keyframes: one per millisecond
// (the sketch works in whole milliseconds), and the last one still has to
// leave a millisecond before the next keyframe.
export function maxInbetweens(fromTime: number, toTime: number): number {
  const ms = Math.floor((toTime - fromTime) * 1000 + 1e-6);
  return Math.max(0, ms - 1);
}

// `count` in-betweens spread evenly between two times, to the millisecond.
export function evenTimes(
  fromTime: number,
  toTime: number,
  count: number,
): number[] {
  const n = Math.min(count, maxInbetweens(fromTime, toTime));
  const times: number[] = [];
  for (let k = 1; k <= n; k++) {
    const t = fromTime + ((toTime - fromTime) * k) / (n + 1);
    times.push(Math.round(t * 1000) / 1000);
  }
  return times;
}

// A sweep's own default speed: one in-between per changing unit, minus one,
// so every in-between turns exactly one more unit over and the next keyframe
// finishes the last one. 0 means "no default of its own: use the beats".
export function autoStepCount(
  mode: Transition | undefined,
  changedUnits: number,
): number {
  if (!isSweep(mode) || changedUnits === 0) return 0;
  return changedUnits === 1 ? 1 : changedUnits - 1;
}

// The times of the in-betweens between two keyframes.
//   custom: `from.stepCount` of them, spread evenly
//   auto:   `autoCount` of them when the preset has a default speed of its
//           own (see autoStepCount), otherwise one per beat
//   beat:   one per beat
export function inbetweenTimes(
  analysis: AudioAnalysis,
  from: Frame,
  to: Frame,
  autoCount: number,
): number[] {
  const timing = from.stepTiming ?? "auto";
  if (timing === "custom" && from.stepCount !== undefined) {
    return evenTimes(from.time, to.time, Math.max(0, Math.floor(from.stepCount)));
  }
  if (timing === "auto" && autoCount > 0) {
    return evenTimes(from.time, to.time, autoCount);
  }
  return beatsBetween(analysis, from.time, to.time);
}

// How close a hand-made in-between's time has to be to count as the same
// step. 20 ms on the beat grid, tighter when in-betweens are packed closer.
export function matchTolerance(
  fromTime: number,
  toTime: number,
  times: number[],
): number {
  const all = [fromTime, ...times, toTime];
  let smallest = Infinity;
  for (let i = 1; i < all.length; i++) {
    smallest = Math.min(smallest, all[i] - all[i - 1]);
  }
  return Math.min(0.02, smallest / 2.1);
}

// The pins that differ between two keyframes, grouped into units (a tricolor
// LED's pins move as one), in pin order. An analog pin that is on in both at
// a different brightness counts too.
export function changedUnits(
  from: Frame,
  to: Frame,
  analogPins: Set<number>,
  tricolorGroups: { id: string; pins: number[] }[],
): number[][] {
  const changedPins = Array.from(new Set([...from.litPins, ...to.litPins]))
    .sort((a, b) => a - b)
    .filter((pin) => {
      const inFrom = from.litPins.includes(pin);
      const inTo = to.litPins.includes(pin);
      if (inFrom !== inTo) return true;
      return (
        inFrom &&
        analogPins.has(pin) &&
        levelOf(from.levels, pin) !== levelOf(to.levels, pin)
      );
    });
  const units: number[][] = [];
  const taken = new Set<number>();
  for (const pin of changedPins) {
    if (taken.has(pin)) continue;
    const group = tricolorGroups.find((g) => g.pins.includes(pin));
    const unit = group
      ? changedPins.filter((p) => group.pins.includes(p))
      : [pin];
    unit.forEach((p) => taken.add(p));
    units.push(unit);
  }
  return units;
}

// A frame that has `levels` only when some pin that is on needs one.
function withLevels(litPins: number[], levels: PinLevels | undefined) {
  const kept = pruneLevels(levels, litPins);
  return kept ? { levels: kept } : {};
}

// Works out the in-between frames (one per beat between two keyframes) from
// each keyframe's `transition` setting:
//   hold      no in-betweens; the lights simply stay as they are
//   ripple    pins change one at a time, spread evenly over the in-betweens
//   spin-cw / spin-ccw / outwards / inwards / wipe-* / scatter
//             like ripple, but the order follows where the pins sit on the
//             drawing (needs `positions`), or a fixed scramble for scatter
//   alternate flips between this keyframe's lights and the next one's
//   fade      analog pins dim smoothly to the next keyframe's brightness;
//             digital pins can't dim, so they switch at the halfway point
//   manual    uses the in-betweens the user made by hand (manualSteps);
//             a step with no saved lights keeps the previous step's lights
// How many in-betweens there are and when they sit comes from the keyframe's
// stepTiming (see inbetweenTimes): one per beat, or a custom count.
// `analogPins` is the set of pins the Zone Map tab marked as analog. Leave it
// out and every pin is treated as digital.
// Nothing is generated or stored for the presets. Call this whenever the
// keyframes or beats change.
export function buildInbetweens(
  analysis: AudioAnalysis,
  keyframes: Frame[],
  analogPins: Set<number> = new Set(),
  // The three pins of a tricolor LED change together (one step in a ripple),
  // and its per-frame color is carried into the in-betweens.
  tricolorGroups: { id: string; pins: number[] }[] = [],
  // Where each pin sits on the drawing (see pinPositions). Only the
  // spin / outwards / inwards / wipe presets need it.
  positions: Map<number, Point> = new Map(),
): Frame[] {
  const keys = keyframes
    .filter((f) => f.kind === "key")
    .sort((a, b) => a.time - b.time);

  const result: Frame[] = [];

  for (let i = 0; i < keys.length - 1; i++) {
    const from = keys[i];
    const to = keys[i + 1];
    const mode = from.transition ?? "hold";
    if (mode === "hold") continue;

    const units = changedUnits(from, to, analogPins, tricolorGroups);
    const beats = inbetweenTimes(
      analysis,
      from,
      to,
      autoStepCount(mode, units.length),
    );
    if (beats.length === 0) continue;

    const push = (
      index: number,
      time: number,
      litPins: number[],
      levels: PinLevels | undefined,
      colors?: Record<string, string>,
    ) =>
      result.push({
        id: `${from.id}-${index + 1}`,
        kind: "inbetween",
        sectionId: from.sectionId,
        time,
        litPins,
        ...withLevels(litPins, levels),
        ...(colors ? { tricolors: { ...colors } } : {}),
      });

    if (mode === "manual") {
      const saved = from.manualSteps ?? [];
      const tolerance = matchTolerance(from.time, to.time, beats);
      let carriedPins = from.litPins;
      let carriedLevels = from.levels;
      beats.forEach((time, index) => {
        const match = saved.find(
          (step) => Math.abs(step.time - time) < tolerance,
        );
        if (match) {
          carriedPins = [...match.litPins];
          carriedLevels = match.levels ? { ...match.levels } : undefined;
        }
        push(index, time, [...carriedPins], carriedLevels, from.tricolors);
      });
      continue;
    }

    if (mode === "fade") {
      const allPins = Array.from(
        new Set([...from.litPins, ...to.litPins]),
      ).sort((a, b) => a - b);

      beats.forEach((time, index) => {
        const t = (index + 1) / (beats.length + 1);
        const lit: number[] = [];
        const levels: PinLevels = {};

        for (const pin of allPins) {
          if (analogPins.has(pin)) {
            const a = from.litPins.includes(pin)
              ? levelOf(from.levels, pin)
              : 0;
            const b = to.litPins.includes(pin) ? levelOf(to.levels, pin) : 0;
            const level = Math.round(a + (b - a) * t);
            if (level > 0) {
              lit.push(pin);
              if (level !== FULL_LEVEL) levels[pin] = level;
            }
          } else {
            // Digital pins can't dim: they switch at the halfway point.
            const source = t >= 0.5 ? to : from;
            if (source.litPins.includes(pin)) lit.push(pin);
          }
        }
        // Colors switch halfway, like the digital pins.
        push(index, time, lit, levels, t >= 0.5 ? to.tricolors : from.tricolors);
      });
      continue;
    }

    // The units that change, in the order this preset changes them. Plain
    // ripple (and alternate, which ignores the order) goes by pin number.
    const changes = orderUnits(units, mode, positions, from.id);

    beats.forEach((time, index) => {
      const step = index + 1;

      if (mode !== "alternate") {
        const done = Math.min(
          changes.length,
          Math.round((step * changes.length) / (beats.length + 1)),
        );
        const lit = new Set(from.litPins);
        const levels: PinLevels = { ...(from.levels ?? {}) };
        // A changed pin takes the next keyframe's state, brightness included.
        for (const pin of changes.slice(0, done).flat()) {
          if (to.litPins.includes(pin)) {
            lit.add(pin);
            if (to.levels?.[pin] !== undefined) levels[pin] = to.levels[pin];
            else delete levels[pin];
          } else {
            lit.delete(pin);
            delete levels[pin];
          }
        }
        // A tricolor LED that has already changed takes the next color.
        const colors: Record<string, string> = { ...(from.tricolors ?? {}) };
        for (const group of tricolorGroups) {
          const moved = changes
            .slice(0, done)
            .flat()
            .some((p) => group.pins.includes(p));
          if (moved && to.tricolors?.[group.id]) {
            colors[group.id] = to.tricolors[group.id];
          }
        }
        push(
          index,
          time,
          Array.from(lit).sort((a, b) => a - b),
          levels,
          Object.keys(colors).length > 0 ? colors : undefined,
        );
      } else {
        // alternate: odd steps show the next keyframe, even steps the first.
        const source = step % 2 === 1 ? to : from;
        push(index, time, [...source.litPins], source.levels, source.tricolors);
      }
    });
  }

  return result;
}
// After the tempo is halved or doubled the beats change, so every keyframe
// (and every hand-made in-between) moves to the nearest beat of the new
// grid. Two keyframes never land on the same beat; the later one moves to
// the next free beat, and one that has no beat left is dropped.
export function remapFramesToBeats(frames: Frame[], beats: number[]): Frame[] {
  if (frames.length === 0 || beats.length === 0) return frames;

  const nearest = (t: number) => {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < beats.length; i++) {
      const d = Math.abs(beats[i] - t);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    return best;
  };

  const sorted = [...frames].sort((a, b) => a.time - b.time);
  const result: Frame[] = [];
  let lastIndex = -1;

  for (const frame of sorted) {
    const index = Math.max(nearest(frame.time), lastIndex + 1);
    if (index >= beats.length) break;
    lastIndex = index;

    let manualSteps = frame.manualSteps;
    if (manualSteps) {
      // Steps that land on the same beat: the later one wins.
      const byTime = new Map<number, (typeof manualSteps)[number]>();
      for (const step of manualSteps) {
        const time = beats[nearest(step.time)];
        byTime.set(time, { ...step, time });
      }
      manualSteps = Array.from(byTime.values()).sort(
        (x, y) => x.time - y.time,
      );
    }

    result.push({
      ...frame,
      time: beats[index],
      ...(manualSteps ? { manualSteps } : {}),
    });
  }

  return result;
}
