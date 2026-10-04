import type { PinLevels, ProjectNode } from "../types";

// The pins that can dim an LED on an Arduino Mega (the ones marked ~ on the
// board): 2-13 and 44-46. The A0-A15 header has no PWM, so it can't dim.
// Change this list if the parol uses a different board.
export const PWM_PINS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46];

export const isPwmPin = (pin: number) => PWM_PINS.includes(pin);

// Board pin numbering. The parol uses an Arduino Mega: digital pins 0-53, then
// the analog header A0-A15, which the board numbers 54-69. A pin is stored as
// a single number, so A3 is saved as 57.
export const DIGITAL_PIN_COUNT = 54;
export const ANALOG_PIN_OFFSET = 54;
export const ANALOG_PIN_COUNT = 16;

// Is this saved pin number one of the A0-A15 pins?
export const isAnalogPin = (pin: number) =>
  pin >= ANALOG_PIN_OFFSET && pin < ANALOG_PIN_OFFSET + ANALOG_PIN_COUNT;

// How a saved pin number is shown to people: 7 or A3.
export const formatPin = (pin: number) =>
  isAnalogPin(pin) ? `A${pin - ANALOG_PIN_OFFSET}` : String(pin);

// Turns what the student typed into a saved pin number, or null when it is
// not a real pin. With `analog` on, "3" means A3 and is saved as 57.
export function parsePin(input: string, analog: boolean): number | null {
  const text = input.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  if (analog) return n < ANALOG_PIN_COUNT ? n + ANALOG_PIN_OFFSET : null;
  return n < DIGITAL_PIN_COUNT ? n : null;
}

// Brightness range for analog pins, in percent.
export const FULL_LEVEL = 100;
export const MIN_LEVEL = 5;

// Every pin on this parol that the Zone Map tab marked as analog.
export function analogPinSet(node: ProjectNode): Set<number> {
  return new Set(
    (node.pinMappings ?? [])
      .filter((m) => m.pinType === "analog")
      .map((m) => m.pin),
  );
}

// A pin with no saved level is at full brightness.
export function levelOf(levels: PinLevels | undefined, pin: number): number {
  return levels?.[pin] ?? FULL_LEVEL;
}

// Keeps only the levels of pins that are actually on, and returns undefined
// when none are left, so frames without analog pins carry no `levels` at all.
export function pruneLevels(
  levels: PinLevels | undefined,
  litPins: number[],
): PinLevels | undefined {
  if (!levels) return undefined;
  const kept: PinLevels = {};
  for (const pin of litPins) {
    if (levels[pin] !== undefined) kept[pin] = levels[pin];
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

// Same pins on, and the same brightness on the analog ones?
export function sameLights(
  aPins: number[],
  aLevels: PinLevels | undefined,
  bPins: number[],
  bLevels: PinLevels | undefined,
  analog: Set<number>,
): boolean {
  if (aPins.length !== bPins.length) return false;
  return aPins.every(
    (pin) =>
      bPins.includes(pin) &&
      (!analog.has(pin) || levelOf(aLevels, pin) === levelOf(bLevels, pin)),
  );
}

// "Pins on: 1, 4 (60%), 7" — analog pins show how bright they are.
export function describePins(
  litPins: number[],
  levels: PinLevels | undefined,
  analog: Set<number>,
): string {
  const sorted = [...litPins].sort((a, b) => a - b);
  if (sorted.length === 0) return "All pins off";
  const parts = sorted.map((pin) =>
    analog.has(pin) ? `${pin} (${levelOf(levels, pin)}%)` : String(pin),
  );
  return `Pins on: ${parts.join(", ")}`;
}

// ---- LED counts per pin ----

// More than this many LEDs on one pin shows a warning...
export const LED_WARN_LIMIT = 6;
// ...and more than this is not allowed at all.
export const LED_MAX_PER_PIN = 10;

// LEDs in one zone. A zone with no saved count has 1.
export const ledsInZone = (m: { ledCount?: number }) => m.ledCount ?? 1;

// Total LEDs a pin has to drive, across all of its zones. A tricolor LED puts
// one LED on each of its 3 pins, so this is also the pin's load for tricolor.
export function pinLedLoad(
  pinMappings: { pin: number; ledCount?: number }[],
  pin: number,
): number {
  return pinMappings
    .filter((m) => m.pin === pin)
    .reduce((sum, m) => sum + ledsInZone(m), 0);
}

// Total LEDs in the whole parol. A tricolor LED equals 3 LEDs, so a merged
// group of 3 pins counts 3 x (tricolor LEDs on it); the tricolor count is the
// biggest load among its 3 pins.
export function totalLeds(
  pinMappings: { pin: number; ledCount?: number }[],
  groups: { pins: number[] }[],
): number {
  const merged = new Set(groups.flatMap((g) => g.pins));
  let total = 0;
  for (const pin of new Set(pinMappings.map((m) => m.pin))) {
    if (!merged.has(pin)) total += pinLedLoad(pinMappings, pin);
  }
  for (const g of groups) {
    total += 3 * Math.max(...g.pins.map((p) => pinLedLoad(pinMappings, p)), 0);
  }
  return total;
}

// The tricolor group a pin belongs to, if any.
export function groupOfPin<T extends { pins: number[] }>(
  groups: T[],
  pin: number,
): T | undefined {
  return groups.find((g) => g.pins.includes(pin));
}


// The only LED colors available for the build — the palette is fixed to
// these eight, so there's no free color picker.
export const PIN_COLORS = [
  { name: "Red", hex: "#ff4d4d" },
  { name: "Blue", hex: "#0a9bff" },
  { name: "Yellow", hex: "#ffd60a" },
  { name: "Green", hex: "#34c759" },
  { name: "Orange", hex: "#ff8a1f" },
  { name: "White", hex: "#ffffff" },
  { name: "Pink", hex: "#ff6fb5" },
  { name: "Purple", hex: "#b86bff" },
] as const;