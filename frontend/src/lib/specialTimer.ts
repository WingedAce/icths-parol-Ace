// The Special Round's clock. One shared start time lives in Supabase (see
// supabase/migrations/..._special_round_timer.sql); every device works out the
// same remaining time from it and the server clock, so nobody has an
// independent countdown. Pure functions only, no imports.

export const DEFAULT_DURATION_MIN = 15;
export const MIN_DURATION_MIN = 1;
export const MAX_DURATION_MIN = 60;

/**
 * The "GET READY!" countdown (10, 9, ... 1) before the minutes start. It is
 * part of the run: it begins at the shared start time, and the round's
 * minutes begin LEAD_IN_MS later, so every device sees the same number.
 */
export const LEAD_IN_MS = 10_000;

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
  /** True during the 10-second GET READY! countdown (minutes not started). */
  counting: boolean;
  /** Time left in the GET READY! countdown (0 once the minutes have started). */
  countdownMs: number;
};

/** When the minutes start running (after the GET READY! countdown). */
export function runBeginsAt(run: SpecialRun): number {
  return run.startedAt + LEAD_IN_MS;
}

/** When the round ends: the GET READY! countdown plus the full duration. */
export function runEndsAt(run: SpecialRun): number {
  return run.startedAt + LEAD_IN_MS + run.durationMs;
}

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

/**
 * Time left at `now` (server-adjusted ms). Never negative, never above the
 * total. During the GET READY! countdown the full duration is shown.
 */
export function timerAt(run: SpecialRun, now: number): SpecialTimer {
  const endsAt = runEndsAt(run);
  const remainingMs = Math.min(run.durationMs, Math.max(0, endsAt - now));
  const countdownMs = Math.max(0, runBeginsAt(run) - now);
  return {
    totalMs: run.durationMs,
    remainingMs,
    finished: now >= endsAt,
    counting: countdownMs > 0,
    countdownMs,
  };
}

/** "MM:SS", rounded up so 0:00 only shows when time is really up. */
export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
