import { useSyncExternalStore } from "react";

// Low Quality Mode: a per-device display setting for older or slow devices.
// It only decides which decorative effects are drawn. It is kept in this
// browser's localStorage (never in Supabase), so it never touches saved work.
const KEY = "iparol.lowQuality";

const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

// Last value seen, also used when storage is blocked so the toggle still
// works for the rest of the visit.
let current = typeof window === "undefined" ? false : read();

function emit() {
  listeners.forEach((listener) => listener());
}

export function setLowQuality(value: boolean) {
  current = value;
  try {
    if (value) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    // storage blocked: the choice lasts until the page is closed
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // another tab changed it
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    current = read();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useLowQuality(): boolean {
  return useSyncExternalStore(subscribe, () => current, () => false);
}
