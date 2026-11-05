import type { Frame } from "../types";

// Keyframes a user copied on the Preview tab. Like utils/pinClipboard.ts it
// lives outside the project data, so it is never saved and can't change any
// saved design. It is cleared when the page is reloaded.
//
// Times are stored as an offset from the first copied keyframe, so pasting
// keeps the same gaps wherever it lands.

export type KeyframeClip = Omit<Frame, "id" | "sectionId"> & { time: number };

let clipboard: KeyframeClip[] | null = null;

export function getKeyframeClipboard(): KeyframeClip[] | null {
  return clipboard;
}

// `frames` must be sorted by time.
export function setKeyframeClipboard(frames: Frame[] | null) {
  if (!frames || frames.length === 0) {
    clipboard = null;
    return;
  }
  const origin = frames[0].time;
  clipboard = frames.map((f) => {
    const rest: Partial<Frame> = structuredClone(f);
    delete rest.id;
    delete rest.sectionId;
    return {
      ...(rest as Omit<Frame, "id" | "sectionId">),
      time: f.time - origin,
      ...(f.manualSteps
        ? {
            manualSteps: f.manualSteps.map((step) => ({
              ...step,
              time: step.time - origin,
            })),
          }
        : {}),
    };
  });
}
