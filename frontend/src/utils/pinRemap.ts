import type { Frame, PinMapping, PinLevels } from "../types";
import { FULL_LEVEL, levelOf, pruneLevels } from "./pins";

// Keyframes remember which pins are on, not which zones. When a zone is moved
// to another pin (or its pin is deleted and the zone is given a new one), the
// keyframes still say the OLD pin is on, so the zone would go dark. To offer
// turning the zone back on with its new pin, the design remembers, for each
// zone, the pin it last had before it lost it.
//   { zoneId: pin the zone used to be on }
export type LostZonePins = Record<number, number>;

// Call whenever the pin mappings change. Zones that lost their pin (moved to
// another pin, or unassigned) are remembered; zones that are back on the pin
// they used to have are forgotten again.
export function updateLostPins(
  oldMappings: PinMapping[],
  newMappings: PinMapping[],
  lost: LostZonePins | undefined,
): LostZonePins | undefined {
  const before = new Map(oldMappings.map((m) => [m.zoneId, m.pin]));
  const after = new Map(newMappings.map((m) => [m.zoneId, m.pin]));
  const next: LostZonePins = { ...(lost ?? {}) };
  for (const [zoneId, pin] of before) {
    if (after.get(zoneId) !== pin) next[zoneId] = pin;
  }
  for (const [zoneId, pin] of after) {
    if (next[zoneId] === pin) delete next[zoneId];
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

// Forgets the zones that have a pin again (after the user answered the
// question, whichever way).
export function settleLostPins(
  lost: LostZonePins | undefined,
  pinMappings: PinMapping[],
): LostZonePins | undefined {
  if (!lost) return undefined;
  const mapped = new Set(pinMappings.map((m) => m.zoneId));
  const next: LostZonePins = {};
  for (const [zone, pin] of Object.entries(lost)) {
    if (!mapped.has(Number(zone))) next[Number(zone)] = pin;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export type PinMove = {
  // The pin the zones used to be on, and the pins they are on now.
  from: number;
  to: number[];
  zoneIds: number[];
};

export type PinRemapSummary = {
  moves: PinMove[];
  zoneCount: number;
  // How many keyframes would change in each list given to pendingPinRemaps.
  keyframesPerList: number[];
  keyframeCount: number;
};

// Every zone that has a new pin and used to be on another pin.
function movesOf(
  pinMappings: PinMapping[],
  lost: LostZonePins | undefined,
): PinMove[] {
  if (!lost) return [];
  const zonePin = new Map(pinMappings.map((m) => [m.zoneId, m.pin]));
  const byFrom = new Map<number, { to: Set<number>; zoneIds: number[] }>();
  for (const [zone, from] of Object.entries(lost)) {
    const zoneId = Number(zone);
    const now = zonePin.get(zoneId);
    if (now === undefined || now === from) continue;
    const entry = byFrom.get(from) ?? { to: new Set<number>(), zoneIds: [] };
    entry.to.add(now);
    entry.zoneIds.push(zoneId);
    byFrom.set(from, entry);
  }
  return Array.from(byFrom.entries())
    .map(([from, e]) => ({
      from,
      to: Array.from(e.to).sort((a, b) => a - b),
      zoneIds: e.zoneIds.sort((a, b) => a - b),
    }))
    .sort((a, b) => a.from - b.from);
}

type Targets = Map<number, Set<number>>;

function targetsOf(moves: PinMove[]): Targets {
  return new Map(moves.map((m) => [m.from, new Set(m.to)]));
}

// Pins that are on in `litPins` only through the old pin, and so would need
// the new pin added.
function needsChange(litPins: number[], targets: Targets): boolean {
  for (const [from, to] of targets) {
    if (!litPins.includes(from)) continue;
    for (const pin of to) if (!litPins.includes(pin)) return true;
  }
  return false;
}

function frameNeedsChange(frame: Frame, targets: Targets): boolean {
  return (
    needsChange(frame.litPins, targets) ||
    (frame.manualSteps ?? []).some((s) => needsChange(s.litPins, targets))
  );
}

// What would change if the user said yes, or null when nothing would.
// `frameLists` is one list of keyframes per round.
export function pendingPinRemaps(
  pinMappings: PinMapping[],
  lost: LostZonePins | undefined,
  frameLists: Frame[][],
): PinRemapSummary | null {
  const moves = movesOf(pinMappings, lost);
  if (moves.length === 0) return null;
  const targets = targetsOf(moves);
  const keyframesPerList = frameLists.map(
    (frames) => frames.filter((f) => frameNeedsChange(f, targets)).length,
  );
  const keyframeCount = keyframesPerList.reduce((a, b) => a + b, 0);
  if (keyframeCount === 0) return null;
  return {
    moves,
    zoneCount: moves.reduce((sum, m) => sum + m.zoneIds.length, 0),
    keyframesPerList,
    keyframeCount,
  };
}

// Turns the new pins on wherever the old pin was on. The old pin is dropped
// from the keyframes once nothing uses it and no zone is waiting to be given
// a new pin; until then it stays so the other zones can still be offered.
export function applyPinRemaps(
  frames: Frame[],
  pinMappings: PinMapping[],
  lost: LostZonePins | undefined,
  analog: Set<number>,
): Frame[] {
  const moves = movesOf(pinMappings, lost);
  if (moves.length === 0) return frames;
  const targets = targetsOf(moves);

  const stillMapped = new Set(pinMappings.map((m) => m.pin));
  const waiting = new Set(
    Object.entries(lost ?? {})
      .filter(([zone]) => !pinMappings.some((m) => m.zoneId === Number(zone)))
      .map(([, pin]) => pin),
  );
  const removable = (pin: number) => !stillMapped.has(pin) && !waiting.has(pin);

  const remap = (
    litPins: number[],
    levels: PinLevels | undefined,
  ): { litPins: number[]; levels: PinLevels | undefined } => {
    const lit = new Set(litPins);
    const nextLevels: PinLevels = { ...(levels ?? {}) };
    for (const [from, to] of targets) {
      if (!litPins.includes(from)) continue;
      for (const pin of to) {
        lit.add(pin);
        // A dimmable pin takes over the brightness the old pin had.
        if (analog.has(pin)) {
          const level = Math.max(
            levelOf(levels, from),
            nextLevels[pin] ?? 0,
          );
          if (level !== FULL_LEVEL) nextLevels[pin] = level;
        }
      }
      if (removable(from)) lit.delete(from);
    }
    const sorted = Array.from(lit).sort((a, b) => a - b);
    return { litPins: sorted, levels: pruneLevels(nextLevels, sorted) };
  };

  return frames.map((frame) => {
    if (!frameNeedsChange(frame, targets)) return frame;
    const own = remap(frame.litPins, frame.levels);
    const manualSteps = frame.manualSteps?.map((step) => {
      const r = remap(step.litPins, step.levels);
      return { ...step, litPins: r.litPins, levels: r.levels };
    });
    return {
      ...frame,
      litPins: own.litPins,
      levels: own.levels,
      ...(manualSteps ? { manualSteps } : {}),
    };
  });
}
