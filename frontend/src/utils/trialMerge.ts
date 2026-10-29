import { stable } from "../lib/cloudSync";
import type { DesignPiece, RoundPiece } from "../components/TrialWorkspace";
import type { BpmChange, Frame, PinMapping, TricolorGroup, Zone } from "../types";

// Adding the Trial to a real round is a three-way merge, not a copy:
//   base  = what the real piece looked like when the trial was started
//   trial = what the user made in the trial
//   real  = what the real piece looks like right now
// Only what the trial changed compared with `base` (items added, edited or
// removed) is applied on top of `real`. Anything the trial never touched stays
// exactly as the real round has it, including changes other people made in
// the real round while the trial was open.

export type MergePart = {
  label: string;
  added: number;
  changed: number;
  removed: number;
  // Items changed in BOTH the trial and the real round since the trial
  // started. The trial's version wins, because the user chose to add it.
  conflicts: number;
};

type ListResult<T> = { items: T[]; part: MergePart };

function mergeList<T>(
  label: string,
  base: T[],
  trial: T[],
  real: T[],
  keyOf: (item: T) => string,
): ListResult<T> {
  const byKey = (list: T[]) => new Map(list.map((item) => [keyOf(item), item]));
  const baseMap = byKey(base);
  const trialMap = byKey(trial);
  const out = byKey(real); // start from the real round, keeps its order

  const part: MergePart = { label, added: 0, changed: 0, removed: 0, conflicts: 0 };
  const keys = new Set([...baseMap.keys(), ...trialMap.keys()]);

  for (const key of keys) {
    const b = baseMap.get(key);
    const t = trialMap.get(key);
    const r = out.get(key);

    if (b !== undefined && t === undefined) {
      // The trial removed it.
      if (r !== undefined) {
        if (stable(r) !== stable(b)) part.conflicts += 1;
        out.delete(key);
        part.removed += 1;
      }
    } else if (b === undefined && t !== undefined) {
      // The trial added it.
      if (r === undefined) {
        out.set(key, t);
        part.added += 1;
      } else if (stable(r) !== stable(t)) {
        out.set(key, t);
        part.changed += 1;
        part.conflicts += 1;
      }
    } else if (b !== undefined && t !== undefined) {
      if (stable(t) === stable(b)) continue; // the trial left it alone
      const realMoved = r === undefined || stable(r) !== stable(b);
      if (r !== undefined && stable(r) === stable(t)) continue; // already the same
      out.set(key, t);
      part.changed += 1;
      if (realMoved) part.conflicts += 1;
    }
  }

  return { items: [...out.values()], part };
}

// A single value: the trial's if the trial changed it, otherwise the real one.
function pick<T>(base: T, trial: T, real: T): { value: T; changed: boolean } {
  const changed = stable(trial) !== stable(base);
  return { value: changed ? trial : real, changed };
}

function parse<T>(base: string): T {
  try {
    return JSON.parse(base) as T;
  } catch {
    return {} as T;
  }
}

const active = (parts: MergePart[]) =>
  parts.filter((p) => p.added || p.changed || p.removed);

export type DesignMerge = { piece: DesignPiece; parts: MergePart[]; conflicts: number };
export type RoundMerge = { piece: RoundPiece; parts: MergePart[]; conflicts: number };

export function mergeDesign(
  baseJson: string,
  trial: DesignPiece,
  real: DesignPiece,
): DesignMerge {
  const base = parse<Partial<DesignPiece>>(baseJson);

  const zones = mergeList<Zone>(
    "Zones",
    base.zones ?? [],
    trial.zones ?? [],
    real.zones ?? [],
    (z) => String(z.id),
  );
  zones.items.sort((a, b) => a.id - b.id);

  const pins = mergeList<PinMapping>(
    "Pins",
    base.pinMappings ?? [],
    trial.pinMappings,
    real.pinMappings,
    (p) => String(p.zoneId),
  );
  const tricolors = mergeList<TricolorGroup>(
    "Tricolor merges",
    base.tricolorGroups ?? [],
    trial.tricolorGroups,
    real.tricolorGroups,
    (g) => g.id,
  );

  const width = pick(base.imageWidth, trial.imageWidth, real.imageWidth);
  const height = pick(base.imageHeight, trial.imageHeight, real.imageHeight);

  // No zones left: report "no zones" so the real project clears them properly.
  const noZones = zones.items.length === 0;
  const piece: DesignPiece = {
    zones: noZones ? undefined : zones.items,
    imageWidth: noZones ? undefined : width.value,
    imageHeight: noZones ? undefined : height.value,
    pinMappings: pins.items,
    tricolorGroups: tricolors.items,
  };

  const parts = active([zones.part, pins.part, tricolors.part]);
  return {
    piece,
    parts,
    conflicts: zones.part.conflicts + pins.part.conflicts + tricolors.part.conflicts,
  };
}

export function mergeRound(
  baseJson: string,
  trial: RoundPiece,
  real: RoundPiece,
): RoundMerge {
  const base = parse<Partial<RoundPiece>>(baseJson);

  const frames = mergeList<Frame>(
    "Keyframes",
    base.frames ?? [],
    trial.frames,
    real.frames,
    (f) => f.id,
  );
  // The editor keeps keyframes in time order, so the merged list does too.
  frames.items.sort((a, b) => a.time - b.time);

  const bpm = mergeList<BpmChange>(
    "Tempo changes",
    base.bpmChanges ?? [],
    trial.bpmChanges ?? [],
    real.bpmChanges ?? [],
    (c) => String(c.beatTime),
  );
  bpm.items.sort((a, b) => a.beatTime - b.beatTime);

  const mode = pick(base.timingMode, trial.timingMode, real.timingMode);

  const piece: RoundPiece = {
    frames: frames.items,
    timingMode: mode.value,
    bpmChanges:
      bpm.items.length === 0 &&
      trial.bpmChanges === undefined &&
      real.bpmChanges === undefined
        ? undefined
        : bpm.items,
  };

  const parts = active([frames.part, bpm.part]);
  if (mode.changed && stable(mode.value) !== stable(real.timingMode)) {
    parts.push({
      label: "Timing mode",
      added: 0,
      changed: 1,
      removed: 0,
      conflicts: 0,
    });
  }
  return { piece, parts, conflicts: frames.part.conflicts + bpm.part.conflicts };
}

export function describeParts(parts: MergePart[]): string {
  return parts
    .map((p) => {
      const bits = [
        p.added ? `${p.added} added` : "",
        p.changed ? `${p.changed} changed` : "",
        p.removed ? `${p.removed} removed` : "",
      ].filter(Boolean);
      return `${p.label}: ${bits.join(", ")}`;
    })
    .join(" · ");
}
