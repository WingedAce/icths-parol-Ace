import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import ParolPreview from "./ParolPreview";
import { beatsBetween, buildInbetweens } from "../utils/audioTiming";
import type {
  AudioAnalysis,
  Frame,
  ManualStep,
  ProjectNode,
  Transition,
} from "../types";

const pillClass =
  "cursor-pointer rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.15em] text-white/60 transition hover:border-white/25 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:border-white/10 disabled:hover:text-white/60";
const linkClass =
  "cursor-pointer text-xs text-white/30 underline underline-offset-2 hover:text-white/60 disabled:cursor-default disabled:opacity-40 disabled:no-underline disabled:hover:text-white/30";
const labelClass = "mb-3 text-[10px] uppercase tracking-[0.3em] text-white/30";
const emptyBoxClass =
  "flex aspect-[4/3] items-center justify-center rounded-2xl border border-dashed border-white/10 px-6 text-center text-sm text-white/30";

// How long the looping preview rests on the second keyframe before it
// starts over, in seconds.
const LOOP_TAIL = 0.6;

// The ready-made transitions. They are also the starting points for Manual.
type Preset = Exclude<Transition, "manual">;

const PRESETS: { value: Preset; label: string; hint: string }[] = [
  {
    value: "hold",
    label: "Hold",
    hint: "Keep the first keyframe's lights on until the next keyframe.",
  },
  {
    value: "ripple",
    label: "Ripple",
    hint: "Change the lights one pin at a time, spread evenly over the beats in between.",
  },
  {
    value: "alternate",
    label: "Alternate",
    hint: "Flip between the first keyframe's lights and the second's on every beat.",
  },
];

const presetLabel = (value: Preset) =>
  PRESETS.find((p) => p.value === value)?.label ?? value;

type KeyframeGalleryProps = {
  // The Group node: owns the drawing, zones and pin mappings.
  groupNode: ProjectNode;
  // The Song node: owns the audio analysis and the keyframes.
  animationNode: ProjectNode;
  onFramesChange: (frames: Frame[]) => void;
};

