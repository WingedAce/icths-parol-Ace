import { stable } from "../lib/cloudSync";
import type { Frame } from "../types";

const SAME_MOMENT = 0.004;

export function mergeFrames(base: Frame[], mine: Frame[], theirs: Frame[]): Frame[] {
  const baseById = new Map(base.map((f) => [f.id, f]));
  const mineIds = new Set(mine.map((f) => f.id));
  const theirsById = new Map(theirs.map((f) => [f.id, f]));
  const out: Frame[] = [];
  const kept = new Set<string>();

  for (const f of mine) {
    const b = baseById.get(f.id);
    const t = theirsById.get(f.id);
    if (!b) {
      out.push(f);
    } else if (!t) {
      if (stable(f) !== stable(b)) out.push(f);
    } else {
      out.push(stable(f) !== stable(b) ? f : t);
    }
    kept.add(f.id);
  }

  const slots = new Set(out.map((f) => Math.round(f.time / SAME_MOMENT)));
  for (const t of theirs) {
    if (kept.has(t.id) || mineIds.has(t.id) || baseById.has(t.id)) continue;
    const slot = Math.round(t.time / SAME_MOMENT);
    if (slots.has(slot)) continue;
    slots.add(slot);
    out.push(t);
  }

  return out.sort((a, b) => a.time - b.time);
}
