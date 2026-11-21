// The Special Round's manual unlock, kept in Supabase so every device sees the
// same state (see supabase/migrations/..._special_round.sql). The deadline is
// NOT stored there: it is the fixed constant below, so a manual unlock or
// lock can never move the countdown.

import type { AudioAnalysis } from "../types";
import { ensureSession, supabase } from "./supabase";

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
  } | null;
  const serverNow = raw?.now ? Date.parse(raw.now) : NaN;
  return {
    unlocked: raw?.unlocked === true,
    epoch: typeof raw?.epoch === "number" ? raw.epoch : 0,
    songVersion: raw?.song_version ?? null,
    clockOffset: Number.isFinite(serverNow) ? serverNow - Date.now() : 0,
  };
}

/** Developer only (the database checks is_admin()). The only thing that lets groups use the round. */
export async function setSpecialRoundUnlocked(unlocked: boolean): Promise<void> {
  await ensureSession();
  const { error } = await supabase.rpc("special_round_set", {
    p_unlocked: unlocked,
  });
  if (error) throw error;
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
