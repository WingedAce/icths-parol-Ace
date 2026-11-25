// The Special Round's clock. One shared start time lives in Supabase (see
// supabase/migrations/..._special_round_timer.sql); every device works out the
// same remaining time from it and the server clock, so nobody has an
// independent countdown. Pure functions only, no imports.

export const DEFAULT_DURATION_MIN = 15;
export const MIN_DURATION_MIN = 1;
export const MAX_DURATION_MIN = 60;

/** The official round (unlock switch) or a developers-only TEST RUN. */
export type SpecialRunKind = "official" | "test";

export type SpecialRun = {
  kind: SpecialRunKind;
  /** Server time (ms since 1970) the run started. */
  startedAt: number;
  durationMs: number;
};

export type SpecialTimer = {
  totalMs: number;
  remainingMs: number;
  finished: boolean;
};

type RunSource = {
  unlocked: boolean;
  runStartedAt: number | null;
  durationMin: number;
  test: { active: boolean; startedAt: number | null } | null;
};

export function clampDuration(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_DURATION_MIN;
  return Math.min(
    MAX_DURATION_MIN,
    Math.max(MIN_DURATION_MIN, Math.round(minutes)),
  );
}

/**
 * Which run (if any) is on right now. The official round always wins over a
 * test run, so a test run can never hide or replace the real one. Returns
 * null when nothing is running (or the start time isn't known yet).
 */
export function activeRun(source: RunSource): SpecialRun | null {
  const durationMs = clampDuration(source.durationMin) * 60_000;
  if (source.unlocked) {
    return source.runStartedAt == null
      ? null
      : { kind: "official", startedAt: source.runStartedAt, durationMs };
  }
  if (source.test?.active && source.test.startedAt != null) {
    return { kind: "test", startedAt: source.test.startedAt, durationMs };
  }
  return null;
}

/** Time left at `now` (server-adjusted ms). Never negative, never above the total. */
export function timerAt(run: SpecialRun, now: number): SpecialTimer {
  const endsAt = run.startedAt + run.durationMs;
  const remainingMs = Math.min(run.durationMs, Math.max(0, endsAt - now));
  return {
    totalMs: run.durationMs,
    remainingMs,
    finished: now >= endsAt,
  };
}

/** "MM:SS", rounded up so 0:00 only shows when time is really up. */
export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
