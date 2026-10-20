import type { PinLevels } from "../types";

// The pins a user copied from a keyframe on the Preview tab. It lives here
// (not inside a keyframe or a component) so it survives moving to another
// keyframe, switching tabs, and the editor re-mounting. It is never saved to
// Supabase, so it can't change any saved project data. It is cleared when the
// page is reloaded.

export type PinClipboard = {
  litPins: number[];
  levels?: PinLevels;
};

let clipboard: PinClipboard | null = null;

export function getPinClipboard(): PinClipboard | null {
  return clipboard;
}

export function setPinClipboard(next: PinClipboard | null) {
  clipboard = next
    ? {
        litPins: [...next.litPins],
        ...(next.levels ? { levels: { ...next.levels } } : {}),
      }
    : null;
}
