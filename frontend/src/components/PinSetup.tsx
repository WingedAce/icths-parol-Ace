import type { PinMapping, PinType, ProjectNode } from "../types";
import { PWM_PINS, formatPin, isPwmPin } from "../utils/pins";

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

function colorName(hex?: string) {
  return PIN_COLORS.find((c) => c.hex.toLowerCase() === hex?.toLowerCase())
    ?.name;
}

type PinSetupProps = {
  node: ProjectNode;
  onPinMappingsChange: (pinMappings: PinMapping[]) => void;
  onGoToZoneMap: () => void;
};

// One row per assigned pin: its dimming type and its real LED color, side by
// side. Colors are always visible swatches, so setting one is a single tap
// instead of "Assign color" -> pick -> panel closes.
function PinSetup({ node, onPinMappingsChange, onGoToZoneMap }: PinSetupProps) {
  const pinMappings = node.pinMappings ?? [];
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

  const uncolored = pins.filter((pin) => !colorOf(pin)).length;
  const analogCount = pins.filter((pin) => pinTypeOf(pin) === "analog").length;

  return (
    <div className="mx-auto max-w-4xl">
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

      <div className="hidden grid-cols-[7rem_11rem_1fr] gap-4 px-5 pb-2 text-[10px] uppercase tracking-[0.3em] text-white/25 md:grid">
        <span>Pin</span>
        <span>Type</span>
        <span>LED color</span>
      </div>

      <div className="flex flex-col gap-2">
        {pins.map((pin) => {
          const type = pinTypeOf(pin);
          const color = colorOf(pin);
          const zoneCount = pinMappings.filter((m) => m.pin === pin).length;
          const cannotDim = type === "analog" && !isPwmPin(pin);

          return (
            <div
              key={pin}
              className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4"
            >
              <div className="grid items-center gap-4 md:grid-cols-[7rem_11rem_1fr]">
                {/* Pin */}
                <div className="flex items-center gap-3">
                  <span
                    className="h-8 w-1.5 rounded-full border border-white/10"
                    style={{ backgroundColor: color ?? "transparent" }}
                  />
                  <div>
                    <p className="font-serif text-base text-white/70">
                      Pin <b className="text-white">{formatPin(pin)}</b>
                      {isPwmPin(pin) && (
                        <span className="ml-0.5 text-white/30">~</span>
                      )}
                    </p>
                    <p className="text-[11px] text-white/30">
                      {zoneCount} zone{zoneCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>

                {/* Type: one segmented control */}
                <div className="flex rounded-xl border border-white/10 p-0.5">
                  {(["digital", "analog"] as PinType[]).map((option) => (
                    <button
                      key={option}
                      onClick={() => setPinType(pin, option)}
                      aria-pressed={type === option}
                      className={`flex-1 cursor-pointer rounded-[10px] px-3 py-1.5 font-serif text-xs capitalize transition ${
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
                <div className="flex flex-wrap items-center gap-2">
                  {PIN_COLORS.map((c) => {
                    const picked = color?.toLowerCase() === c.hex.toLowerCase();
                    return (
                      <button
                        key={c.name}
                        onClick={() => setPinColor(pin, c.hex)}
                        title={c.name}
                        aria-label={`${c.name} for pin ${formatPin(pin)}`}
                        aria-pressed={picked}
                        className={`h-7 w-7 cursor-pointer rounded-full border-2 transition hover:scale-110 ${
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
              </div>

              {cannotDim && (
                <p className="mt-3 text-[11px] text-amber-200/70">
                  Pin {formatPin(pin)} can't dim an LED on an Arduino Mega. Use
                  one of the PWM pins ({PWM_PINS.join(", ")}) or switch this pin
                  back to Digital.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PinSetup;
