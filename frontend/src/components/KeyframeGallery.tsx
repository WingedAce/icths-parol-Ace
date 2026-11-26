import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import LazyMount from "./LazyMount";
import ParolPreview from "./ParolPreview";
import TransitionFolders from "./TransitionFolders";
import TransitionTiming from "./TransitionTiming";
import {
  autoStepCount,
  beatsBetween,
  buildInbetweens,
  changedUnits,
  inbetweenTimes,
  matchTolerance,
} from "../utils/audioTiming";
import {
  PRESET_GROUPS,
  PRESETS,
  presetLabel,
  isSweep,
  type Preset,
} from "../utils/transitionPresets";
import { effectiveAnalysis } from "../utils/bpmChanges";
import {
  FULL_LEVEL,
  MIN_LEVEL,
  PIN_COLORS,
  analogPinSet,
  describePins,
  formatPin,
  levelOf,
  pinPositions,
  pruneLevels,
  sameLights,
  tricolorColor,
} from "../utils/pins";
import type {
  AudioAnalysis,
  Frame,
  ManualStep,
  PinLevels,
  ProjectNode,
  SavedTransition,
} from "../types";

const pillClass =
  "cursor-pointer rounded-full px-4 py-2 text-xs text-fg-soft transition hover:text-fg disabled:cursor-default disabled:opacity-30 disabled:hover:border-line disabled:hover:text-fg-soft bg-elevated hover:bg-line-strong";
const linkClass =
  "cursor-pointer text-xs text-fg-muted underline underline-offset-2 hover:text-fg-soft disabled:cursor-default disabled:opacity-40 disabled:no-underline disabled:hover:text-fg-muted";
const primaryClass =
  "cursor-pointer rounded-lg bg-fg px-6 py-2 text-xs text-canvas transition hover:bg-fg/90 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-fg";
const labelClass = "mb-3 text-xs text-fg-muted";
const emptyBoxClass =
  "flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-line px-6 text-center text-sm text-fg-muted";

// How long the looping preview rests on the second keyframe before it
// starts over, in seconds.
const LOOP_TAIL = 0.6;

// How many in-betweens get a thumbnail in the strip at once. With a custom
// count there can be thousands, so only a window around the picked one shows.
const STRIP_WINDOW = 60;

type KeyframeGalleryProps = {
  // The Group node: owns the drawing, zones and pin mappings.
  groupNode: ProjectNode;
  // The Song node: owns the audio analysis and the keyframes.
  animationNode: ProjectNode;
  onFramesChange: (frames: Frame[]) => void;
  // Practice tab: the group's saved transitions, shown as folders, and how to
  // rename or delete them.
  transitions?: SavedTransition[];
  onTransitionsChange?: (next: SavedTransition[]) => void;
};

