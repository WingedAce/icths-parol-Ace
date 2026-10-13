import { useState } from "react";

import ParolPreview from "./ParolPreview";
import type { PinMapping, PinType, ProjectNode } from "../types";
import {
  LED_WARN_LIMIT,
  PIN_COLORS,
  PWM_PINS,
  formatPin,
  groupOfPin,
  isPwmPin,
  pinLedLoad,
} from "../utils/pins";

function colorName(hex?: string) {
  return PIN_COLORS.find((c) => c.hex.toLowerCase() === hex?.toLowerCase())
    ?.name;
}

type PinSetupProps = {
  node: ProjectNode;
  onPinMappingsChange: (pinMappings: PinMapping[]) => void;
  onGoToZoneMap: () => void;
};

// One compact row per assigned pin: its dimming type and its real LED color,
// side by side. Colors are always visible swatches, so setting one is a
// single tap. The parol sits beside the list and stays in view while
// scrolling; pointing at a row shows just that pin's zones on it.
function PinSetup({ node, onPinMappingsChange, onGoToZoneMap }: PinSetupProps) {
  // The pin being pointed at (or focused) in the list, if any.
  const [focusPin, setFocusPin] = useState<number | null>(null);
  // "needs-color" turns the list into a to-do list of pins without a color.
  const [filter, setFilter] = useState<"all" | "needs-color">("all");
  const pinMappings = node.pinMappings ?? [];
  const tricolorGroups = node.tricolorGroups ?? [];
  const pins = Array.from(new Set(pinMappings.map((m) => m.pin))).sort(
    (a, b) => a - b,
  );

  function pinTypeOf(pin: number): PinType {
    return (
      pinMappings.find((m) => m.pin === pin && m.pinType)?.pinType ?? "digital"
    );
  }

  function colorOf(pin: number) {
    return pinMappings.find((m) => m.pin === pin && m.color)?.color;
  }

  function setPinType(pin: number, pinType: PinType) {
    onPinMappingsChange(
      pinMappings.map((m) => (m.pin === pin ? { ...m, pinType } : m)),
    );
  }

  function setPinColor(pin: number, color: string) {
    onPinMappingsChange(
      pinMappings.map((m) => (m.pin === pin ? { ...m, color } : m)),
    );
  }

  if (pins.length === 0) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-10 py-14 text-center">
        <p className="font-serif text-xl font-light">No pins assigned yet</p>
        <p className="text-sm text-white/40">
          Assign pins to your zones first, then come back here to set each
          pin's type and LED color.
        </p>
        <button
          onClick={onGoToZoneMap}
          className="cursor-pointer rounded-xl bg-white px-5 py-2.5 font-serif text-sm text-black transition hover:bg-white/90"
        >
          Go to Zone Map
        </button>
      </div>
    );
  }

  const needsColor = (pin: number) =>
    !colorOf(pin) && !groupOfPin(tricolorGroups, pin);
  const uncolored = pins.filter(needsColor).length;
  const analogCount = pins.filter((pin) => pinTypeOf(pin) === "analog").length;

  // When nothing is missing a color any more, fall back to the full list.
  const activeFilter = uncolored > 0 ? filter : "all";
  const visiblePins =
    activeFilter === "needs-color" ? pins.filter(needsColor) : pins;

  // The preview shows every pin, or only the one being pointed at.
  // Ignore a pin that is no longer in the list (e.g. it just got its color
  // while the "Needs color" filter was on), so the preview can't get stuck.
  const activeFocus =
    focusPin !== null && visiblePins.includes(focusPin) ? focusPin : null;
  const previewPins = activeFocus !== null ? [activeFocus] : pins;

  const filterChip = (active: boolean) =>
    `cursor-pointer rounded-full border px-3 py-1 text-xs transition ${
      active
        ? "border-white/40 bg-white/[0.08] text-white"
        : "border-white/10 text-white/50 hover:text-white"
    }`;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/30">
            Pin Setup
          </p>
          <p className="mt-2 font-serif text-2xl font-light">
            {pins.length} pin{pins.length === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-[11px] text-white/30">
            {analogCount} analog · {pins.length - analogCount} digital
            {uncolored > 0
              ? ` · ${uncolored} still need a color`
              : " · all colors set"}
          </p>
        </div>

        <p className="max-w-md text-[11px] leading-relaxed text-white/25">
          <b className="font-normal text-white/40">Type:</b> digital is on/off;
          analog can dim, and needs a PWM pin (~{" "}
          {PWM_PINS.join(", ")}).{" "}
          <b className="font-normal text-white/40">Color:</b> the real LED
          color soldered to the pin — a preview only, the hardware decides.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        {/* The parol, always in view while the list scrolls */}
        <div className="lg:sticky lg:top-6">
          <ParolPreview node={node} litPins={previewPins} allowPinLabels />
          <p className="mt-2 text-center text-[11px] text-white/30">
            {activeFocus !== null
              ? `Showing pin ${formatPin(activeFocus)} only`
              : "Showing every pin. Point at a pin to see just its zones."}
          </p>
        </div>

        <div className="min-w-0">
          {uncolored > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                onClick={() => setFilter("all")}
                aria-pressed={activeFilter === "all"}
                className={filterChip(activeFilter === "all")}
              >
                All pins ({pins.length})
              </button>
              <button
                onClick={() => setFilter("needs-color")}
                aria-pressed={activeFilter === "needs-color"}
                className={filterChip(activeFilter === "needs-color")}
              >
                Needs a color ({uncolored})
              </button>
            </div>
          )}

          <div
            className="flex flex-col gap-1.5"
            onMouseLeave={() => setFocusPin(null)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setFocusPin(null);
              }
            }}
          >
            {visiblePins.map((pin) => {
              const type = pinTypeOf(pin);
              const color = colorOf(pin);
              const zoneCount = pinMappings.filter((m) => m.pin === pin).length;
              const cannotDim = type === "analog" && !isPwmPin(pin);
              const tri = groupOfPin(tricolorGroups, pin);
              const leds = pinLedLoad(pinMappings, pin);
              const isFocused = activeFocus === pin;

              return (
                <div
                  key={pin}
                  onMouseEnter={() => setFocusPin(pin)}
                  onFocus={() => setFocusPin(pin)}
                  className={`rounded-xl border px-3 py-2 transition ${
                    isFocused
                      ? "border-white/30 bg-white/[0.05]"
                      : "border-white/10 bg-white/[0.02]"
                  }`}
                >
                  <div className="grid items-center gap-x-4 gap-y-2 sm:grid-cols-[6.5rem_9.5rem_minmax(0,1fr)]">
                    {/* Pin */}
                    <div className="flex items-center gap-2.5">
                      <span
                        className="h-7 w-1.5 shrink-0 rounded-full border border-white/10"
                        style={{
                          backgroundColor: tri
                            ? (tri.color ?? "#fff")
                            : (color ?? "transparent"),
                        }}
                      />
                      <div>
                        <p className="font-serif text-sm leading-tight text-white/70">
                          Pin <b className="text-white">{formatPin(pin)}</b>
                          {isPwmPin(pin) && (
                            <span className="ml-0.5 text-white/30">~</span>
                          )}
                        </p>
                        <p className="text-[11px] text-white/30">
                          {zoneCount} zone{zoneCount === 1 ? "" : "s"} · {leds}{" "}
                          LED{leds === 1 ? "" : "s"}
                          {leds > LED_WARN_LIMIT && (
                            <span className="text-amber-300"> ⚠</span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Type: one segmented control */}
                    <div className="flex rounded-lg border border-white/10 p-0.5">
                      {(["digital", "analog"] as PinType[]).map((option) => (
                        <button
                          key={option}
                          onClick={() => setPinType(pin, option)}
                          aria-pressed={type === option}
                          className={`flex-1 cursor-pointer rounded-md px-2.5 py-1 font-serif text-xs capitalize transition ${
                            type === option
                              ? "bg-white/[0.12] text-white"
                              : "text-white/45 hover:text-white"
                          }`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>

                    {/* Color: always-visible swatches */}
                    {tri ? (
                      <p className="text-xs text-white/45">
                        Tricolor LED (pins {tri.pins.map(formatPin).join(" + ")})
                        — change its color in the previews.
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {PIN_COLORS.map((c) => {
                          const picked =
                            color?.toLowerCase() === c.hex.toLowerCase();
                          return (
                            <button
                              key={c.name}
                              onClick={() => setPinColor(pin, c.hex)}
                              title={c.name}
                              aria-label={`${c.name} for pin ${formatPin(pin)}`}
                              aria-pressed={picked}
                              className={`h-6 w-6 cursor-pointer rounded-full border-2 transition hover:scale-110 ${
                                picked
                                  ? "border-white ring-2 ring-white/30"
                                  : "border-transparent"
                              }`}
                              style={{ backgroundColor: c.hex }}
                            />
                          );
                        })}
                        <span className="ml-1 text-xs text-white/35">
                          {colorName(color) ?? "No color"}
                        </span>
                      </div>
                    )}
                  </div>

                  {cannotDim && (
                    <p className="mt-2 text-[11px] text-amber-200/70">
                      Pin {formatPin(pin)} can't dim an LED on an Arduino Mega.
                      Use one of the PWM pins ({PWM_PINS.join(", ")}) or switch
                      this pin back to Digital.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PinSetup;
