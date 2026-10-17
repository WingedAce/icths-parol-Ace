// Access-lock helpers: the color-combo constants, the per-tab "passed the lock"
// flag, and the (legacy) developer PIN.
//
// The group color lock itself is stored in Supabase (lib/colorLock.ts) so
// there is ONE lock per group on every device. The developer PIN code below is
// the old browser-only version and is kept in this browser's localStorage.

const HOUR_MS = 60 * 60 * 1000;

// Student color combo lock
export const COLOR_COMBO_LENGTH = 7; // clicks needed (repeats allowed)
export const COLOR_MAX_FAILS = 3; // wrong combos before the lockout
export const COLOR_LOCKOUT_MS = 24 * HOUR_MS; // "lock it for a day"

// Developer PIN
export const DEV_PIN_MIN_LENGTH = 4;
export const DEV_PIN_MAX_LENGTH = 8;
export const DEV_MAX_FAILS = 2; // wrong guesses before the prompt disappears
export const DEV_LOCKOUT_MS = 24 * HOUR_MS; // how long the prompt stays gone

export type LockKind = "color" | "pin";

const CONFIG = {
  color: {
    secretKey: "parol.colorLock.secret.v1",
    attemptsKey: "parol.colorLock.attempts.v1",
    maxFails: COLOR_MAX_FAILS,
    lockoutMs: COLOR_LOCKOUT_MS,
  },
  pin: {
    secretKey: "parol.devPin.secret.v1",
    attemptsKey: "parol.devPin.attempts.v1",
    maxFails: DEV_MAX_FAILS,
    lockoutMs: DEV_LOCKOUT_MS,
  },
} as const;

// Groups whose color lock was passed in this tab; lets the workspace page tell
// a student who came through the lock from someone typing a direct URL.
// sessionStorage = per tab, cleared when the tab/browser closes.
const SESSION_KEY = "parol.session.pass.v1";

type Secret = { salt: string; hash: string };
type Attempts = { fails: number; lockedUntil: number | null };

export type LockState = {
  /** Timestamp (ms) the lockout ends, or null when not locked out. */
  lockedUntil: number | null;
  /** Wrong guesses still allowed before a lockout. */
  failsLeft: number;
};

// ---------- storage helpers ----------

// Each group URL has its own color lock, so its data lives under its own key.
function keyFor(base: string, scope?: string): string {
  return scope ? `${base}:${scope}` : base;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeKey(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ---------- hashing ----------

function randomSalt(): string {
  try {
    const bytes = window.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  }
}

async function hashSecret(salt: string, value: string): Promise<string> {
  const text = `${salt}:${value}`;

  try {
    if (window.crypto?.subtle) {
      const digest = await window.crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(text),
      );
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    // fall through to the simple hash below
  }

  // Fallback for non-secure contexts where crypto.subtle is unavailable.
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a ^= c;
    a = Math.imul(a, 0x01000193);
    b ^= c;
    b = Math.imul(b, 0x85ebca6b);
  }
  return `f${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

async function saveSecret(
  kind: LockKind,
  value: string,
  scope?: string,
): Promise<boolean> {
  const salt = randomSalt();
  const hash = await hashSecret(salt, value);
  return writeJson(keyFor(CONFIG[kind].secretKey, scope), {
    salt,
    hash,
  } satisfies Secret);
}

async function checkSecret(
  kind: LockKind,
  value: string,
  scope?: string,
): Promise<boolean> {
  const secret = readJson<Secret>(keyFor(CONFIG[kind].secretKey, scope));
  if (!secret) return false;
  return (await hashSecret(secret.salt, value)) === secret.hash;
}

// NOTE: each group's color combo is NOT stored here. It lives in Supabase so
// it is the same lock on every device (see lib/colorLock.ts).

// ---------- developer PIN ----------

export function hasDevPin(): boolean {
  return readJson<Secret>(CONFIG.pin.secretKey) !== null;
}

export function saveDevPin(pin: string): Promise<boolean> {
  return saveSecret("pin", pin);
}

export function checkDevPin(pin: string): Promise<boolean> {
  return checkSecret("pin", pin);
}

// ---------- wrong-guess counters + lockouts ----------

export function getLockState(kind: LockKind, scope?: string): LockState {
  const cfg = CONFIG[kind];
  const attemptsKey = keyFor(cfg.attemptsKey, scope);
  const attempts = readJson<Attempts>(attemptsKey);

  if (!attempts) {
    return { lockedUntil: null, failsLeft: cfg.maxFails };
  }

  if (attempts.lockedUntil && attempts.lockedUntil > Date.now()) {
    return { lockedUntil: attempts.lockedUntil, failsLeft: 0 };
  }

  if (attempts.lockedUntil) {
    // The lockout has run out: start fresh.
    removeKey(attemptsKey);
    return { lockedUntil: null, failsLeft: cfg.maxFails };
  }

  return {
    lockedUntil: null,
    failsLeft: Math.max(0, cfg.maxFails - attempts.fails),
  };
}

/** Records one wrong guess and returns the updated state. */
export function registerFailure(kind: LockKind, scope?: string): LockState {
  const cfg = CONFIG[kind];
  const attemptsKey = keyFor(cfg.attemptsKey, scope);
  const current = getLockState(kind, scope);
  if (current.lockedUntil) return current;

  const previous = readJson<Attempts>(attemptsKey)?.fails ?? 0;
  const fails = previous + 1;

  if (fails >= cfg.maxFails) {
    const lockedUntil = Date.now() + cfg.lockoutMs;
    writeJson(attemptsKey, { fails, lockedUntil } satisfies Attempts);
    return { lockedUntil, failsLeft: 0 };
  }

  writeJson(attemptsKey, { fails, lockedUntil: null } satisfies Attempts);
  return { lockedUntil: null, failsLeft: cfg.maxFails - fails };
}

export function clearFailures(kind: LockKind, scope?: string) {
  removeKey(keyFor(CONFIG[kind].attemptsKey, scope));
}

// ---------- per-tab "passed this group's color lock" flag ----------

function readPassedGroups(): string[] {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function grantSessionPass(groupId: string) {
  try {
    const passed = readPassedGroups();
    if (!passed.includes(groupId)) passed.push(groupId);
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(passed));
  } catch {
    // ignore
  }
}

export function hasSessionPass(groupId: string): boolean {
  return readPassedGroups().includes(groupId);
}

export function formatUnlockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}