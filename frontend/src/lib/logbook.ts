import { deleteAudio, loadAudio, saveAudio } from "./audioStore";
import type { LogbookEntry, ProjectNode } from "../types";

// The logbook keeps the three Timed mode attempts the group wants to remember.
export const LOGBOOK_MAX = 3;

// Where an attempt's own copy of the song file lives in the audio store.
export const logbookAudioId = (entryId: string) => `logbook-${entryId}`;

// Copies the Timed mode song file so the attempt still has sound after the
// Timed mode slot is cleared. Returns false when there was nothing to copy or
// the copy failed (the attempt is still kept, just silent).
export async function copyAudioToLogbook(
  fromId: string,
  entryId: string,
): Promise<boolean> {
  try {
    const blob = await loadAudio(fromId);
    if (!blob) return false;
    await saveAudio(logbookAudioId(entryId), blob);
    return true;
  } catch {
    return false;
  }
}

export function removeLogbookAudio(entryId: string) {
  deleteAudio(logbookAudioId(entryId)).catch(() => {});
}

// A full copy of the finished attempt in the Timed mode slot.
export function makeLogbookEntry(
  slot: ProjectNode,
  minutes: number,
): LogbookEntry {
  return {
    id: crypto.randomUUID(),
    savedAt: Date.now(),
    minutes,
    songName: slot.audioFileName || "Song",
    frames: slot.frames ?? [],
    audioAnalysis: slot.audioAnalysis,
    timingMode: slot.timingMode,
    bpmChanges: slot.bpmChanges,
  };
}

