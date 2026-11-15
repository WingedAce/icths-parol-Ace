import { useState } from "react";

import { maxInbetweens } from "../utils/audioTiming";
import type { Frame, StepTiming } from "../types";

type TransitionTimingProps = {
  from: Frame;
  to: Frame;
  // How many in-betweens the preset makes by itself in Auto timing (0 when
  // the preset just uses the beats).
  autoCount: number;
  // How many beats fall between the two keyframes.
  beatCount: number;
  // How many in-betweens there are right now, whatever the timing.
  currentCount: number;
  onChange: (patch: Partial<Frame>) => void;
  disabled?: boolean;
};

const OPTIONS: { value: StepTiming; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "beat", label: "Per beat" },
  { value: "custom", label: "Custom" },
];

const toggleClass = (active: boolean, disabled?: boolean) =>
  `rounded-full px-4 py-2 text-xs transition ${
    active
      ? "text-fg bg-line-strong"
      : "text-fg-muted hover:text-fg bg-elevated hover:bg-line-strong"
  } ${disabled ? "cursor-default opacity-60" : "cursor-pointer"}`;

const stepButtonClass =
  "h-8 w-8 cursor-pointer rounded-full border text-sm text-fg-soft transition hover:text-fg disabled:cursor-default disabled:opacity-30 disabled:hover:border-line disabled:hover:text-fg-soft border-transparent bg-elevated hover:bg-line-strong";

// Longest slider; the number box still goes all the way up to the maximum.
const SLIDER_MAX = 64;

// Picks how many in-betweens a transition gets and where they sit: the
// preset's own default speed, one per beat, or a custom count spread evenly
// between the two keyframes (at most one per millisecond).
function TransitionTiming({
  from,
  to,
  autoCount,
  beatCount,
  currentCount,
  onChange,
  disabled,
}: TransitionTimingProps) {
  const timing: StepTiming = from.stepTiming ?? "auto";
  const max = maxInbetweens(from.time, to.time);
  const gapMs = Math.round((to.time - from.time) * 1000);

  const count = Math.min(max, Math.max(1, from.stepCount ?? currentCount));
  const everyMs = Math.round((gapMs / (count + 1)) * 10) / 10;

  // What is typed in the number box until it loses focus.
  const [draft, setDraft] = useState<string | null>(null);

  const setCount = (value: number) =>
    onChange({
      stepTiming: "custom",
      stepCount: Math.min(max, Math.max(1, Math.round(value))),
    });

  const choose = (value: StepTiming) => {
    if (disabled) return;
    setDraft(null);
    if (value === "custom") {
      if (max < 1) return;
      onChange({
        stepTiming: "custom",
        stepCount: Math.min(max, Math.max(1, currentCount)),
      });
    } else {
      onChange({ stepTiming: value });
    }
  };

  let hint: string;
  if (timing === "beat") {
    hint = `One in-between on each of the ${beatCount} beat${
      beatCount === 1 ? "" : "s"
    } between the keyframes.`;
  } else if (timing === "auto") {
    hint =
      autoCount > 0
        ? `This preset's default speed: ${autoCount} in-between${
            autoCount === 1 ? "" : "s"
          }, one for each pin that changes, spread evenly.`
        : `This preset's default speed is one in-between per beat (${beatCount}).`;
  } else {
    hint =
      max < 1
        ? "These keyframes are less than 2 ms apart, so there is no room for in-betweens."
        : `Spread evenly, one every ${everyMs} ms. The most that fits is ${max} (one per millisecond).`;
  }

  return (
    <div>
      <p className="mb-3 text-xs text-fg-muted">
        Timing
      </p>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => choose(option.value)}
            disabled={disabled}
            className={toggleClass(timing === option.value, disabled)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {timing === "custom" && max >= 1 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-fg-soft">
          <span>In-betweens</span>
          <button
            onClick={() => setCount(count - 1)}
            disabled={disabled || count <= 1}
            className={stepButtonClass}
            aria-label="One fewer in-between"
          >
            -
          </button>
          <input
            type="number"
            min={1}
            max={max}
            value={draft ?? String(count)}
            disabled={disabled}
            onChange={(event) => {
              setDraft(event.target.value);
              const n = Number(event.target.value);
              if (event.target.value !== "" && Number.isFinite(n)) setCount(n);
            }}
            onBlur={() => setDraft(null)}
            className="w-20 rounded-lg border bg-transparent px-2 py-1 text-center font-medium text-sm text-fg outline-none focus:border-line-hover border-transparent bg-elevated"
          />
          <button
            onClick={() => setCount(count + 1)}
            disabled={disabled || count >= max}
            className={stepButtonClass}
            aria-label="One more in-between"
          >
            +
          </button>
          {max > 1 && (
            <input
              type="range"
              min={1}
              max={Math.min(max, SLIDER_MAX)}
              step={1}
              value={Math.min(count, Math.min(max, SLIDER_MAX))}
              disabled={disabled}
              onChange={(event) => setCount(Number(event.target.value))}
              className="min-w-24 flex-1 accent-pine"
            />
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-fg-muted">{hint}</p>
    </div>
  );
}

export default TransitionTiming;
