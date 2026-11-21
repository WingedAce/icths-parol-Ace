import { useCallback, useEffect, useState } from "react";

import {
  fetchSpecialRoundSong,
  fetchSpecialRoundStatus,
  type SpecialRoundStatus,
  type SpecialSong,
} from "./specialRound";

const POLL_MS = 30_000;

const START: SpecialRoundStatus = {
  unlocked: false,
  epoch: 0,
  songVersion: null,
  clockOffset: 0,
};

// Reads the shared Special Round settings and keeps them fresh: every 30
// seconds, and again whenever the tab becomes visible. The (large) song is
// only downloaded when its version changes. If the database can't be reached
// the last known values are kept (locked until the deadline if none yet).
export function useSpecialRound() {
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
        prev.clockOffset === next.clockOffset
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
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

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
    setSongLocal: (next: SpecialSong | null) => setSong(next),
  };
}

// "Now", adjusted to the server clock, ticking once a second while `active`.
export function useServerNow(active: boolean, clockOffset: number) {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    const tick = () => setNow(Date.now() + clockOffset);
    tick();
    if (!active) return;
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active, clockOffset]);
  return now;
}
