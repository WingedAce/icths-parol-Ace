// The Special Round's manual unlock, kept in Supabase so every device sees the
// same state (see supabase/migrations/..._special_round.sql). The deadline is
// NOT stored there: it is the fixed constant below, so a manual unlock or
// lock can never move the countdown.

import type { AudioAnalysis } from "../types";
import { ensureSession, supabase } from "./supabase";
import { notifySpecialRoundChanged } from "./specialRoundSignal";
import { clampDuration, DEFAULT_DURATION_MIN } from "./specialTimer";

// The one song every group uses in the Special Round. The mp3 is kept in the
// "audio" bucket under this id (see lib/audioStore.ts).
export const SPECIAL_SONG_ID = "special-round-song";

export type SpecialSong = {
  fileName: string;
  analysis: AudioAnalysis;
  /** What the backend first detected, for the tempo reset button. */
  original?: AudioAnalysis;
};

// December 7, 2026, 3:00 PM Philippine Time (GMT+8, Asia/Manila).
export const SPECIAL_ROUND_DEADLINE = Date.parse("2026-12-07T15:00:00+08:00");

export type SpecialRoundStatus = {
  /** The developer's manual unlock switch. */
  unlocked: boolean;
  /** How many times "Remove Special Round song" has been used. */
  epoch: number;
  /** Changes whenever the song is replaced; null when there is no song. */
  songVersion: string | null;
  /** Server clock minus this device's clock, in ms (0 if unknown). */
  clockOffset: number;
  /** Round length in minutes, shared by every group (default 15). */
  durationMin: number;
  /** Server time (ms) the official round was unlocked; null when locked. */
  runStartedAt: number | null;
  /**
   * The developers-only TEST RUN. The database only sends this to developers,
   * so for everyone else it is always null.
   */
  test: { active: boolean; startedAt: number | null } | null;
};

export async function fetchSpecialRoundStatus(): Promise<SpecialRoundStatus> {
  await ensureSession();
  const { data, error } = await supabase.rpc("special_round_status");
  if (error) throw error;
  const raw = data as {
    unlocked?: boolean;
    epoch?: number;
    song_version?: string | null;
    now?: string;
    now_ms?: number;
    duration_min?: number;
    run_started_at?: number | null;
    test?: { active?: boolean; started_at?: number | null } | null;
  } | null;
  // Prefer the exact millisecond clock; fall back to the older timestamp.
  const serverNow =
    typeof raw?.now_ms === "number"
      ? raw.now_ms
      : raw?.now
        ? Date.parse(raw.now)
        : NaN;
  return {
    unlocked: raw?.unlocked === true,
    epoch: typeof raw?.epoch === "number" ? raw.epoch : 0,
    songVersion: raw?.song_version ?? null,
    clockOffset: Number.isFinite(serverNow) ? serverNow - Date.now() : 0,
    durationMin: clampDuration(
      typeof raw?.duration_min === "number" ? raw.duration_min : DEFAULT_DURATION_MIN,
    ),
    runStartedAt:
      typeof raw?.run_started_at === "number" ? raw.run_started_at : null,
    test: raw?.test
      ? {
          active: raw.test.active === true,
          startedAt:
            typeof raw.test.started_at === "number" ? raw.test.started_at : null,
        }
      : null,
  };
}

/** Developer only (the database checks is_admin()). Sets the round length for every group. */
export async function setSpecialRoundDuration(minutes: number): Promise<void> {
  await ensureSession();
  const { error } = await supabase.rpc("special_round_set_duration", {
    p_minutes: clampDuration(minutes),
  });
  if (error) throw error;
  void notifySpecialRoundChanged();
}

/**
 * Developer only (the database checks is_admin()). Starts or ends the TEST
 * RUN. It never touches the unlock switch or the deadline.
 */
export async function setSpecialRoundTest(active: boolean): Promise<void> {
  await ensureSession();
  const { error } = await supabase.rpc("special_round_test_set", {
    p_active: active,
  });
  if (error) throw error;
  void notifySpecialRoundChanged();
}

/** Developer only (the database checks is_admin()). The only thing that lets groups use the round. */
export async function setSpecialRoundUnlocked(unlocked: boolean): Promise<void> {
  await ensureSession();
  const { error } = await supabase.rpc("special_round_set", {
    p_unlocked: unlocked,
  });
  if (error) throw error;
  void notifySpecialRoundChanged();
}

export async function fetchSpecialRoundSong(): Promise<SpecialSong | null> {
  await ensureSession();
  const { data, error } = await supabase.rpc("special_round_song_get");
  if (error) throw error;
  const raw = data as Partial<SpecialSong> | null;
  if (!raw || !raw.analysis) return null;
  return {
    fileName: raw.fileName ?? "",
    analysis: raw.analysis,
    original: raw.original,
  };
}

/** Developer only. Replaces the song for every group, or removes it (null). */
export async function setSpecialRoundSong(song: SpecialSong | null): Promise<void> {
  await ensureSession();
  const { error } = await supabase.rpc("special_round_set_song", {
    p_song: song,
  });
  if (error) throw error;
}

/**
 * Developer only. Removes the song AND makes every group clear its Special
 * Round keyframes (each group does it the next time it opens the round).
 * Replacing the song uses setSpecialRoundSong instead and keeps keyframes.
 */
export async function removeSpecialRoundSongAndKeyframes(): Promise<void> {
  await ensureSession();
  const { error } = await supabase.rpc("special_round_remove_song");
  if (error) throw error;
}

export type Countdown = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** True once the deadline has been reached. */
  done: boolean;
};

/** Time left until the fixed deadline, never negative. */
export function countdownAt(now: number): Countdown {
  const left = Math.max(0, SPECIAL_ROUND_DEADLINE - now);
  const total = Math.floor(left / 1000);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    done: left <= 0,
  };
}