// m:ss.mmm  (for in-betweens that sit closer together than the beats)
function formatTimeFine(seconds: number) {
  const ms = Math.round(seconds * 1000);
  const minutes = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${String(secs).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

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

const toggleClass = (active: boolean) =>
  `cursor-pointer rounded-full px-4 py-2 text-xs transition ${
    active
      ? "text-fg bg-line-strong"
      : "text-fg-muted hover:text-fg bg-elevated hover:bg-line-strong"
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
      <ParolPreview
        node={groupNode}
        litPins={frame.litPins}
        levels={frame.levels}
        tricolorColors={frame.tricolors}
      />
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <p className="font-semibold tracking-tight text-2xl text-fg">Keyframe {number}</p>
        <p className="text-xs text-fg-muted">
          {formatTime(frame.time)}
          {section && ` · ${section}`}
        </p>
      </div>
      <p className="mt-1 text-xs text-fg-muted">
        {describePins(frame.litPins, frame.levels, analogPinSet(groupNode))}
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

type PairNavProps = {
  onBack: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
};

// Bottom row of the pair view: back to the grid, and step between keyframes.
function PairNav({ onBack, onPrevious, onNext }: PairNavProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
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

type TransitionLoopProps = {
  // First keyframe, every in-between, then the second keyframe.
  steps: Frame[];
  groupNode: ProjectNode;
  fromNumber: number;
  toNumber: number;
};

// The big preview: plays keyframe 1 -> in-betweens -> keyframe 2 over and
// over, at the song's real tempo, so you can watch the whole transition.
function TransitionLoop({
  steps,
  groupNode,
  fromNumber,
  toNumber,
}: TransitionLoopProps) {
  const start = steps[0].time;
  const span = steps[steps.length - 1].time - start;
  const total = span + LOOP_TAIL;

  // `offset` is seconds since the first keyframe.
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
      if (steps[i].time - start <= offset + 0.001) activeIndex = i;
    }
  }

  const betweenCount = steps.length - 2;
  const whatsShowing =
    activeIndex === 0
      ? `Keyframe ${fromNumber}`
      : activeIndex === steps.length - 1
        ? `Keyframe ${toNumber}`
        : `In-between ${activeIndex} of ${betweenCount}`;

  return (
    <div>
      <p className={labelClass}>
        Keyframe {fromNumber} to keyframe {toNumber}
      </p>
      <ParolPreview
        node={groupNode}
        litPins={steps[activeIndex].litPins}
        levels={steps[activeIndex].levels}
        tricolorColors={steps[activeIndex].tricolors}
      />
      <div className="mt-4 flex items-center gap-4">
        <button
          onClick={() => setPlaying((value) => !value)}
          className={pillClass}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <p className="text-xs text-fg-muted">{whatsShowing}</p>
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

  // The preset to fall back to when leaving Manual, and the one the apply
  // links use.
  const [lastPreset, setLastPreset] = useState<Preset>(
    mode === "manual" ? "hold" : mode,
  );
  const activePreset: Preset = isManual ? lastPreset : mode;

  // Pins the Zone Map tab marked as analog (dimmable).
  const analog = useMemo(() => analogPinSet(groupNode), [groupNode]);

  // Manual mode only offers the pins that keyframe 1 or keyframe 2 uses,
  // not every pin on the parol.
  const usedPins = useMemo(
    () =>
      Array.from(new Set([...from.litPins, ...to.litPins])).sort(
        (a, b) => a - b,
      ),
    [from.litPins, to.litPins],
  );

  // Where each pin sits on the drawing, for the spin / wipe presets.
  const positions = useMemo(
    () => pinPositions(groupNode.zones, groupNode.pinMappings),
    [groupNode.zones, groupNode.pinMappings],
  );

  // The units (pins, or whole tricolor LEDs) that differ between the two
  // keyframes, and when the in-betweens sit in time.
  const units = useMemo(
    () => changedUnits(from, to, analog, groupNode.tricolorGroups ?? []),
    [from, to, analog, groupNode.tricolorGroups],
  );
  const autoCount = autoStepCount(mode, units.length);
  const beatCount = useMemo(
    () => (analysis ? beatsBetween(analysis, from.time, to.time).length : 0),
    [analysis, from.time, to.time],
  );
  const stepTimes = useMemo(
    () => (analysis ? inbetweenTimes(analysis, from, to, autoCount) : []),
    [analysis, from, to, autoCount],
  );
  // How close a saved hand-made step has to be to count as this step.
  const tolerance = matchTolerance(from.time, to.time, stepTimes);

  // First keyframe, then one in-between per beat, then the second keyframe.
  // Hold has no generated in-betweens, so they are filled in here as copies
  // of the first keyframe, which is exactly what Hold looks like.
  const steps = useMemo(() => {
    let inbetweens: Frame[];
    if (mode === "hold") {
      inbetweens = stepTimes.map((time, index) => ({
        id: `${from.id}-${index + 1}`,
        kind: "inbetween",
        sectionId: from.sectionId,
        time,
        litPins: [...from.litPins],
        ...(from.levels ? { levels: { ...from.levels } } : {}),
        ...(from.tricolors ? { tricolors: { ...from.tricolors } } : {}),
      }));
    } else {
      inbetweens = analysis
        ? buildInbetweens(
            analysis,
            [from, to],
            analog,
            groupNode.tricolorGroups ?? [],
            positions,
          )
        : [];
    }
    return [from, ...inbetweens, to];
  }, [
    analysis,
    from,
    to,
    mode,
    stepTimes,
    analog,
    groupNode.tricolorGroups,
    positions,
  ]);

  const betweenCount = steps.length - 2;

  const changedPins = useMemo(() => {
    const all = new Set([...from.litPins, ...to.litPins]);
    return [...all].filter((pin) => {
      const inFrom = from.litPins.includes(pin);
      const inTo = to.litPins.includes(pin);
      if (inFrom !== inTo) return true;
      // Lit in both, but an analog pin at a different brightness.
      return (
        inFrom &&
        analog.has(pin) &&
        levelOf(from.levels, pin) !== levelOf(to.levels, pin)
      );
    }).length;
  }, [from, to, analog]);

  // ---- Which frame the middle panel shows ----
  // `offset` is seconds since the first keyframe. It stays tied to a beat's
  // time, so the same beat stays picked when the in-betweens change.
  const firstOffset = betweenCount > 0 ? steps[1].time - from.time : 0;
  const [offset, setOffset] = useState(firstOffset);

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
  const canEdit = isManual && isBetween;

  // Custom and sweep timing can put in-betweens closer than a tenth of a
  // second apart, so their times are shown to the millisecond.
  const fineTimes = (from.stepTiming ?? "auto") === "custom" || autoCount > 0;

  // With thousands of in-betweens only a window around the picked one gets
  // thumbnails.
  const stripCenter = Math.min(Math.max(activeIndex, 1), Math.max(betweenCount, 1));
  const stripStart = Math.max(
    1,
    Math.min(stripCenter - STRIP_WINDOW / 2, betweenCount - STRIP_WINDOW + 1),
  );
  const stripEnd = Math.min(betweenCount, stripStart + STRIP_WINDOW - 1);

  // ---- Manual mode: build one in-between, then save it ----
  // The pins being toggled for the beat that is showing. Nothing is stored
  // until the user presses Save.
  const [draft, setDraft] = useState<{
    index: number;
    litPins: number[];
    levels: PinLevels;
    tricolors: Record<string, string>;
  } | null>(null);

  const draftNow =
    canEdit && draft !== null && draft.index === activeIndex ? draft : null;
  const displayLit = draftNow?.litPins ?? showing.litPins;
  const displayLevels = draftNow?.levels ?? showing.levels;
  const displayColors = draftNow?.tricolors ?? showing.tricolors;

  // The tricolor LEDs this pair uses (any of their three pins is on in
  // keyframe 1 or 2), so Manual mode only lists colors that can matter.
  const colorGroups = useMemo(
    () =>
      (groupNode.tricolorGroups ?? []).filter((g) =>
        g.pins.some((pin) => usedPins.includes(pin)),
      ),
    [groupNode.tricolorGroups, usedPins],
  );

  const isSavedAt = (time: number) =>
    (from.manualSteps ?? []).some(
      (step) => Math.abs(step.time - time) < tolerance,
    );
  const savedCount = steps
    .slice(1, -1)
    .filter((step) => isSavedAt(step.time)).length;
  const isSavedHere = isBetween && isSavedAt(showing.time);
  const sameColors = (
    a: Record<string, string> | undefined,
    b: Record<string, string> | undefined,
  ) =>
    colorGroups.every(
      (g) =>
        tricolorColor(g, a).toLowerCase() === tricolorColor(g, b).toLowerCase(),
    );
  const draftChanged =
    draftNow !== null &&
    (!sameLights(
      draftNow.litPins,
      draftNow.levels,
      showing.litPins,
      showing.levels,
      analog,
    ) ||
      !sameColors(draftNow.tricolors, showing.tricolors));
  const canSave = canEdit && (draftChanged || !isSavedHere);

  const selectStep = (index: number) => {
    const t = Math.min(span, steps[index].time - from.time);
    setDraft(null);
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

  // Nothing is saved yet when Manual starts. Beats the user hasn't saved
  // keep the previous lights, which looks the same as Hold.
  const chooseManual = () => {
    setDraft(null);
    onChangeFrame({
      transition: "manual",
      manualSteps: from.manualSteps ?? [],
    });
  };

  const choosePresets = () => {
    setDraft(null);
    onChangeFrame({ transition: lastPreset });
  };

  // Save every in-between at once, using what a preset would make. This
  // replaces any in-betweens already saved for this pair.
  const fillFrom = (preset: Preset) => {
    setDraft(null);
    const seeded: ManualStep[] =
      preset === "hold" || !analysis
        ? stepTimes.map((time) => ({
            time,
            litPins: [...from.litPins],
            ...(from.levels ? { levels: { ...from.levels } } : {}),
            ...(from.tricolors ? { tricolors: { ...from.tricolors } } : {}),
          }))
        : buildInbetweens(
            analysis,
            // Same timing as the manual steps use now (beats or custom), not
            // the preset's own default speed, so the times line up.
            [
              {
                ...from,
                transition: preset,
                stepTiming: from.stepTiming === "custom" ? "custom" : "beat",
              },
              to,
            ],
            analog,
            groupNode.tricolorGroups ?? [],
            positions,
          ).map((f) => ({
            time: f.time,
            litPins: [...f.litPins],
            ...(f.levels ? { levels: { ...f.levels } } : {}),
            ...(f.tricolors ? { tricolors: { ...f.tricolors } } : {}),
          }));
    onChangeFrame({ transition: "manual", manualSteps: seeded });
  };

  // `tricolors` defaults to the colors showing now, so toggling a pin or
  // moving a slider never resets a color the user picked.
  const startDraft = (
    litPins: number[],
    levels?: PinLevels,
    tricolors: Record<string, string> | undefined = displayColors,
  ) => {
    if (!canEdit) return;
    const sorted = [...litPins].sort((a, b) => a - b);
    setDraft({
      index: activeIndex,
      litPins: sorted,
      levels: pruneLevels(levels, sorted) ?? {},
      tricolors: { ...(tricolors ?? {}) },
    });
  };

  const togglePin = (pin: number) => {
    const lit = displayLit;
    startDraft(
      lit.includes(pin) ? lit.filter((p) => p !== pin) : [...lit, pin],
      displayLevels,
    );
  };

  // Color of one tricolor LED in the in-between that is showing.
  const setColor = (groupId: string, color: string) =>
    startDraft(displayLit, displayLevels, {
      ...(displayColors ?? {}),
      [groupId]: color,
    });

  // Brightness of one analog pin that is on, in percent.
  const setLevel = (pin: number, level: number) =>
    startDraft(displayLit, { ...(displayLevels ?? {}), [pin]: level });

  // Store the in-between that is showing, replacing any earlier save for
  // the same beat.
  const saveStep = () => {
    if (!canSave) return;
    const others = (from.manualSteps ?? []).filter(
      (step) => Math.abs(step.time - showing.time) >= tolerance,
    );
    const sortedPins = [...displayLit].sort((a, b) => a - b);
    const keptLevels = pruneLevels(displayLevels, sortedPins);
    onChangeFrame({
      transition: "manual",
      manualSteps: [
        ...others,
        {
          time: showing.time,
          litPins: sortedPins,
          ...(keptLevels ? { levels: keptLevels } : {}),
          ...(displayColors && Object.keys(displayColors).length > 0
            ? { tricolors: { ...displayColors } }
            : {}),
        },
      ].sort((a, b) => a.time - b.time),
    });
    setDraft(null);
  };

  // Forget the saved in-between for this beat (it then keeps the previous
  // beat's lights).
  const removeSaved = () => {
    if (!isSavedHere) return;
    onChangeFrame({
      manualSteps: (from.manualSteps ?? []).filter(
        (step) => Math.abs(step.time - showing.time) >= tolerance,
      ),
    });
    setDraft(null);
  };

  // ---- Notes for the presets ----
  let note: string | null = null;
  if (!isManual && mode !== "hold") {
    if (betweenCount === 0) {
      note =
        "There are no in-betweens between these two keyframes, so the lights just switch. Use Custom timing to add some.";
    } else if (changedPins === 0) {
      note = `Both keyframes light the same pins${
        usedPins.some((pin) => analog.has(pin)) ? " at the same brightness" : ""
      }, so ${presetLabel(mode)} looks the same as Hold.`;
    } else if (mode === "fade" && !usedPins.some((pin) => analog.has(pin))) {
      note =
        "None of the pins used here are analog, so Fade just switches every pin halfway. Mark a pin as analog on the Zone Map tab to fade it.";
    } else if (
      (mode === "ripple" || isSweep(mode)) &&
      changedPins > betweenCount
    ) {
      note =
        "More pins change than there are in-betweens, so some pins change on the same step.";
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
              nothing to fill in. Custom timing can add in-betweens anyway.
            </div>
          ) : (
            <>
              <ParolPreview
                node={groupNode}
                litPins={displayLit}
                levels={displayLevels}
                tricolorColors={displayColors}
              />
              <div className="mt-3 flex items-baseline justify-between gap-3">
                <p className="font-semibold tracking-tight text-2xl text-fg">
                  {isBetween
                    ? `In-between ${activeIndex}`
                    : `Keyframe ${activeIndex === 0 ? fromNumber : toNumber}`}
                </p>
                <p className="text-xs text-fg-muted">
                  {fineTimes
                    ? formatTimeFine(showing.time)
                    : formatTime(showing.time)}
                  {isBetween && ` · ${activeIndex} of ${betweenCount}`}
                </p>
              </div>
              <p className="mt-1 text-xs text-fg-muted">
                {describePins(displayLit, displayLevels, analog)}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => stepBeat(-1)} className={pillClass}>
                  Previous step
                </button>
                <button onClick={() => stepBeat(1)} className={pillClass}>
                  Next step
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
            {betweenCount} in-between{betweenCount === 1 ? "" : "s"}
            {fineTimes
              ? `, about every ${Math.round((span / (betweenCount + 1)) * 1000)} ms`
              : ", one per beat"}
            {betweenCount > STRIP_WINDOW &&
              ` · showing ${stripStart} to ${stripEnd}`}
          </p>
          <div
            ref={stripRef}
            className="relative flex gap-3 overflow-x-auto pb-3"
          >
            {steps.slice(stripStart, stripEnd + 1).map((step, i) => {
              const index = stripStart + i;
              return (
                <button
                  key={step.id}
                  data-step={index}
                  onClick={() => selectStep(index)}
                  className="w-28 shrink-0 cursor-pointer text-left"
                >
                  <div
                    className={`rounded-xl ring-1 transition ${
                      index === activeIndex
                        ? "ring-line-hover"
                        : "ring-transparent hover:ring-line-hover"
                    }`}
                  >
                    <ParolPreview
                      node={groupNode}
                      litPins={index === activeIndex ? displayLit : step.litPins}
                      levels={index === activeIndex ? displayLevels : step.levels}
                      tricolorColors={
                        index === activeIndex ? displayColors : step.tricolors
                      }
                    />
                  </div>
                  <p className="mt-2 text-xs text-fg-muted">{index}</p>
                  <p className="text-xs text-fg-muted">
                    {fineTimes ? formatTimeFine(step.time) : formatTime(step.time)}
                    {isManual &&
                      (isSavedAt(step.time) ? " · Saved" : " · Not saved")}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* The big looping preview sits beside the controls on wide screens */}
      <div className="grid items-start gap-8 lg:grid-cols-2">
        <div className="min-w-0 lg:sticky lg:top-6 lg:order-2">
          <TransitionLoop
            steps={steps}
            groupNode={groupNode}
            fromNumber={fromNumber}
            toNumber={toNumber}
          />
        </div>

        {/* How the in-betweens are made */}
        <div className="min-w-0 rounded-xl bg-surface p-6 lg:order-1">
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
            <p className="text-xs text-fg-muted">
              {betweenCount} in-between{betweenCount === 1 ? "" : "s"} ·{" "}
              {changedPins} pin{changedPins === 1 ? "" : "s"} differ
            </p>
          </div>

          {mode !== "hold" && (
            <div className="mt-6">
              <TransitionTiming
                from={from}
                to={to}
                autoCount={autoCount}
                beatCount={beatCount}
                currentCount={betweenCount}
                onChange={(patch) => {
                  setDraft(null);
                  onChangeFrame(patch);
                }}
              />
            </div>
          )}

          {!isManual ? (
            <div className="mt-6">
              <div className="flex flex-col gap-4">
                {PRESET_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className={labelClass}>{group.label}</p>
                    <div className="flex flex-wrap gap-2">
                      {group.options.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => pickPreset(option.value)}
                          className={toggleClass(mode === option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-xs text-fg-muted">
                {PRESETS.find((o) => o.value === mode)?.hint}
              </p>
              {note && <p className="mt-2 text-xs text-warn">{note}</p>}

              <div className="mt-6 flex flex-wrap gap-4">
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Change the transition of EVERY keyframe to ${presetLabel(activePreset)}? This replaces the transition each keyframe has now.`,
                      )
                    )
                      onApplyToAll(activePreset);
                  }}
                  className={linkClass}
                >
                  Use {presetLabel(activePreset)} for every keyframe
                </button>
                {sectionName && sectionMates > 0 && (
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          `Change the transition of every keyframe in ${sectionName} to ${presetLabel(activePreset)}? This replaces what they have now.`,
                        )
                      )
                        onApplyToSection(activePreset);
                    }}
                    className={linkClass}
                  >
                    Use {presetLabel(activePreset)} for all of {sectionName}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <p className="text-sm text-fg-soft">
                {betweenCount === 0
                  ? `There are no in-betweens between keyframe ${fromNumber} and keyframe ${toNumber}. Set Custom timing above to make some.`
                  : `Between keyframe ${fromNumber} and keyframe ${toNumber} you can make ${betweenCount} in-between${
                      betweenCount === 1 ? "" : "s"
                    }. ${savedCount} saved.`}
              </p>
              {(from.manualSteps?.length ?? 0) > savedCount && (
                <p className="mt-2 text-xs text-warn">
                  {(from.manualSteps?.length ?? 0) - savedCount} saved
                  in-between
                  {(from.manualSteps?.length ?? 0) - savedCount === 1
                    ? " does"
                    : "s do"}{" "}
                  not line up with the current timing and{" "}
                  {(from.manualSteps?.length ?? 0) - savedCount === 1
                    ? "is"
                    : "are"}{" "}
                  ignored.
                </p>
              )}

              {betweenCount > 0 && (
                <>
                  <p className="mt-6 text-xs text-fg-muted">
                    {canEdit
                      ? `In-between ${activeIndex}: tap a pin to turn it on or off, then save it.`
                      : "Pick an in-between above to make it."}
                  </p>

                  {usedPins.length === 0 ? (
                    <p className="mt-3 text-xs text-fg-muted">
                      Both keyframes have every pin off, so there are no pins to
                      turn on in between.
                    </p>
                  ) : (
                    <>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {usedPins.map((pin) => {
                          const isOn = displayLit.includes(pin);
                          return (
                            <button
                              key={pin}
                              onClick={() => togglePin(pin)}
                              disabled={!canEdit}
                              className={`rounded-full px-3 py-1 font-medium text-xs transition ${
                                isOn
                                  ? "text-fg bg-line-strong"
                                  : "text-fg-muted bg-elevated"
                              } ${
                                canEdit
                                  ? "cursor-pointer hover:text-fg"
                                  : "cursor-default opacity-60"
                              }`}
                            >
                              Pin {pin}
                              {analog.has(pin) && " · analog"}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-3 text-xs text-fg-muted">
                        Only the pins used by keyframe {fromNumber} or keyframe{" "}
                        {toNumber} are shown.
                      </p>

                      {/* One color per tricolor LED, for this in-between only */}
                      {colorGroups.length > 0 && (
                        <div className="mt-5">
                          <p className={labelClass}>Tricolor colors</p>
                          <div className="flex flex-col gap-2">
                            {colorGroups.map((g) => {
                              const current = tricolorColor(g, displayColors);
                              const sortedPins = [...g.pins].sort(
                                (a, b) => a - b,
                              );
                              const label = sortedPins.map(formatPin).join("+");
                              return (
                                <div
                                  key={g.id}
                                  className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2"
                                >
                                  <span className="mr-1 text-xs text-fg-muted">
                                    Tricolor {label}
                                  </span>
                                  {PIN_COLORS.map((c) => {
                                    const picked =
                                      current.toLowerCase() ===
                                      c.hex.toLowerCase();
                                    return (
                                      <button
                                        key={c.name}
                                        type="button"
                                        title={c.name}
                                        aria-label={`${c.name} for tricolor ${label}`}
                                        aria-pressed={picked}
                                        disabled={!canEdit}
                                        onClick={() => setColor(g.id, c.hex)}
                                        className={`h-6 w-6 rounded-full border-2 transition ${
                                          picked
                                            ? "border-fg ring-2 ring-line-hover"
                                            : "border-transparent"
                                        } ${
                                          canEdit
                                            ? "cursor-pointer hover:scale-110"
                                            : "cursor-default opacity-50"
                                        }`}
                                        style={{ backgroundColor: c.hex }}
                                      />
                                    );
                                  })}
                                  <input
                                    type="color"
                                    value={current}
                                    disabled={!canEdit}
                                    onChange={(event) =>
                                      setColor(g.id, event.target.value)
                                    }
                                    aria-label={`Custom color for tricolor ${label}`}
                                    className="h-6 w-8 cursor-pointer rounded border bg-transparent disabled:cursor-default disabled:opacity-50 border-transparent"
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Brightness for each analog pin that is on */}
                      {canEdit &&
                        usedPins.some(
                          (pin) => analog.has(pin) && displayLit.includes(pin),
                        ) && (
                          <div className="mt-5">
                            <p className={labelClass}>Brightness</p>
                            <div className="flex flex-col gap-3">
                              {usedPins
                                .filter(
                                  (pin) =>
                                    analog.has(pin) && displayLit.includes(pin),
                                )
                                .map((pin) => {
                                  const level = levelOf(displayLevels, pin);
                                  return (
                                    <label
                                      key={pin}
                                      className="flex items-center gap-3 text-xs text-fg-soft"
                                    >
                                      <span className="w-14 font-medium">
                                        Pin {pin}
                                      </span>
                                      <input
                                        type="range"
                                        min={MIN_LEVEL}
                                        max={FULL_LEVEL}
                                        step={5}
                                        value={level}
                                        onChange={(event) =>
                                          setLevel(pin, Number(event.target.value))
                                        }
                                        className="flex-1 accent-pine"
                                      />
                                      <span className="w-10 text-right text-fg-muted">
                                        {level}%
                                      </span>
                                    </label>
                                  );
                                })}
                            </div>
                          </div>
                        )}
                    </>
                  )}

                  <div className="mt-5 flex flex-wrap items-center gap-4">
                    <button
                      onClick={saveStep}
                      disabled={!canSave}
                      className={primaryClass}
                    >
                      Save in-between{isBetween ? ` ${activeIndex}` : ""}
                    </button>
                    {canEdit && (
                      <span
                        className={`text-xs ${
                          canSave ? "text-warn" : "text-fg-muted"
                        }`}
                      >
                        {canSave ? "Not saved yet" : "Saved"}
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-4">
                    <button
                      onClick={() => startDraft(from.litPins, from.levels, from.tricolors)}
                      disabled={!canEdit}
                      className={linkClass}
                    >
                      Copy keyframe {fromNumber}
                    </button>
                    <button
                      onClick={() => startDraft(to.litPins, to.levels, to.tricolors)}
                      disabled={!canEdit}
                      className={linkClass}
                    >
                      Copy keyframe {toNumber}
                    </button>
                    <button
                      onClick={() => startDraft([])}
                      disabled={!canEdit}
                      className={linkClass}
                    >
                      Turn all off
                    </button>
                    <button
                      onClick={() => setDraft(null)}
                      disabled={!draftChanged}
                      className={linkClass}
                    >
                      Undo changes
                    </button>
                    <button
                      onClick={removeSaved}
                      disabled={!canEdit || !isSavedHere}
                      className={linkClass}
                    >
                      Remove this saved in-between
                    </button>
                  </div>

                  <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-line pt-5">
                    <span className="text-xs text-fg-muted">
                      Save all {betweenCount} in-between
                      {betweenCount === 1 ? "" : "s"} at once from
                    </span>
                    {PRESETS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => fillFrom(option.value)}
                        className={linkClass}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {nav}
    </div>
  );
}

function KeyframeGallery({
  groupNode,
  animationNode,
  onFramesChange,
  transitions,
  onTransitionsChange,
}: KeyframeGalleryProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Select mode: tick keyframes, then remove the in-betweens after them.
  const [selectMode, setSelectMode] = useState(false);
  const [pickedIds, setPickedIds] = useState<string[]>([]);

  // The beat grid with any BPM change points applied, so the in-betweens
  // follow the same beats as the Preview tab. Worked out again only when the
  // song or its BPM changes move, not on every redraw.
  const analysis = useMemo(
    () => effectiveAnalysis(animationNode.audioAnalysis, animationNode.bpmChanges),
    [animationNode.audioAnalysis, animationNode.bpmChanges],
  );

  const keyframes = useMemo(
    () =>
      (animationNode.frames ?? [])
        .filter((f) => f.kind === "key")
        .sort((a, b) => a.time - b.time),
    [animationNode.frames],
  );

  const folders = transitions && transitions.length > 0 && (
    <TransitionFolders
      groupNode={groupNode}
      transitions={transitions}
      onChange={onTransitionsChange}
    />
  );

  const hasParol =
    !!groupNode.imageDataUrl &&
    (groupNode.zones?.length ?? 0) > 0 &&
    (groupNode.pinMappings?.length ?? 0) > 0;

  if (!hasParol) {
    return (
      <p className="text-center text-sm text-fg-muted">
        Detect zones and assign pins on the Zone Map tab to see your keyframes
        here.
      </p>
    );
  }

  if (keyframes.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <p className="text-center text-sm text-fg-muted">
          No keyframes yet. Add some on the Preview tab and they will show up
          here.
        </p>
        {folders}
      </div>
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
  // The last keyframe has no transition after it, so it can't be picked.
  const lastId = keyframes[keyframes.length - 1].id;
  const pickable = keyframes.filter((f) => f.id !== lastId);
  const picked = pickable.filter((f) => pickedIds.includes(f.id));
  const withInbetweens = picked.filter(
    (f) => (f.transition ?? "hold") !== "hold",
  );

  const togglePicked = (id: string) =>
    setPickedIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );

  const leaveSelectMode = () => {
    setSelectMode(false);
    setPickedIds([]);
  };

  // Only the transition is switched to Hold (no in-betweens). The keyframes,
  // their pins and any hand-made in-betweens stay saved on the keyframe, so
  // choosing Manual again on that pair brings them back.
  const removeInbetweens = () => {
    if (withInbetweens.length === 0) return;
    if (
      !window.confirm(
        `Remove the in-betweens after ${withInbetweens.length} keyframe${
          withInbetweens.length === 1 ? "" : "s"
        }? The keyframes themselves stay, and each transition becomes Hold (no in-betweens).`,
      )
    ) {
      return;
    }
    const ids = new Set(withInbetweens.map((f) => f.id));
    onFramesChange(
      (animationNode.frames ?? []).map((f) =>
        ids.has(f.id) ? { ...f, transition: "hold" as const } : f,
      ),
    );
    leaveSelectMode();
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-fg-muted">
        {keyframes.length} keyframe{keyframes.length === 1 ? "" : "s"}.{" "}
        {selectMode
          ? "Tick the keyframes whose in-betweens (the transition after them) you want to remove."
          : "Click one to see it next to the keyframe that follows and edit the transition between them."}
      </p>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          onClick={() => (selectMode ? leaveSelectMode() : setSelectMode(true))}
          className="cursor-pointer rounded-full bg-elevated px-4 py-2 text-fg-soft transition hover:bg-line-strong hover:text-fg"
        >
          {selectMode ? "Done selecting" : "Select keyframes"}
        </button>
        {selectMode && (
          <>
            <button
              onClick={() =>
                setPickedIds(
                  picked.length === pickable.length
                    ? []
                    : pickable.map((f) => f.id),
                )
              }
              className="cursor-pointer rounded-full bg-elevated px-4 py-2 text-fg-soft transition hover:bg-line-strong hover:text-fg"
            >
              {picked.length === pickable.length ? "Clear" : "Select all"}
            </button>
            <button
              onClick={removeInbetweens}
              disabled={withInbetweens.length === 0}
              className="cursor-pointer rounded-full bg-elevated px-4 py-2 text-fg transition hover:bg-line-strong disabled:cursor-default disabled:opacity-40"
            >
              Remove in-betweens ({withInbetweens.length})
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {keyframes.map((frame, index) => (
          <button
            key={frame.id}
            onClick={() => {
              if (!selectMode) setSelectedId(frame.id);
              else if (frame.id !== lastId) togglePicked(frame.id);
            }}
            className="group min-w-0 cursor-pointer text-left"
          >
            <div
              className={`relative rounded-xl ring-1 transition group-hover:ring-line-hover ${
                pickedIds.includes(frame.id)
                  ? "ring-2 ring-sky-400"
                  : "ring-transparent"
              } ${selectMode && frame.id === lastId ? "opacity-40" : ""}`}
            >
              <LazyMount>
                <ParolPreview
                  node={groupNode}
                  litPins={frame.litPins}
                  levels={frame.levels}
                  tricolorColors={frame.tricolors}
                />
              </LazyMount>
              <span className="pointer-events-none absolute left-3 top-2 font-medium text-lg text-fg [text-shadow:0_1px_6px_rgba(0,0,0,0.9)]">
                {index + 1}
              </span>
            </div>
            <p className="mt-2 text-xs text-fg-muted">
              {formatTime(frame.time)} · {pinsOnLabel(frame)}
              {selectMode && frame.id !== lastId
                ? (frame.transition ?? "hold") === "hold"
                  ? " · no in-betweens"
                  : ` · ${presetLabel(frame.transition as Preset)}`
                : ""}
            </p>
          </button>
        ))}
      </div>

      {folders}
    </div>
  );
}

export default KeyframeGallery;
