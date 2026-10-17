// The color lock for each group, stored in Supabase so it is the SAME lock on
// every device. The browser never sees the saved combo: it only asks the
// database "is this combo right?" (see supabase/migrations/..._color_locks.sql).

import { ensureSession, supabase } from "./supabase";

export type ColorLockStatus = {
  /** Has this group made its color lock yet? */
  exists: boolean;
  /** When the 24-hour lockout ends (ms), or null when not locked out. */
  lockedUntil: number | null;
  /** Wrong guesses still allowed before the lockout. */
  failsLeft: number;
};

export type ColorLockCheck = ColorLockStatus & { ok: boolean };

type Raw = {
  exists?: boolean;
  ok?: boolean;
  created?: boolean;
  locked_until: string | null;
  fails_left: number;
};

function toStatus(raw: Raw): ColorLockStatus {
  return {
    exists: !!raw.exists,
    lockedUntil: raw.locked_until ? new Date(raw.locked_until).getTime() : null,
    failsLeft: raw.fails_left,
  };
}

const joinCombo = (combo: readonly string[]) => combo.join(",");

export async function getColorLockStatus(
  groupId: string,
): Promise<ColorLockStatus> {
  await ensureSession();
  const { data, error } = await supabase.rpc("color_lock_status", {
    p_group_id: groupId,
  });
  if (error) throw error;
  return toStatus(data as Raw);
}

/** Saves the group's combo. Returns false if another device made one first. */
export async function createColorLock(
  groupId: string,
  combo: readonly string[],
): Promise<boolean> {
  await ensureSession();
  const { data, error } = await supabase.rpc("color_lock_create", {
    p_group_id: groupId,
    p_combo: joinCombo(combo),
  });
  if (error) throw error;
  return !!(data as Raw).created;
}

export async function checkColorLock(
  groupId: string,
  combo: readonly string[],
): Promise<ColorLockCheck> {
  await ensureSession();
  const { data, error } = await supabase.rpc("color_lock_check", {
    p_group_id: groupId,
    p_combo: joinCombo(combo),
  });
  if (error) throw error;
  return { ...toStatus(data as Raw), ok: !!(data as Raw).ok };
}

/** Developer only: ids of every group that has a color lock. */
export async function listColorLockedGroups(): Promise<Set<string>> {
  const { data, error } = await supabase.rpc("color_lock_list");
  if (error) throw error;
  return new Set((data as string[] | null) ?? []);
}

/** Developer only: forgets the combo + lockout of these groups. */
export async function resetColorLocks(groupIds: string[]): Promise<void> {
  const { error } = await supabase.rpc("color_lock_reset", {
    p_group_ids: groupIds,
  });
  if (error) throw error;
}
