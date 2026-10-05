import type { AudioAnalysis, Frame, PinLevels } from "../types";
import { FULL_LEVEL, levelOf, pruneLevels } from "./pins";

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

// A frame that has `levels` only when some pin that is on needs one.
function withLevels(litPins: number[], levels: PinLevels | undefined) {
  const kept = pruneLevels(levels, litPins);
  return kept ? { levels: kept } : {};
}

// Works out the in-between frames (one per beat between two keyframes) from
// each keyframe's `transition` setting:
//   hold      no in-betweens; the lights simply stay as they are
//   ripple    pins change one at a time, spread evenly over the beats
//   alternate flips between this keyframe's lights and the next one's
//   fade      analog pins dim smoothly to the next keyframe's brightness;
//             digital pins can't dim, so they switch at the halfway point
//   manual    uses the in-betweens the user made by hand (manualSteps);
//             a beat with no saved step keeps the previous beat's lights
// `analogPins` is the set of pins the Zone Map tab marked as analog. Leave it
// out and every pin is treated as digital.
// Nothing is generated or stored for the presets. Call this whenever the
// keyframes or beats change.
export function buildInbetweens(
  analysis: AudioAnalysis,
  keyframes: Frame[],
  analogPins: Set<number> = new Set(),
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

    const beats = beatsBetween(analysis, from.time, to.time);
    if (beats.length === 0) continue;

    const push = (
      index: number,
      time: number,
      litPins: number[],
      levels: PinLevels | undefined,
    ) =>
      result.push({
        id: `${from.id}-${index + 1}`,
        kind: "inbetween",
        sectionId: from.sectionId,
        time,
        litPins,
        ...withLevels(litPins, levels),
      });

    if (mode === "manual") {
      const saved = from.manualSteps ?? [];
      let carriedPins = from.litPins;
      let carriedLevels = from.levels;
      beats.forEach((time, index) => {
        const match = saved.find((step) => Math.abs(step.time - time) < 0.02);
        if (match) {
          carriedPins = [...match.litPins];
          carriedLevels = match.levels ? { ...match.levels } : undefined;
        }
        push(index, time, [...carriedPins], carriedLevels);
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
        push(index, time, lit, levels);
      });
      continue;
    }

    // Pins that are on in one keyframe but not the other, lowest first. An
    // analog pin that is on in both at different brightness counts too.
    const changes = Array.from(new Set([...from.litPins, ...to.litPins]))
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

    beats.forEach((time, index) => {
      const step = index + 1;

      if (mode === "ripple") {
        const done = Math.min(
          changes.length,
          Math.round((step * changes.length) / (beats.length + 1)),
        );
        const lit = new Set(from.litPins);
        const levels: PinLevels = { ...(from.levels ?? {}) };
        // A changed pin takes the next keyframe's state, brightness included.
        for (const pin of changes.slice(0, done)) {
          if (to.litPins.includes(pin)) {
            lit.add(pin);
            if (to.levels?.[pin] !== undefined) levels[pin] = to.levels[pin];
            else delete levels[pin];
          } else {
            lit.delete(pin);
            delete levels[pin];
          }
        }
        push(index, time, Array.from(lit).sort((a, b) => a - b), levels);
      } else {
        // alternate: odd beats show the next keyframe, even beats the first.
        const source = step % 2 === 1 ? to : from;
        push(index, time, [...source.litPins], source.levels);
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