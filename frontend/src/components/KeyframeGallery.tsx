import { useEffect, useMemo, useRef, useState } from "react";

import ParolPreview from "./ParolPreview";
import { beatsBetween, buildInbetweens } from "../utils/audioTiming";
import type { AudioAnalysis, Frame, ProjectNode, Transition } from "../types";

const pillClass =
  "cursor-pointer rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.15em] text-white/60 transition hover:border-white/25 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:border-white/10 disabled:hover:text-white/60";
const linkClass =
  "cursor-pointer text-xs text-white/30 underline underline-offset-2 hover:text-white/60";

const labelClass = "mb-3 text-[10px] uppercase tracking-[0.3em] text-white/30";

// How long the looping preview rests on the second keyframe before it
// starts over, in seconds.
const LOOP_TAIL = 0.6;

// How a keyframe moves on to the next keyframe.
const TRANSITIONS: { value: Transition; label: string; hint: string }[] = [
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

const transitionLabel = (value: Transition) =>
  TRANSITIONS.find((t) => t.value === value)?.label ?? value;

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

function sectionLabel(frame: Frame, analysis?: AudioAnalysis) {
  if (!analysis || !frame.sectionId) return null;
  const index = analysis.sections.findIndex((s) => s.id === frame.sectionId);
  return index >= 0 ? `Section ${index + 1}` : null;
}

type PanelProps = {
  frame: Frame;
  number: number;
  groupNode: ProjectNode;
  analysis?: AudioAnalysis;
  // When set, the panel is clickable (used for the "next" side).
  onClick?: () => void;
};

// One big keyframe in the pair view.
function KeyframePanel({
  frame,
  number,
  groupNode,
  analysis,
  onClick,
}: PanelProps) {
  const section = sectionLabel(frame, analysis);
  const sortedPins = [...frame.litPins].sort((a, b) => a - b);

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
      <p className="mt-1 text-xs text-white/30">
        {sortedPins.length === 0
          ? "All pins off"
          : `Pins on: ${sortedPins.join(", ")}`}
      </p>
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

type TransitionEditorProps = {
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
  onPick: (transition: Transition) => void;
  onApplyToSection: (transition: Transition) => void;
  onApplyToAll: (transition: Transition) => void;
};

// Everything about the move from one keyframe to the next: pick the
// transition, watch it loop, and see each in-between frame.
function TransitionEditor({
  from,
  to,
  fromNumber,
  toNumber,
  groupNode,
  analysis,
  sectionName,
  sectionMates,
  onPick,
  onApplyToSection,
  onApplyToAll,
}: TransitionEditorProps) {
  const mode = from.transition ?? "hold";
  const span = to.time - from.time;
  const total = span + LOOP_TAIL;

  // First keyframe, then every in-between beat, then the second keyframe.
  const steps = useMemo(() => {
    const inbetweens = analysis ? buildInbetweens(analysis, [from, to]) : [];
    return [from, ...inbetweens, to];
  }, [analysis, from, to]);

  const beatCount = analysis
    ? beatsBetween(analysis, from.time, to.time).length
    : 0;

  const changedPins = useMemo(() => {
    const all = new Set([...from.litPins, ...to.litPins]);
    return [...all].filter(
      (pin) => from.litPins.includes(pin) !== to.litPins.includes(pin),
    ).length;
  }, [from, to]);

  // ---- Looping preview ----
  // offset = seconds since the first keyframe.
  const [offset, setOffset] = useState(0);
  const [playing, setPlaying] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const offsetRef = useRef(0);

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

  const showStep = (index: number) => {
    const t = Math.min(span, steps[index].time - from.time);
    setPlaying(false);
    offsetRef.current = t;
    setOffset(t);
  };

  // ---- Notes under the picker ----
  let note: string | null = null;
  if (mode !== "hold") {
    if (beatCount === 0) {
      note =
        "There are no beats between these two keyframes, so the lights just switch.";
    } else if (changedPins === 0) {
      note = `Both keyframes light the same pins, so ${transitionLabel(mode)} looks the same as Hold.`;
    } else if (mode === "ripple" && changedPins > beatCount) {
      note =
        "More pins change than there are beats, so some pins change on the same beat.";
    }
  }

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="min-w-0">
        <p className={labelClass}>
          Transition from {fromNumber} to {toNumber}
        </p>

        <div className="flex flex-wrap gap-2">
          {TRANSITIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => onPick(option.value)}
              className={`cursor-pointer rounded-full border px-4 py-2 text-xs uppercase tracking-[0.15em] transition ${
                mode === option.value
                  ? "border-white/40 bg-white/[0.08] text-white"
                  : "border-white/10 text-white/50 hover:text-white"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p className="mt-3 text-xs text-white/30">
          {TRANSITIONS.find((o) => o.value === mode)?.hint}
        </p>

        <p className="mt-4 text-xs text-white/40">
          {beatCount} beat{beatCount === 1 ? "" : "s"} between these keyframes
          · {changedPins} pin{changedPins === 1 ? "" : "s"} change
        </p>

        {note && <p className="mt-2 text-xs text-amber-200/60">{note}</p>}

        <div className="mt-6 flex flex-wrap gap-4">
          <button onClick={() => onApplyToAll(mode)} className={linkClass}>
            Use {transitionLabel(mode)} for every keyframe
          </button>
          {sectionName && sectionMates > 0 && (
            <button
              onClick={() => onApplyToSection(mode)}
              className={linkClass}
            >
              Use {transitionLabel(mode)} for all of {sectionName}
            </button>
          )}
        </div>
      </div>

      <div className="min-w-0">
        <p className={labelClass}>Preview of just this transition</p>
        <ParolPreview node={groupNode} litPins={steps[activeIndex].litPins} />
        <button
          onClick={() => setPlaying((value) => !value)}
          className={`${pillClass} mt-4`}
        >
          {playing ? "Pause" : "Play"}
        </button>
      </div>

      {/* Every frame in the transition, in order */}
      <div className="min-w-0 md:col-span-2">
        <p className={labelClass}>
          Frames · {steps.length - 2} in-between
          {steps.length - 2 === 1 ? "" : "s"}
        </p>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {steps.map((step, index) => {
            const isKey = index === 0 || index === steps.length - 1;
            return (
              <button
                key={step.id}
                onClick={() => showStep(index)}
                className="w-32 shrink-0 cursor-pointer text-left"
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
                <p
                  className={`mt-2 text-xs ${isKey ? "text-white/60" : "text-white/35"}`}
                >
                  {isKey
                    ? `Keyframe ${index === 0 ? fromNumber : toNumber}`
                    : "In-between"}
                </p>
                <p className="text-[11px] text-white/25">
                  {formatTime(step.time)}
                </p>
              </button>
            );
          })}
        </div>
      </div>
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

  // ---- Pair view: the clicked keyframe on the left, the next on the right ----
  if (selectedIndex >= 0) {
    const current = keyframes[selectedIndex];
    const next = keyframes[selectedIndex + 1];
    const previous = keyframes[selectedIndex - 1];

    const setTransitions = (
      transition: Transition,
      shouldChange: (frame: Frame) => boolean,
    ) =>
      onFramesChange(
        (animationNode.frames ?? []).map((f) =>
          shouldChange(f) ? { ...f, transition } : f,
        ),
      );

    const currentSection = sectionLabel(current, analysis);
    const sectionMates = current.sectionId
      ? keyframes.filter(
          (f) => f.sectionId === current.sectionId && f.id !== current.id,
        ).length
      : 0;

    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button onClick={() => setSelectedId(null)} className={linkClass}>
            Back to all keyframes
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => previous && setSelectedId(previous.id)}
              disabled={!previous}
              className={pillClass}
            >
              Previous
            </button>
            <button
              onClick={() => next && setSelectedId(next.id)}
              disabled={!next}
              className={pillClass}
            >
              Next
            </button>
          </div>
        </div>

        <div className="grid items-center gap-6 md:grid-cols-[1fr_auto_1fr]">
          <KeyframePanel
            frame={current}
            number={selectedIndex + 1}
            groupNode={groupNode}
            analysis={analysis}
          />

          {next ? (
            <>
              {/* Where the transition editor will go */}
              <div className="flex flex-col items-center gap-2 md:flex-row">
                <div className="h-6 w-px bg-white/15 md:h-px md:w-6" />
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/50">
                  {transitionLabel(current.transition ?? "hold")}
                </span>
                <div className="h-6 w-px bg-white/15 md:h-px md:w-6" />
              </div>

              <KeyframePanel
                frame={next}
                number={selectedIndex + 2}
                groupNode={groupNode}
                analysis={analysis}
                onClick={() => setSelectedId(next.id)}
              />
            </>
          ) : (
            <>
              <div />
              <div className="flex aspect-[4/3] items-center justify-center rounded-2xl border border-dashed border-white/10 px-6 text-center text-sm text-white/30">
                This is the last keyframe, so there is nothing after it.
              </div>
            </>
          )}
        </div>

        {next && (
          <div className="border-t border-white/10 pt-8">
            <TransitionEditor
              key={`${current.id}:${next.id}`}
              from={current}
              to={next}
              fromNumber={selectedIndex + 1}
              toNumber={selectedIndex + 2}
              groupNode={groupNode}
              analysis={analysis}
              sectionName={currentSection}
              sectionMates={sectionMates}
              onPick={(transition) =>
                setTransitions(transition, (f) => f.id === current.id)
              }
              onApplyToSection={(transition) =>
                setTransitions(
                  transition,
                  (f) => f.sectionId === current.sectionId,
                )
              }
              onApplyToAll={(transition) =>
                setTransitions(transition, () => true)
              }
            />
          </div>
        )}
      </div>
    );
  }

  // ---- Gallery: every keyframe, five to a row ----
  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-white/40">
        {keyframes.length} keyframe{keyframes.length === 1 ? "" : "s"}. Click
        one to see it next to the keyframe that follows.
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
