import type { AudioAnalysis, Frame } from "../types";

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

// Works out the in-between frames (one per beat between two keyframes) from
// each keyframe's `transition` setting:
//   hold      no in-betweens; the lights simply stay as they are
//   ripple    pins change one at a time, spread evenly over the beats
//   alternate flips between this keyframe's lights and the next one's
//   manual    uses the in-betweens the user made by hand (manualSteps);
//             a beat with no saved step keeps the previous beat's lights
// Nothing is generated or stored for the presets. Call this whenever the keyframes or beats change.
export function buildInbetweens(
  analysis: AudioAnalysis,
  keyframes: Frame[],
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

    if (mode === "manual") {
      const saved = from.manualSteps ?? [];
      let carried = from.litPins;
      beats.forEach((time, index) => {
        const match = saved.find((step) => Math.abs(step.time - time) < 0.02);
        const litPins = match ? [...match.litPins] : [...carried];
        carried = litPins;
        result.push({
          id: `${from.id}-${index + 1}`,
          kind: "inbetween",
          sectionId: from.sectionId,
          time,
          litPins,
        });
      });
      continue;
    }

    // Pins that are on in one keyframe but not the other, lowest first.
    const changes = Array.from(new Set([...from.litPins, ...to.litPins]))
      .sort((a, b) => a - b)
      .filter((pin) => from.litPins.includes(pin) !== to.litPins.includes(pin));

    beats.forEach((time, index) => {
      const step = index + 1;
      let litPins: number[];

      if (mode === "ripple") {
        const done = Math.min(
          changes.length,
          Math.round((step * changes.length) / (beats.length + 1)),
        );
        const lit = new Set(from.litPins);
        for (const pin of changes.slice(0, done)) {
          if (lit.has(pin)) lit.delete(pin);
          else lit.add(pin);
        }
        litPins = Array.from(lit).sort((a, b) => a - b);
      } else {
        litPins = step % 2 === 1 ? [...to.litPins] : [...from.litPins];
      }

      result.push({
        id: `${from.id}-${step}`,
        kind: "inbetween",
        sectionId: from.sectionId,
        time,
        litPins,
      });
    });
  }

  return result;
}
