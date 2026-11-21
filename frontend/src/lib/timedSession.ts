import { useCallback, useEffect, useState } from "react";

// Timed mode's clock. Everything is stored as wall-clock timestamps in this
// browser, so reloading the page does not reset or stop the timer: only the
// Pause button does.

export const TIMED_MINUTES = [30, 20, 15] as const;
export type TimedMinutes = (typeof TIMED_MINUTES)[number];
export const COUNTDOWN_SECONDS = 10;

export type TimedSession =
  | { status: "idle" }
  | { status: "countdown"; minutes: TimedMinutes; countdownEndsAt: number }
  | { status: "running"; minutes: TimedMinutes; endsAt: number }
  | { status: "paused"; minutes: TimedMinutes; remainingMs: number }
  // logged: this attempt was already saved to the logbook.
  | { status: "finished"; minutes: TimedMinutes; logged?: boolean };

const IDLE: TimedSession = { status: "idle" };

const isMinutes = (value: unknown): value is TimedMinutes =>
  TIMED_MINUTES.some((m) => m === value);

function read(key: string): TimedSession {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? "null") as Record<
      string,
      unknown
    > | null;
    if (!s || !isMinutes(s.minutes)) return IDLE;
    const minutes = s.minutes;
    if (s.status === "countdown" && typeof s.countdownEndsAt === "number") {
      return { status: "countdown", minutes, countdownEndsAt: s.countdownEndsAt };
    }
    if (s.status === "running" && typeof s.endsAt === "number") {
      return { status: "running", minutes, endsAt: s.endsAt };
    }
    if (s.status === "paused" && typeof s.remainingMs === "number") {
      return { status: "paused", minutes, remainingMs: s.remainingMs };
    }
    if (s.status === "finished") {
      return { status: "finished", minutes, logged: s.logged === true };
    }
  } catch {
    // storage blocked or unreadable: start fresh
  }
  return IDLE;
}

function write(key: string, session: TimedSession) {
  try {
    if (session.status === "idle") localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(session));
  } catch {
    // storage blocked: the timer still works until the page is reloaded
  }
}

// Moves a session forward in time: countdown -> running -> finished. Returns
// the same object when nothing changed.
export function advance(session: TimedSession, now: number): TimedSession {
  let current = session;
  if (current.status === "countdown" && now >= current.countdownEndsAt) {
    current = {
      status: "running",
      minutes: current.minutes,
      endsAt: current.countdownEndsAt + current.minutes * 60_000,
    };
  }
  if (current.status === "running" && now >= current.endsAt) {
    current = { status: "finished", minutes: current.minutes };
  }
  return current;
}

export function remainingMsOf(session: TimedSession, now: number): number {
  switch (session.status) {
    case "running":
      return Math.max(0, session.endsAt - now);
    case "paused":
      return session.remainingMs;
    case "finished":
      return 0;
    case "countdown":
    case "idle":
      return ("minutes" in session ? session.minutes : 0) * 60_000;
  }
}

export function countdownSecondsLeft(
  session: TimedSession,
  now: number,
): number {
  return session.status === "countdown"
    ? Math.max(0, Math.ceil((session.countdownEndsAt - now) / 1000))
    : 0;
}

export function useTimedSession(storageKey: string) {
  const [state, setState] = useState<{ key: string; session: TimedSession }>(
    () => ({ key: storageKey, session: read(storageKey) }),
  );
  const [now, setNow] = useState(() => Date.now());

  const stored =
    state.key === storageKey ? state.session : read(storageKey);
  const session = advance(stored, now);

  // Keep the saved copy in step (including countdown -> running -> finished).
  useEffect(() => {
    write(storageKey, session);
  }, [storageKey, session]);

  const ticking = session.status === "countdown" || session.status === "running";
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      setState((prev) => ({
        key: storageKey,
        session: advance(
          prev.key === storageKey ? prev.session : read(storageKey),
          t,
        ),
      }));
    }, 250);
    return () => window.clearInterval(id);
  }, [ticking, storageKey]);

  const set = useCallback(
    (next: TimedSession) => {
      setNow(Date.now());
      setState({ key: storageKey, session: next });
    },
    [storageKey],
  );

  return {
    session,
    status: session.status,
    remainingMs: remainingMsOf(session, now),
    countdownLeft: countdownSecondsLeft(session, now),
    // The song was analyzed: 10 second countdown, then the timer.
    start: (minutes: TimedMinutes) =>
      set({
        status: "countdown",
        minutes,
        countdownEndsAt: Date.now() + COUNTDOWN_SECONDS * 1000,
      }),
    pause: () => {
      if (session.status !== "running") return;
      set({
        status: "paused",
        minutes: session.minutes,
        remainingMs: Math.max(0, session.endsAt - Date.now()),
      });
    },
    play: () => {
      if (session.status !== "paused") return;
      set({
        status: "running",
        minutes: session.minutes,
        endsAt: Date.now() + session.remainingMs,
      });
    },
    // The finished attempt was saved to the logbook.
    logged: session.status === "finished" && session.logged === true,
    markLogged: () => {
      if (session.status === "finished") set({ ...session, logged: true });
    },
    reset: () => set(IDLE),
  };
}
