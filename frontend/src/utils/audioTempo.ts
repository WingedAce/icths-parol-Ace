import type { AudioAnalysis } from "../types";

// Manual tempo correction. Beat trackers commonly lock onto double or half
// the real tempo, so the student can flip the whole song, or one section,
// by x2 / x0.5. Everything derived from tempo (beat times, tempo curve,
// section BPMs, overall BPM) is updated together so the data stays
// consistent for whatever consumes it later (pacing / Arduino codegen).

// Same window the backend uses in _local_bpm (main.py).
const TEMPO_WINDOW_BEATS = 8;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// Mirrors backend _local_bpm: BPM around each beat from the median of
// nearby beat gaps.
export function localBpm(beatTimes: number[]) {
  if (beatTimes.length < 2) return [];

  const gaps = beatTimes.slice(1).map((t, i) => t - beatTimes[i]);
  const half = Math.floor(TEMPO_WINDOW_BEATS / 2);

  const curve = gaps.map((_, i) => {
    const gap = median(gaps.slice(Math.max(0, i - half), i + half + 1));
    return { time: beatTimes[i], bpm: gap > 0 ? round1(60 / gap) : 0 };
  });

  curve.push({
    time: beatTimes[beatTimes.length - 1],
    bpm: curve[curve.length - 1].bpm,
  });

  return curve;
}

// Halving keeps every other beat inside the range; doubling inserts a beat
// halfway between each pair (the last one uses the first beat after the
// range, if there is one).
function scaleBeats(
  beatTimes: number[],
  start: number,
  end: number,
  factor: 0.5 | 2,
) {
  const before = beatTimes.filter((t) => t < start);
  const inside = beatTimes.filter((t) => t >= start && t < end);
  const after = beatTimes.filter((t) => t >= end);

  let scaled: number[] = [];

  if (factor === 0.5) {
    scaled = inside.filter((_, i) => i % 2 === 0);
  } else {
    inside.forEach((t, i) => {
      scaled.push(t);
      const next = i + 1 < inside.length ? inside[i + 1] : after[0];
      if (next !== undefined) scaled.push(round3((t + next) / 2));
    });
  }

  return [...before, ...scaled, ...after];
}

function scaleRange(
  analysis: AudioAnalysis,
  start: number,
  end: number,
  factor: 0.5 | 2,
): AudioAnalysis {
  const beatTimes = scaleBeats(analysis.beatTimes, start, end, factor);
  const tempoCurve = localBpm(beatTimes);

  const sections = analysis.sections.map((section) =>
    section.start >= start && section.end <= end
      ? { ...section, bpm: round1(section.bpm * factor) }
      : section,
  );

  return {
    ...analysis,
    beatTimes,
    tempoCurve,
    sections,
    bpm: round1(median(tempoCurve.map((point) => point.bpm))),
  };
}

export function scaleAllTempo(analysis: AudioAnalysis, factor: 0.5 | 2) {
  return scaleRange(analysis, 0, analysis.duration + 1, factor);
}

export function scaleSectionTempo(
  analysis: AudioAnalysis,
  sectionId: string,
  factor: 0.5 | 2,
) {
  const section = analysis.sections.find((item) => item.id === sectionId);
  if (!section) return analysis;
  return scaleRange(analysis, section.start, section.end, factor);
}