// m:ss.t  (tenths of a second, because beats are only ~0.5s apart)
function formatTime(seconds: number) {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const secs = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(secs).padStart(2, "0")}.${tenths % 10}`;
}

function pinsOnLabel(frame: Frame) {
  const count = frame.litPins.length;
  return count === 0 ? "All off" : `${count} pin${count === 1 ? "" : "s"} on`;
}

function pinsText(litPins: number[]) {
  const sorted = [...litPins].sort((a, b) => a - b);
  return sorted.length === 0 ? "All pins off" : `Pins on: ${sorted.join(", ")}`;
}

function sectionLabel(frame: Frame, analysis?: AudioAnalysis) {
  if (!analysis || !frame.sectionId) return null;
  const index = analysis.sections.findIndex((s) => s.id === frame.sectionId);
  return index >= 0 ? `Section ${index + 1}` : null;
}

const toggleClass = (active: boolean) =>
  `cursor-pointer rounded-full border px-4 py-2 text-xs uppercase tracking-[0.15em] transition ${
    active
      ? "border-white/40 bg-white/[0.08] text-white"
      : "border-white/10 text-white/50 hover:text-white"
  }`;

type PanelProps = {
  frame: Frame;
  number: number;
  groupNode: ProjectNode;
  analysis?: AudioAnalysis;
  // When set, the panel is clickable (used for the "next" side).
  onClick?: () => void;
};

// One big keyframe on the left or right of the pair view.
function KeyframePanel({
  frame,
  number,
  groupNode,
  analysis,
  onClick,
}: PanelProps) {
  const section = sectionLabel(frame, analysis);

  const body = (
    <>
      <ParolPreview node={groupNode} litPins={frame.litPins} />
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <p className="font-serif text-2xl text-white">Keyframe {number}</p>
        <p className="text-xs text-white/40">
          {formatTime(frame.time)}
          {section && ` · ${section}`}
        </p>
      </div>
      <p className="mt-1 text-xs text-white/30">{pinsText(frame.litPins)}</p>
    </>
  );

  if (!onClick) return <div className="min-w-0">{body}</div>;

  return (
    <button
      onClick={onClick}
      className="min-w-0 cursor-pointer text-left opacity-80 transition hover:opacity-100"
    >
      {body}
    </button>
  );
}

type PairNavProps = {
  onBack: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
};

// Bottom row of the pair view: back to the grid, and step between keyframes.
function PairNav({ onBack, onPrevious, onNext }: PairNavProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-6">
      <button onClick={onBack} className={linkClass}>
        Back to all keyframes
      </button>
      <div className="flex gap-2">
        <button onClick={onPrevious} disabled={!onPrevious} className={pillClass}>
          Previous keyframe
        </button>
        <button onClick={onNext} disabled={!onNext} className={pillClass}>
          Next keyframe
        </button>
      </div>
    </div>
  );
}

type PairViewProps = {
  from: Frame;
  to: Frame;
  fromNumber: number;
  toNumber: number;
  groupNode: ProjectNode;
  analysis?: AudioAnalysis;
  // Name of the first keyframe's section, and how many other keyframes
  // share it (for the "apply to this section" link).
  sectionName: string | null;
  sectionMates: number;
  // Change something on the first keyframe (its transition or manual steps).
  onChangeFrame: (patch: Partial<Frame>) => void;
  onApplyToSection: (transition: Preset) => void;
  onApplyToAll: (transition: Preset) => void;
  onOpenNext: () => void;
  nav: ReactNode;
};

// Keyframe | in-between | next keyframe, with the transition controls below.
function PairView({
  from,
  to,
  fromNumber,
  toNumber,
  groupNode,
  analysis,
  sectionName,
  sectionMates,
  onChangeFrame,
  onApplyToSection,
  onApplyToAll,
  onOpenNext,
  nav,
}: PairViewProps) {
  const mode = from.transition ?? "hold";
  const isManual = mode === "manual";
  const span = to.time - from.time;
  const total = span + LOOP_TAIL;

  // The preset to fall back to when leaving Manual, and the one the apply
  // links use.
  const [lastPreset, setLastPreset] = useState<Preset>(
    mode === "manual" ? "hold" : mode,
  );
  const activePreset: Preset = isManual ? lastPreset : mode;

  const pins = useMemo(
    () =>
      Array.from(
        new Set((groupNode.pinMappings ?? []).map((m) => m.pin)),
      ).sort((a, b) => a - b),
    [groupNode.pinMappings],
  );

  const beatTimes = useMemo(
    () => (analysis ? beatsBetween(analysis, from.time, to.time) : []),
    [analysis, from.time, to.time],
  );

  // First keyframe, then one in-between per beat, then the second keyframe.
  // Hold has no generated in-betweens, so they are filled in here as copies
  // of the first keyframe, which is exactly what Hold looks like.
  const steps = useMemo(() => {
    let inbetweens: Frame[];
    if (mode === "hold") {
      inbetweens = beatTimes.map((time, index) => ({
        id: `${from.id}-${index + 1}`,
        kind: "inbetween",
        sectionId: from.sectionId,
        time,
        litPins: [...from.litPins],
      }));
    } else {
      inbetweens = analysis ? buildInbetweens(analysis, [from, to]) : [];
    }
    return [from, ...inbetweens, to];
  }, [analysis, from, to, mode, beatTimes]);

  const betweenCount = steps.length - 2;

  const changedPins = useMemo(() => {
    const all = new Set([...from.litPins, ...to.litPins]);
    return [...all].filter(
      (pin) => from.litPins.includes(pin) !== to.litPins.includes(pin),
    ).length;
  }, [from, to]);

  // ---- Which frame the middle panel shows ----
  // `offset` is seconds since the first keyframe. It is the one source of
  // truth for both playing and picking a beat by hand.
  const firstOffset = betweenCount > 0 ? steps[1].time - from.time : 0;
  const [offset, setOffset] = useState(firstOffset);
  const [playing, setPlaying] = useState(false);
  const offsetRef = useRef(firstOffset);

  useEffect(() => {
    if (!playing || total <= 0) return;

    const startMs = performance.now() - offsetRef.current * 1000;
    let frameId = 0;
    const tick = () => {
      const elapsed = ((performance.now() - startMs) / 1000) % total;
      offsetRef.current = elapsed;
      setOffset(elapsed);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frameId);
  }, [playing, total]);

  let activeIndex = 0;
  if (offset >= span) {
    activeIndex = steps.length - 1;
  } else {
    for (let i = 0; i < steps.length - 1; i++) {
      if (steps[i].time - from.time <= offset + 0.001) activeIndex = i;
    }
  }

  const showing = steps[activeIndex];
  const isBetween = activeIndex >= 1 && activeIndex <= betweenCount;
  const canEdit = isManual && isBetween && !playing;

  const selectStep = (index: number) => {
    const t = Math.min(span, steps[index].time - from.time);
    setPlaying(false);
    offsetRef.current = t;
    setOffset(t);
  };

  const stepBeat = (direction: 1 | -1) => {
    if (betweenCount === 0) return;
    if (!isBetween) {
      selectStep(direction === 1 ? 1 : betweenCount);
      return;
    }
    selectStep(Math.min(betweenCount, Math.max(1, activeIndex + direction)));
  };

  // Keep the picked beat in view in the strip of in-betweens.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = stripRef.current;
    const item = strip?.querySelector<HTMLElement>(
      `[data-step="${activeIndex}"]`,
    );
    if (!strip || !item) return;
    strip.scrollTo({
      left: item.offsetLeft - strip.clientWidth / 2 + item.clientWidth / 2,
      behavior: "smooth",
    });
  }, [activeIndex]);

  // ---- Changing the transition ----
  const pickPreset = (preset: Preset) => {
    setLastPreset(preset);
    onChangeFrame({ transition: preset });
  };

  const chooseManual = () => {
    // Start from whatever the preset was doing, unless the user already
    // made in-betweens earlier.
    onChangeFrame({
      transition: "manual",
      manualSteps:
        from.manualSteps ??
        steps
          .slice(1, -1)
          .map((s): ManualStep => ({ time: s.time, litPins: [...s.litPins] })),
    });
  };

  const choosePresets = () => onChangeFrame({ transition: lastPreset });

  // Replace every manual in-between with what a preset would make.
  const startOverFrom = (preset: Preset) => {
    const seeded: ManualStep[] =
      preset === "hold" || !analysis
        ? beatTimes.map((time) => ({ time, litPins: [...from.litPins] }))
        : buildInbetweens(analysis, [{ ...from, transition: preset }, to]).map(
            (f) => ({ time: f.time, litPins: [...f.litPins] }),
          );
    onChangeFrame({ transition: "manual", manualSteps: seeded });
  };

  // Write every in-between, changing only the one at `index`.
  const setPinsAt = (index: number, litPins: number[]) => {
    onChangeFrame({
      transition: "manual",
      manualSteps: steps.slice(1, -1).map((s, i) => ({
        time: s.time,
        litPins: i + 1 === index ? litPins : [...s.litPins],
      })),
    });
  };

  const togglePin = (pin: number) => {
    if (!canEdit) return;
    const lit = showing.litPins;
    setPinsAt(
      activeIndex,
      lit.includes(pin)
        ? lit.filter((p) => p !== pin)
        : [...lit, pin].sort((a, b) => a - b),
    );
  };

  // ---- Notes for the presets ----
  let note: string | null = null;
  if (!isManual && mode !== "hold") {
    if (betweenCount === 0) {
      note =
        "There are no beats between these two keyframes, so the lights just switch.";
    } else if (changedPins === 0) {
      note = `Both keyframes light the same pins, so ${presetLabel(mode)} looks the same as Hold.`;
    } else if (mode === "ripple" && changedPins > betweenCount) {
      note =
        "More pins change than there are beats, so some pins change on the same beat.";
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Keyframe | in-between | next keyframe */}
      <div className="grid items-start gap-6 md:grid-cols-3">
        <KeyframePanel
          frame={from}
          number={fromNumber}
          groupNode={groupNode}
          analysis={analysis}
        />

        <div className="min-w-0">
          {betweenCount === 0 ? (
            <div className={emptyBoxClass}>
              There are no beats between these two keyframes, so there is
              nothing to fill in.
            </div>
          ) : (
            <>
              <ParolPreview node={groupNode} litPins={showing.litPins} />
              <div className="mt-3 flex items-baseline justify-between gap-3">
                <p className="font-serif text-2xl text-white">
                  {isBetween
                    ? `In-between ${activeIndex}`
                    : `Keyframe ${activeIndex === 0 ? fromNumber : toNumber}`}
                </p>
                <p className="text-xs text-white/40">
                  {formatTime(showing.time)}
                  {isBetween && ` · ${activeIndex} of ${betweenCount}`}
                </p>
              </div>
              <p className="mt-1 text-xs text-white/30">
                {pinsText(showing.litPins)}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => stepBeat(-1)} className={pillClass}>
                  Previous beat
                </button>
                <button
                  onClick={() => setPlaying((value) => !value)}
                  className={pillClass}
                >
                  {playing ? "Pause" : "Play"}
                </button>
                <button onClick={() => stepBeat(1)} className={pillClass}>
                  Next beat
                </button>
              </div>
            </>
          )}
        </div>

        <KeyframePanel
          frame={to}
          number={toNumber}
          groupNode={groupNode}
          analysis={analysis}
          onClick={onOpenNext}
        />
      </div>

      {/* Every in-between, in order */}
      {betweenCount > 0 && (
        <div className="min-w-0">
          <p className={labelClass}>
            {betweenCount} in-between{betweenCount === 1 ? "" : "s"}, one per
            beat
          </p>
          <div
            ref={stripRef}
            className="relative flex gap-3 overflow-x-auto pb-3"
          >
            {steps.slice(1, -1).map((step, i) => {
              const index = i + 1;
              return (
                <button
                  key={step.id}
                  data-step={index}
                  onClick={() => selectStep(index)}
                  className="w-28 shrink-0 cursor-pointer text-left"
                >
                  <div
                    className={`rounded-2xl ring-1 transition ${
                      index === activeIndex
                        ? "ring-white/60"
                        : "ring-transparent hover:ring-white/30"
                    }`}
                  >
                    <ParolPreview node={groupNode} litPins={step.litPins} />
                  </div>
                  <p className="mt-2 text-xs text-white/50">{index}</p>
                  <p className="text-[11px] text-white/25">
                    {formatTime(step.time)}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* How the in-betweens are made */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex gap-2">
            <button
              onClick={choosePresets}
              className={toggleClass(!isManual)}
            >
              Presets
            </button>
            <button onClick={chooseManual} className={toggleClass(isManual)}>
              Manual
            </button>
          </div>
          <p className="text-xs text-white/40">
            {betweenCount} beat{betweenCount === 1 ? "" : "s"} between ·{" "}
            {changedPins} pin{changedPins === 1 ? "" : "s"} differ
          </p>
        </div>

        {!isManual ? (
          <div className="mt-6">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => pickPreset(option.value)}
                  className={toggleClass(mode === option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <p className="mt-3 text-xs text-white/30">
              {PRESETS.find((o) => o.value === mode)?.hint}
            </p>
            {note && <p className="mt-2 text-xs text-amber-200/60">{note}</p>}

            <div className="mt-6 flex flex-wrap gap-4">
              <button
                onClick={() => onApplyToAll(activePreset)}
                className={linkClass}
              >
                Use {presetLabel(activePreset)} for every keyframe
              </button>
              {sectionName && sectionMates > 0 && (
                <button
                  onClick={() => onApplyToSection(activePreset)}
                  className={linkClass}
                >
                  Use {presetLabel(activePreset)} for all of {sectionName}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-6">
            <p className="text-sm text-white/60">
              {betweenCount === 0
                ? "There are no beats to edit between these keyframes."
                : canEdit
                  ? `Editing in-between ${activeIndex} of ${betweenCount}. Tap a pin to turn it on or off.`
                  : "Pick an in-between above, then turn pins on or off."}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {pins.map((pin) => {
                const isOn = showing.litPins.includes(pin);
                return (
                  <button
                    key={pin}
                    onClick={() => togglePin(pin)}
                    disabled={!canEdit}
                    className={`rounded-full border px-3 py-1 font-serif text-xs transition ${
                      isOn
                        ? "border-white/40 bg-white/[0.08] text-white"
                        : "border-white/10 text-white/50"
                    } ${
                      canEdit
                        ? "cursor-pointer hover:text-white"
                        : "cursor-default opacity-60"
                    }`}
                  >
                    Pin {pin}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex flex-wrap gap-4">
              <button
                onClick={() => setPinsAt(activeIndex, [...from.litPins])}
                disabled={!canEdit}
                className={linkClass}
              >
                Copy keyframe {fromNumber}
              </button>
              <button
                onClick={() => setPinsAt(activeIndex, [...to.litPins])}
                disabled={!canEdit}
                className={linkClass}
              >
                Copy keyframe {toNumber}
              </button>
              <button
                onClick={() => setPinsAt(activeIndex, [])}
                disabled={!canEdit}
                className={linkClass}
              >
                Turn all off
              </button>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-white/10 pt-5">
              <span className="text-xs text-white/30">
                Start every in-between over from
              </span>
              {PRESETS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => startOverFrom(option.value)}
                  disabled={betweenCount === 0}
                  className={linkClass}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {nav}
    </div>
  );
}

function KeyframeGallery({
  groupNode,
  animationNode,
  onFramesChange,
}: KeyframeGalleryProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const analysis = animationNode.audioAnalysis;

  const keyframes = (animationNode.frames ?? [])
    .filter((f) => f.kind === "key")
    .sort((a, b) => a.time - b.time);

  const hasParol =
    !!groupNode.imageDataUrl &&
    (groupNode.zones?.length ?? 0) > 0 &&
    (groupNode.pinMappings?.length ?? 0) > 0;

  if (!hasParol) {
    return (
      <p className="text-center text-sm text-white/30">
        Detect zones and assign pins on the Zone Map tab to see your keyframes
        here.
      </p>
    );
  }

  if (keyframes.length === 0) {
    return (
      <p className="text-center text-sm text-white/30">
        No keyframes yet. Add some on the Preview tab and they will show up
        here.
      </p>
    );
  }

  const selectedIndex = selectedId
    ? keyframes.findIndex((f) => f.id === selectedId)
    : -1;

  // ---- Pair view ----
  if (selectedIndex >= 0) {
    const current = keyframes[selectedIndex];
    const next = keyframes[selectedIndex + 1];
    const previous = keyframes[selectedIndex - 1];

    const nav = (
      <PairNav
        onBack={() => setSelectedId(null)}
        onPrevious={previous ? () => setSelectedId(previous.id) : undefined}
        onNext={next ? () => setSelectedId(next.id) : undefined}
      />
    );

    // The last keyframe has nothing after it, so no transition to edit.
    if (!next) {
      return (
        <div className="flex flex-col gap-8">
          <div className="grid items-start gap-6 md:grid-cols-3">
            <KeyframePanel
              frame={current}
              number={selectedIndex + 1}
              groupNode={groupNode}
              analysis={analysis}
            />
            <div className={`${emptyBoxClass} md:col-span-2`}>
              This is the last keyframe, so there is nothing after it.
            </div>
          </div>
          {nav}
        </div>
      );
    }

    const updateFrames = (
      shouldChange: (frame: Frame) => boolean,
      patch: Partial<Frame>,
    ) =>
      onFramesChange(
        (animationNode.frames ?? []).map((f) =>
          shouldChange(f) ? { ...f, ...patch } : f,
        ),
      );

    const sectionMates = current.sectionId
      ? keyframes.filter(
          (f) => f.sectionId === current.sectionId && f.id !== current.id,
        ).length
      : 0;

    return (
      <PairView
        key={`${current.id}:${next.id}`}
        from={current}
        to={next}
        fromNumber={selectedIndex + 1}
        toNumber={selectedIndex + 2}
        groupNode={groupNode}
        analysis={analysis}
        sectionName={sectionLabel(current, analysis)}
        sectionMates={sectionMates}
        onChangeFrame={(patch) =>
          updateFrames((f) => f.id === current.id, patch)
        }
        onApplyToSection={(transition) =>
          updateFrames((f) => f.sectionId === current.sectionId, { transition })
        }
        onApplyToAll={(transition) => updateFrames(() => true, { transition })}
        onOpenNext={() => setSelectedId(next.id)}
        nav={nav}
      />
    );
  }

  // ---- Gallery: every keyframe, five to a row ----
  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-white/40">
        {keyframes.length} keyframe{keyframes.length === 1 ? "" : "s"}. Click
        one to see it next to the keyframe that follows and edit the
        transition between them.
      </p>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {keyframes.map((frame, index) => (
          <button
            key={frame.id}
            onClick={() => setSelectedId(frame.id)}
            className="group min-w-0 cursor-pointer text-left"
          >
            <div className="relative rounded-2xl ring-1 ring-transparent transition group-hover:ring-white/40">
              <ParolPreview node={groupNode} litPins={frame.litPins} />
              <span className="pointer-events-none absolute left-3 top-2 font-serif text-lg text-white/80 [text-shadow:0_1px_6px_rgba(0,0,0,0.9)]">
                {index + 1}
              </span>
            </div>
            <p className="mt-2 text-xs text-white/40">
              {formatTime(frame.time)} · {pinsOnLabel(frame)}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

export default KeyframeGallery;
