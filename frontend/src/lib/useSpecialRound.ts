import { useCallback, useEffect, useState } from "react";

import {
  fetchSpecialRoundSong,
  fetchSpecialRoundStatus,
  type SpecialRoundStatus,
  type SpecialSong,
} from "./specialRound";
import { onSpecialRoundSignal } from "./specialRoundSignal";
import { DEFAULT_DURATION_MIN } from "./specialTimer";

// How often the shared settings are re-read. 30 s normally; callers that show
// the live round (the Special Round tab, the Developer Window) ask for faster
// so a unlock / TEST RUN / timer change reaches them within a few seconds.
const POLL_MS = 30_000;

const START: SpecialRoundStatus = {
  unlocked: false,
  epoch: 0,
  songVersion: null,
  clockOffset: 0,
  durationMin: DEFAULT_DURATION_MIN,
  runStartedAt: null,
  test: null,
};

const sameTest = (
  a: SpecialRoundStatus["test"],
  b: SpecialRoundStatus["test"],
) => a?.active === b?.active && a?.startedAt === b?.startedAt;

// Reads the shared Special Round settings and keeps them fresh: every 30
// seconds, and again whenever the tab becomes visible. The (large) song is
// only downloaded when its version changes. If the database can't be reached
// the last known values are kept (locked until the deadline if none yet).
export function useSpecialRound(pollMs: number = POLL_MS) {
  const [status, setStatus] = useState<SpecialRoundStatus>(START);
  const [song, setSong] = useState<SpecialSong | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchSpecialRoundStatus();
      setStatus((prev) =>
        prev.unlocked === next.unlocked &&
        prev.epoch === next.epoch &&
        prev.songVersion === next.songVersion &&
        prev.clockOffset === next.clockOffset &&
        prev.durationMin === next.durationMin &&
        prev.runStartedAt === next.runStartedAt &&
        sameTest(prev.test, next.test)
          ? prev
          : next,
      );
    } catch (error) {
      console.error("Could not load the Special Round setting:", error);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, pollMs);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, pollMs]);

  // A developer pressed TEST RUN / Unlock / changed the duration somewhere:
  // re-read right away instead of waiting for the next check.
  useEffect(() => onSpecialRoundSignal(() => void refresh()), [refresh]);

  // Download the song when it is new or has been replaced.
  useEffect(() => {
    if (!loaded) return;
    if (!status.songVersion) {
      setSong(null);
      return;
    }
    let cancelled = false;
    fetchSpecialRoundSong()
      .then((next) => {
        if (!cancelled) setSong(next);
      })
      .catch((error) => console.error("Could not load the Special Round song:", error));
    return () => {
      cancelled = true;
    };
  }, [loaded, status.songVersion]);

  return {
    ...status,
    song,
    loaded,
    refresh,
    setUnlockedLocal: (unlocked: boolean) => setStatus((p) => ({ ...p, unlocked })),
    setDurationLocal: (durationMin: number) =>
      setStatus((p) => ({ ...p, durationMin })),
    setSongLocal: (next: SpecialSong | null) => setSong(next),
  };
}

// "Now", adjusted to the server clock, ticking once a second while `active`.
export function useServerNow(
  active: boolean,
  clockOffset: number,
  intervalMs: number = 1000,
) {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    const tick = () => setNow(Date.now() + clockOffset);
    tick();
    if (!active) return;
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [active, clockOffset, intervalMs]);
  return now;
}

// True once the server-adjusted clock has reached `target` (ms), or false while
// `target` is null. Wakes up at that moment instead of ticking, so a big page
// like the workspace doesn't re-render every second just to know it.
export function useReached(target: number | null, clockOffset: number) {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  const [rearm, setRearm] = useState(0);
  useEffect(() => {
    if (target == null) return;
    const sync = () => setNow(Date.now() + clockOffset);
    // Re-read the clock right away (the server offset may have just arrived).
    const first = window.setTimeout(sync, 0);
    const wait = target - (Date.now() + clockOffset);
    // setTimeout can't wait longer than ~24 days: wake up, then wait again.
    const MAX = 2_000_000_000;
    const later =
      wait > 0
        ? window.setTimeout(() => {
            sync();
            if (wait > MAX) setRearm((n) => n + 1);
          }, Math.min(wait + 20, MAX))
        : undefined;
    return () => {
      window.clearTimeout(first);
      if (later !== undefined) window.clearTimeout(later);
    };
  }, [target, clockOffset, rearm]);
  return target != null && now >= target;
}
