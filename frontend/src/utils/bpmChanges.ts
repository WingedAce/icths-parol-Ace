import type {
  AudioAnalysis,
  BpmChange,
  Frame,
  ManualStep,
  TempoSegment,
} from "../types";
import { localBpm } from "./audioTempo";
import { remapFramesToBeats } from "./audioTiming";

// BPM change points. The detected/corrected beats stay exactly as they are in
// audioAnalysis. A change point says "from this beat on, the beats are spaced
// 60 / bpm seconds apart", and the grid every other part of the app uses is
// worked out from the stored beats plus the change points, every time. Nothing
// is lost: removing a change point brings the earlier beats straight back.

// Same range for every change point. (The Song tab only checks "above 0".)
export const MIN_CHANGE_BPM = 30;
export const MAX_CHANGE_BPM = 300;

// Two times closer than this (in seconds) count as the same beat/moment.
export const SAME_BEAT = 0.02;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function isValidChangeBpm(value: number) {
  return (
    Number.isFinite(value) &&
    value >= MIN_CHANGE_BPM &&
    value <= MAX_CHANGE_BPM
  );
}

export function sortChanges(changes: BpmChange[] | undefined): BpmChange[] {
  return [...(changes ?? [])].sort((a, b) => a.beatTime - b.beatTime);
}

export function changeAt(
  changes: BpmChange[],
  beatTime: number,
): BpmChange | undefined {
  return changes.find((c) => Math.abs(c.beatTime - beatTime) < SAME_BEAT);
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// The beat grid with the change points applied:
//   - beats before the first change point are untouched
//   - from each change point to the next one (or the end of the song) the
//     beats are regenerated at that change point's BPM, the first one sitting
//     exactly on the change point
export function effectiveBeats(
  base: number[],
  duration: number,
  changes: BpmChange[],
): number[] {
  const sorted = sortChanges(changes);
  if (sorted.length === 0) return base;

  const result = base.filter((t) => t < sorted[0].beatTime - SAME_BEAT);

  sorted.forEach((change, i) => {
    const start = change.beatTime;
    const end = i + 1 < sorted.length ? sorted[i + 1].beatTime : duration;
    const gap = 60 / change.bpm;
    if (!(gap > 0)) return;

    for (let k = 0; ; k++) {
      const t = start + k * gap;
      // The first beat always stays: it is the change point itself.
      if (k > 0 && t >= end - SAME_BEAT) break;
      result.push(round3(t));
    }
  });

  return result;
}

// One entry per stretch of constant tempo. The first one is the tempo the
// song had before the first change point.
export function tempoSegments(
  analysis: AudioAnalysis,
  changes: BpmChange[],
): TempoSegment[] {
  const sorted = sortChanges(changes);
  if (sorted.length === 0) return [];

  const before = analysis.tempoCurve
    .filter((p) => p.time < sorted[0].beatTime && p.bpm > 0)
    .map((p) => p.bpm);
  const first = before.length > 0 ? round1(median(before)) : round1(analysis.bpm);

  return [
    { start: 0, bpm: first },
    ...sorted.map((c) => ({ start: c.beatTime, bpm: c.bpm })),
  ];
}

// The BPM in effect at a time, from the segments.
export function segmentBpmAt(segments: TempoSegment[], t: number): number {
  let current = segments[0];
  for (const segment of segments) {
    if (segment.start <= t + 0.001) current = segment;
    else break;
  }
  return current.bpm;
}

// The same analysis with the change points applied: new beatTimes, tempo curve
// and overall BPM, plus tempoSegments. Everything that reads beats (preview,
// gallery in-betweens, Arduino export) should be given THIS, not the stored
// analysis. With no change points it returns the stored analysis itself.
// Never save the result: it is derived.
const cache = new WeakMap<AudioAnalysis, WeakMap<BpmChange[], AudioAnalysis>>();

export function effectiveAnalysis(
  analysis: AudioAnalysis,
  changes: BpmChange[] | undefined,
): AudioAnalysis;
export function effectiveAnalysis(
  analysis: AudioAnalysis | undefined,
  changes: BpmChange[] | undefined,
): AudioAnalysis | undefined;
export function effectiveAnalysis(
  analysis: AudioAnalysis | undefined,
  changes: BpmChange[] | undefined,
): AudioAnalysis | undefined {
  if (!analysis) return undefined;
  if (!changes || changes.length === 0) return analysis;

  let inner = cache.get(analysis);
  if (!inner) {
    inner = new WeakMap();
    cache.set(analysis, inner);
  }
  const hit = inner.get(changes);
  if (hit) return hit;

  const beatTimes = effectiveBeats(analysis.beatTimes, analysis.duration, changes);
  const tempoCurve = localBpm(beatTimes);
  const result: AudioAnalysis = {
    ...analysis,
    beatTimes,
    tempoCurve,
    bpm:
      tempoCurve.length > 0
        ? round1(median(tempoCurve.map((p) => p.bpm)))
        : analysis.bpm,
    tempoSegments: tempoSegments(analysis, changes),
  };
  inner.set(changes, result);
  return result;
}

function nearestBeat(beats: number[], t: number) {
  let best = beats[0];
  let bestDistance = Infinity;
  for (const beat of beats) {
    const d = Math.abs(beat - t);
    if (d < bestDistance) {
      bestDistance = d;
      best = beat;
    }
  }
  return best;
}

// Beat timing mode: after the beats moved from `fromTime` on, snap what lies
// at or after that time onto the new beats. Keyframes (and their hand-made
// in-betweens) from that time on go through remapFramesToBeats. Keyframes
// before it are not moved, but any hand-made in-between of theirs that falls
// in the changed stretch follows the new beats too. Like the tempo
// corrections, a keyframe that has no beat left is dropped.
export function snapFramesFrom(
  frames: Frame[],
  fromTime: number,
  beats: number[],
): Frame[] {
  if (frames.length === 0 || beats.length === 0) return frames;

  const edge = fromTime - SAME_BEAT;
  const sorted = [...frames].sort((a, b) => a.time - b.time);

  const before = sorted
    .filter((f) => f.time < edge)
    .map((frame): Frame => {
      if (!frame.manualSteps) return frame;
      const kept = frame.manualSteps.filter((s) => s.time < edge);
      const byTime = new Map<number, ManualStep>();
      for (const step of frame.manualSteps) {
        if (step.time < edge) continue;
        const time = nearestBeat(beats, step.time);
        byTime.set(time, { ...step, time });
      }
      const manualSteps = [...kept, ...byTime.values()].sort(
        (a, b) => a.time - b.time,
      );
      return { ...frame, manualSteps };
    });

  const after = remapFramesToBeats(
    sorted.filter((f) => f.time >= edge),
    beats,
  );

  return [...before, ...after];
}
