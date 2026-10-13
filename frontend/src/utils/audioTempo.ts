import type { AudioAnalysis } from "../types";

// Manual tempo correction. Beat trackers don't only make clean octave
// errors (2x/0.5x) — a song with a triplet/compound-meter feel can get
// its beat tracked at 3:2 the real tempo instead (confirmed on a slow
// soul ballad: detected 93 BPM vs. a real ~63 BPM, 93/63 ≈ 1.48 ≈ 3:2 —
// not a clean doubling, so a 2x/0.5x-only fix can't catch it). So this
// supports ANY correction factor, not just halving/doubling. Everything
// derived from tempo (beat times, tempo curve, section BPMs, overall
// BPM) is updated together so the data stays consistent for whatever
// consumes it later (pacing / Arduino codegen).

// The correction options shown in the UI. Add more here if another
// ratio of error turns up in testing — nothing else needs to change.
export const TEMPO_CORRECTIONS: { label: string; factor: number }[] = [
  { label: "½×", factor: 0.5 },
  { label: "⅔×", factor: 2 / 3 },
  { label: "1.5×", factor: 1.5 },
  { label: "2×", factor: 2 },
];

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

// Resamples the beats inside [start, end) to imply `factor`x the tempo,
// by interpolating along the ORIGINAL beat sequence at fractional
// indices — e.g. factor=2 (double tempo) samples at indices
// 0, 0.5, 1, 1.5, ... (inserting a point halfway between each original
// pair); factor=0.5 (half tempo) samples at 0, 2, 4, ... (keeping every
// other beat); factor=2/3 samples at 0, 1.5, 3, ... This generalizes to
// any ratio — 1.5x, 2/3x, etc. — not just clean halving/doubling, and
// preserves the original's tempo *shape* (speeding up/slowing down)
// rather than forcing a perfectly even new grid.
function resampleBeats(inside: number[], factor: number): number[] {
  if (inside.length < 2) return inside;

  const newCount = Math.max(1, Math.round(inside.length * factor));
  const result: number[] = [];

  for (let i = 0; i < newCount; i++) {
    const originalIndex = i / factor;
    const lo = Math.floor(originalIndex);
    const hi = Math.min(lo + 1, inside.length - 1);
    const frac = originalIndex - lo;
    const t = inside[lo] + (inside[hi] - inside[lo]) * frac;
    result.push(round3(t));
  }

  return result;
}

function scaleBeats(
  beatTimes: number[],
  start: number,
  end: number,
  factor: number,
) {
  const before = beatTimes.filter((t) => t < start);
  const inside = beatTimes.filter((t) => t >= start && t < end);
  const after = beatTimes.filter((t) => t >= end);

  return [...before, ...resampleBeats(inside, factor), ...after];
}

function scaleRange(
  analysis: AudioAnalysis,
  start: number,
  end: number,
  factor: number,
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

export function scaleAllTempo(analysis: AudioAnalysis, factor: number) {
  return scaleRange(analysis, 0, analysis.duration + 1, factor);
}

export function scaleSectionTempo(
  analysis: AudioAnalysis,
  sectionId: string,
  factor: number,
) {
  const section = analysis.sections.find((item) => item.id === sectionId);
  if (!section) return analysis;
  return scaleRange(analysis, section.start, section.end, factor);
}

// Manual BPM entry — for when detection didn't just land on the wrong
// RATIO (which scaleAllTempo/scaleSectionTempo above fix by rescaling
// the real detected rhythm), but got the beats themselves wrong, with
// no clean relationship to the real tempo worth preserving. Rather than
// just overwriting the displayed bpm number, this generates a genuinely
// fresh, perfectly even beat grid at the typed tempo and replaces the
// old (presumed-bad) beats in that range outright — so beatTimes stays
// the real source of truth that SequenceEditor/audioTiming actually use,
// not just a label that's gone out of sync with them.
function evenBeatGrid(start: number, end: number, bpm: number): number[] {
  if (bpm <= 0) return [];
  const gap = 60 / bpm;
  const beats: number[] = [];
  for (let t = start; t < end; t += gap) beats.push(round3(t));
  return beats;
}

function setRangeTempo(
  analysis: AudioAnalysis,
  start: number,
  end: number,
  bpm: number,
): AudioAnalysis {
  const before = analysis.beatTimes.filter((t) => t < start);
  const after = analysis.beatTimes.filter((t) => t >= end);
  const beatTimes = [...before, ...evenBeatGrid(start, end, bpm), ...after];
  const tempoCurve = localBpm(beatTimes);

  const sections = analysis.sections.map((section) =>
    section.start >= start && section.end <= end
      ? { ...section, bpm: round1(bpm) }
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

export function setAllTempo(analysis: AudioAnalysis, bpm: number) {
  return setRangeTempo(analysis, 0, analysis.duration + 1, bpm);
}

export function setSectionTempo(
  analysis: AudioAnalysis,
  sectionId: string,
  bpm: number,
) {
  const section = analysis.sections.find((item) => item.id === sectionId);
  if (!section) return analysis;
  return setRangeTempo(analysis, section.start, section.end, bpm);
}
