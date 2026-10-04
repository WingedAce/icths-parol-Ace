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