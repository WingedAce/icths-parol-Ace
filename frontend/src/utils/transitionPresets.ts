import type { Transition } from "../types";

// Every ready-made transition (everything except hand-made "manual").
export type Preset = Exclude<Transition, "manual">;

export type PresetOption = { value: Preset; label: string; hint: string };

// Sweeps change the pins that differ between two keyframes one unit at a
// time (a tricolor LED is one unit), in an order that depends on the preset.
export const SWEEP_PRESETS: Preset[] = [
  "spin-cw",
  "spin-ccw",
  "outwards",
  "inwards",
  "wipe-down",
  "wipe-up",
  "wipe-right",
  "wipe-left",
  "scatter",
];

export const isSweep = (transition: Transition | undefined) =>
  transition !== undefined && (SWEEP_PRESETS as string[]).includes(transition);

export const PRESET_GROUPS: { label: string; options: PresetOption[] }[] = [
  {
    label: "Basic",
    options: [
      {
        value: "hold",
        label: "Hold",
        hint: "Keep the first keyframe's lights on until the next keyframe.",
      },
      {
        value: "ripple",
        label: "Ripple",
        hint: "Change the lights one pin at a time, lowest pin number first.",
      },
      {
        value: "alternate",
        label: "Alternate",
        hint: "Flip between the first keyframe's lights and the second's on every step.",
      },
      {
        value: "fade",
        label: "Fade",
        hint: "Dim analog pins smoothly from the first keyframe's brightness to the second's. Digital pins switch halfway.",
      },
    ],
  },
  {
    label: "Spin and burst",
    options: [
      {
        value: "spin-cw",
        label: "Spin clockwise",
        hint: "Starts at the uppermost pin and goes around the parol clockwise, one pin per step.",
      },
      {
        value: "spin-ccw",
        label: "Spin counterclockwise",
        hint: "Starts at the uppermost pin and goes around the parol counterclockwise, one pin per step.",
      },
      {
        value: "outwards",
        label: "Outwards",
        hint: "Starts with the pins nearest the middle and moves out to the outer pins.",
      },
      {
        value: "inwards",
        label: "Inwards",
        hint: "Starts with the outer pins and moves in to the pins nearest the middle.",
      },
    ],
  },
  {
    label: "Wipes",
    options: [
      {
        value: "wipe-down",
        label: "Wipe down",
        hint: "Pins change from the top of the parol to the bottom.",
      },
      {
        value: "wipe-up",
        label: "Wipe up",
        hint: "Pins change from the bottom of the parol to the top.",
      },
      {
        value: "wipe-right",
        label: "Wipe right",
        hint: "Pins change from the left side to the right side.",
      },
      {
        value: "wipe-left",
        label: "Wipe left",
        hint: "Pins change from the right side to the left side.",
      },
      {
        value: "scatter",
        label: "Random",
        hint: "Pins change in a scrambled order. The order is fixed for each keyframe, so it looks the same every time and in the exported code.",
      },
    ],
  },
];

export const PRESETS: PresetOption[] = PRESET_GROUPS.flatMap((g) => g.options);

export const presetLabel = (value: Preset) =>
  PRESETS.find((p) => p.value === value)?.label ?? value;
