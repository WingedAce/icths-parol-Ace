import { useEffect, useLayoutEffect, useRef, useState } from "react";

import ParolPreview from "./ParolPreview";
import {
  buildInbetweens,
  makeKeyFrames,
  remapFramesToBeats,
} from "../utils/audioTiming";
import {
  MAX_CHANGE_BPM,
  MIN_CHANGE_BPM,
  changeAt,
  effectiveAnalysis,
  isValidChangeBpm,
  segmentBpmAt,
  snapFramesFrom,
  sortChanges,
} from "../utils/bpmChanges";
import { loadAudio, saveAudio } from "../lib/audioStore";
import { stable } from "../lib/cloudSync";
import { localGet, localSet } from "../lib/localDraft";
import { exportVideo, isVideoExportSupported } from "../utils/videoExport";
import {
  getPinClipboard,
  setPinClipboard,
  type PinClipboard,
} from "../utils/pinClipboard";
import {
  FULL_LEVEL,
  MIN_LEVEL,
  PIN_COLORS,
  analogPinSet,
  buildPinUnits,
  formatPin,
  isTricolorOn,
  levelOf,
  pruneLevels,
  setTricolorOn,
  tricolorColor,
} from "../utils/pins";
import type {
  AudioSection,
  BpmChange,
  Frame,
  ProjectNode,
  TimingMode,
  Transition,
} from "../types";

// Two times closer than this (in seconds) count as "the same moment".
const SAME_MOMENT = 0.02;
// A keyframe this close (in seconds) to a beat counts as sitting on it.
const ON_BEAT = 0.001;
// How close a dragged keyframe may get to the keyframe next to it.
const MIN_KEY_GAP = 0.025;

const pillClass =
  "cursor-pointer rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.15em] text-white/60 transition hover:border-white/25 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:border-white/10 disabled:hover:text-white/60";
const labelClass = "mb-3 text-[10px] uppercase tracking-[0.3em] text-white/30";
const linkClass =
  "cursor-pointer text-xs text-white/30 underline underline-offset-2 hover:text-white/60";
const navClass = `${pillClass} inline-flex items-center gap-2`;
// Small action buttons above the pin chips (Select all / Turn all off).
const miniPillClass =
  "cursor-pointer rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.15em] text-white/60 transition hover:border-white/25 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:border-white/10 disabled:hover:text-white/60";

// How far the timeline bar can be stretched. 1 = the whole song fits on screen;
// 8 = the bar is eight screens wide and scrolls sideways.
const ZOOM_LEVELS = [1, 2, 4, 6, 8, 12, 16, 24];

// How a keyframe moves on to the next keyframe.
const TRANSITIONS: { value: Transition; label: string; hint: string }[] = [
  {
    value: "hold",
    label: "Hold",
    hint: "Keep this keyframe's lights on until the next keyframe.",
  },
  {
    value: "ripple",
    label: "Ripple",
    hint: "Change the lights one pin at a time, spread evenly over the beats in between.",
  },
  {
    value: "alternate",
    label: "Alternate",
    hint: "Flip between this keyframe's lights and the next one's on every beat.",
  },
  {
    value: "fade",
    label: "Fade",
    hint: "Dim analog pins smoothly from this keyframe's brightness to the next one's. Digital pins switch halfway.",
  },
];

type SequenceEditorProps = {
  // The Group node: owns the drawing, zones and pin mappings.
  groupNode: ProjectNode;
  // The Song node: owns the audio analysis and the keyframes.
  animationNode: ProjectNode;
  onFramesChange: (frames: Frame[]) => void;
  // Saves the timing mode and/or the BPM change points on the Song node.
  onTimingChange: (timing: {
    timingMode?: TimingMode;
    bpmChanges?: BpmChange[];
  }) => void;
  // Used by the Trial tab: its animationNode is a copy with its own id, so
  // this says whose saved song file to play instead. When it is set, a file
  // loaded here is only played, never saved over the real round's song.
  audioSourceId?: string;
};

// m:ss.t  (tenths of a second, because beats are only ~0.5s apart)
function formatTime(seconds: number) {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const secs = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(secs).padStart(2, "0")}.${tenths % 10}`;
}

// m:ss.hh  (hundredths, for keyframes placed at an exact time)
function formatTimeFine(seconds: number) {
  const hundredths = Math.round(seconds * 100);
  const minutes = Math.floor(hundredths / 6000);
  const secs = Math.floor((hundredths % 6000) / 100);
  return `${minutes}:${String(secs).padStart(2, "0")}.${String(
    hundredths % 100,
  ).padStart(2, "0")}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// 125 -> "125", 145.5 -> "145.5"
const fmtBpm = (n: number) => String(Math.round(n * 10) / 10);

// Index of the beat closest to a time.
function nearestIndex(beats: number[], t: number) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < beats.length; i++) {
    const distance = Math.abs(beats[i] - t);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

// Plain drawn arrow, so it never turns into a color emoji.
function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === "left" ? "M10 3 L5 8 L10 13" : "M6 3 L11 8 L6 13"} />
    </svg>
  );
}

// Undo / redo. One snapshot is everything the Preview tab can change on the
// Song node, so a single Undo also rolls back a tempo change together with the
// keyframes it moved.
type HistorySnapshot = {
  frames: Frame[];
  timingMode?: TimingMode;
  bpmChanges?: BpmChange[];
};
// How many steps back Undo can go.
const HISTORY_LIMIT = 100;

// Plain drawn curved arrow, same style as Chevron.
function UndoRedoIcon({ direction }: { direction: "undo" | "redo" }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={direction === "redo" ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M6 3 L2.5 6.5 L6 10" />
      <path d="M2.5 6.5 H9.5 A3.75 3.75 0 0 1 9.5 14 H6.5" />
    </svg>
  );
}

type BpmPopoverProps = {
  // Where it sits: under the timeline bar or under the control row.
  anchor: "bar" | "row";
  // "Beat 17 · 1:02.4"
  title: string;
  // BPM of the change point that is already on this beat, if there is one.
  existing?: number;
  // The tempo at this beat right now, shown as a hint.
  currentBpm: number;
  onSave: (bpm: number) => void;
  onRemove: () => void;
  onClose: () => void;
};

// Small box for typing a new BPM (or editing/removing a change point). It is
// closed from outside (Esc, a click elsewhere) by SequenceEditor.
function BpmPopover({
  anchor,
  title,
  existing,
  currentBpm,
  onSave,
  onRemove,
  onClose,
}: BpmPopoverProps) {
  const [text, setText] = useState(existing !== undefined ? String(existing) : "");
  const [error, setError] = useState("");

  return (
    <div
      data-bpm-popover=""
      className={`absolute z-30 w-64 max-w-full rounded-xl border border-white/15 bg-[#0b0b0b] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.5)] ${
        anchor === "bar"
          ? "left-1/2 top-full mt-2 -translate-x-1/2"
          : "left-0 top-full mt-2"
      }`}
    >
      <p className="text-[10px] uppercase tracking-[0.25em] text-white/30">
        {existing !== undefined ? "Tempo change at" : "Set BPM from"}
      </p>
      <p className="mt-1 font-serif text-sm text-white">{title}</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(text);
          if (text.trim() === "" || !isValidChangeBpm(value)) {
            setError(`Enter a BPM from ${MIN_CHANGE_BPM} to ${MAX_CHANGE_BPM}.`);
            return;
          }
          onSave(value);
        }}
        className="mt-3 flex flex-wrap items-center gap-2"
      >
        <input
          type="number"
          step="any"
          autoFocus
          placeholder={`Now ${fmtBpm(currentBpm)}`}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError("");
          }}
          className="w-24 rounded-full border border-white/10 bg-transparent px-3 py-1 text-center text-xs text-white/80 outline-none focus:border-white/30"
        />
        <button type="submit" className={miniPillClass}>
          {existing !== undefined ? "Save" : "Set"}
        </button>
        <button type="button" onClick={onClose} className={linkClass}>
          Cancel
        </button>
      </form>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {existing !== undefined && (
        <button
          type="button"
          onClick={onRemove}
          className={`mt-3 ${linkClass}`}
          title="Go back to the tempo this stretch had before"
        >
          Remove this change
        </button>
      )}
    </div>
  );
}

function SequenceEditor({
  groupNode,
  animationNode,
  onFramesChange: saveFrames,
  onTimingChange: saveTiming,
  audioSourceId,
}: SequenceEditorProps) {
  // The playhead, in seconds. This is the source of truth for "where are we".
  const [time, setTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  // Loop button: when on, the light show and the song start over from the
  // beginning each time they reach the end, until Pause is pressed. The ref
  // lets the playback loop see a change made while it is already running.
  const [loopOn, setLoopOn] = useState(false);
  const loopRef = useRef(false);
  // The app never stores the MP3 itself, so to hear the song the user can
  // load the file here. It stays on their computer, only in this tab.
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clockRef = useRef({ startMs: 0, startTime: 0 });

  // The small BPM box: which beat it is for and where it is shown.
  const [popover, setPopover] = useState<{
    anchor: "bar" | "row";
    beatTime: number;
  } | null>(null);
  // A keyframe being dragged (Manual timing): where it is right now.
  const [drag, setDrag] = useState<{ id: string; time: number } | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  // Zoom: the bar is made wider inside a frame that scrolls sideways.
  const [zoomIndex, setZoomIndex] = useState(0);
  const zoom = ZOOM_LEVELS[zoomIndex];
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // How far along the zoomed timeline the view is (0 = start, 1 = end).
  const [viewRatio, setViewRatio] = useState(0);
  // Where to keep the view after a zoom change (see zoomTo).
  const pendingZoom = useRef<{ ratio: number; screenX: number } | null>(null);
  // "Go to beat" box.
  const [beatQuery, setBeatQuery] = useState("");
  const [beatError, setBeatError] = useState("");
  const dragRef = useRef<{
    id: string;
    startX: number;
    moved: boolean;
    lo: number;
    hi: number;
    time: number;
  } | null>(null);

  // The stored beats with the song's BPM change points applied. Everything
  // below (playhead, beat labels, in-betweens) uses this beat grid.
  const baseAnalysis = animationNode.audioAnalysis;
  const analysis = effectiveAnalysis(baseAnalysis, animationNode.bpmChanges);
  const duration = analysis?.duration ?? 0;
  // Keyframes/beats/sections are all measured from the start of the
  // analyzed clip (0 = clip start), but the stored audio file (see
  // audioStore.ts) is the ORIGINAL, untrimmed song — so every place that
  // touches the <audio> element's own currentTime needs to add/subtract
  // this offset to stay in sync with clip-relative time everywhere else.
  const clipStart = analysis?.clipStart ?? 0;

  // ---- Pin clipboard (copy pins from one keyframe, paste on another) ----
  // Kept outside the keyframes (see utils/pinClipboard.ts), so it survives
  // moving between keyframes and is never saved with the project.
  const [pinClip, setPinClip] = useState<PinClipboard | null>(() =>
    getPinClipboard(),
  );

  // ---- Undo / redo ----
  // Every change made on this tab goes through onFramesChange /
  // onTimingChange below, which first remember what things looked like. The
  // history lives only here (nothing new is saved), so it starts fresh each
  // time the Preview tab is opened.
  const undoStack = useRef<HistorySnapshot[]>([]);
  const redoStack = useRef<HistorySnapshot[]>([]);
  // One click can change frames AND timing (a tempo change moves keyframes);
  // that must count as one step, so only the first change per tick records.
  const recordedThisTick = useRef(false);
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });

  const syncHistorySize = () =>
    setHistorySize({
      undo: undoStack.current.length,
      redo: redoStack.current.length,
    });

  const takeSnapshot = (): HistorySnapshot => ({
    frames: animationNode.frames ?? [],
    timingMode: animationNode.timingMode,
    bpmChanges: animationNode.bpmChanges,
  });

  const recordHistory = () => {
    if (recordedThisTick.current) return;
    recordedThisTick.current = true;
    queueMicrotask(() => {
      recordedThisTick.current = false;
    });
    undoStack.current.push(takeSnapshot());
    if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
    // A new change ends the "redo" path.
    redoStack.current = [];
    syncHistorySize();
  };

  const onFramesChange = (next: Frame[]) => {
    recordHistory();
    saveFrames(next);
  };

  const onTimingChange = (timing: {
    timingMode?: TimingMode;
    bpmChanges?: BpmChange[];
  }) => {
    // Clicking the timing mode that is already selected changes nothing.
    if (
      "timingMode" in timing &&
      !("bpmChanges" in timing) &&
      timing.timingMode === animationNode.timingMode
    ) {
      return;
    }
    recordHistory();
    saveTiming(timing);
  };

  const restoreSnapshot = (snapshot: HistorySnapshot) => {
    saveFrames(snapshot.frames);
    saveTiming({
      timingMode: snapshot.timingMode,
      bpmChanges: snapshot.bpmChanges,
    });
    setPopover(null);
  };

  const undo = () => {
    const snapshot = undoStack.current.pop();
    if (!snapshot) return;
    redoStack.current.push(takeSnapshot());
    restoreSnapshot(snapshot);
    syncHistorySize();
  };

  const redo = () => {
    const snapshot = redoStack.current.pop();
    if (!snapshot) return;
    undoStack.current.push(takeSnapshot());
    restoreSnapshot(snapshot);
    syncHistorySize();
  };

  // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y = redo. Left alone
  // while typing in a box, so the box's own undo keeps working there.
  const historyActions = useRef({ undo, redo });
  useEffect(() => {
    historyActions.current = { undo, redo };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) historyActions.current.redo();
        else historyActions.current.undo();
      } else if (key === "y") {
        event.preventDefault();
        historyActions.current.redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The history is also kept in this browser, so Undo still works after a
  // reload or after leaving the tab. It is only used when the song's saved
  // state is exactly the state the history ended on; otherwise (something
  // changed elsewhere) it is dropped rather than risk undoing into the wrong
  // thing.
  const historyKey = `history-v1:${animationNode.id}`;
  const [historyReady, setHistoryReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void localGet<{
      current: string;
      undo: HistorySnapshot[];
      redo: HistorySnapshot[];
    }>(historyKey).then((saved) => {
      if (cancelled) return;
      if (
        saved &&
        undoStack.current.length === 0 &&
        redoStack.current.length === 0 &&
        saved.current === stable(takeSnapshot())
      ) {
        undoStack.current = saved.undo ?? [];
        redoStack.current = saved.redo ?? [];
        syncHistorySize();
      }
      setHistoryReady(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey]);

  useEffect(() => {
    if (!historyReady) return;
    void localSet(historyKey, {
      current: stable(takeSnapshot()),
      undo: undoStack.current,
      redo: redoStack.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    historyReady,
    historySize,
    historyKey,
    animationNode.frames,
    animationNode.timingMode,
    animationNode.bpmChanges,
  ]);

  // ---- Save as video ----
  const [videoExport, setVideoExport] = useState<{
    state: "idle" | "working" | "done" | "error";
    progress: number;
    message?: string;
  }>({ state: "idle", progress: 0 });
  const exportAbort = useRef<AbortController | null>(null);

  // Stop a running export if the user leaves the tab.
  useEffect(() => {
    return () => exportAbort.current?.abort();
  }, []);

  // Free the loaded audio file when it's replaced or this tab closes.
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  // The song uploaded on the Song tab is kept in the browser (see
  // lib/audioStore.ts), so load it automatically and Play has sound
  // without the student picking the file again.
  useEffect(() => {
    let cancelled = false;
    loadAudio(audioSourceId ?? animationNode.id)
      .then((blob) => {
        if (cancelled || !blob) return;
        setAudioUrl(URL.createObjectURL(blob));
      })
      .catch(() => {});
    return () => {
      cancelled = true
    };
  }, [animationNode.id, audioSourceId]);

  // The BPM box closes on Esc or a click anywhere else.
  useEffect(() => {
    if (!popover) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopover(null);
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-bpm-popover], [data-bpm-trigger]")
      ) {
        return;
      }
      setPopover(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [popover]);

  // Playback loop: moves the playhead forward in real time. If an audio
  // file is loaded, the audio is the clock so lights and sound stay locked.
  useEffect(() => {
    if (!isPlaying) return;

    const audio = audioUrl ? audioRef.current : null;
    if (audio) {
      audio.currentTime = clipStart + clockRef.current.startTime;
      audio.play().catch(() => setIsPlaying(false));
    }

    let frameId = 0;
    const tick = () => {
      const now = audio
        ? audio.currentTime - clipStart
        : clockRef.current.startTime +
          (performance.now() - clockRef.current.startMs) / 1000;

      if (now >= duration) {
        if (loopRef.current && duration > 0) {
          // Back to the start: the song and the lights restart together.
          clockRef.current = { startMs: performance.now(), startTime: 0 };
          if (audio) audio.currentTime = clipStart;
          setTime(0);
          frameId = requestAnimationFrame(tick);
          return;
        }
        setTime(duration);
        setIsPlaying(false);
        return;
      }
      setTime(now);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      if (audio) audio.pause();
    };
  }, [isPlaying, audioUrl, duration, clipStart]);

  // After zooming, keep the same part of the song in the same place on screen.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = pendingZoom.current;
    if (!el || !anchor) return;
    pendingZoom.current = null;
    el.scrollLeft = anchor.ratio * el.scrollWidth - anchor.screenX;
  }, [zoomIndex]);

  // When zoomed in, keep the playhead on screen: it scrolls the timeline when
  // the playhead runs off the edge (playing, stepping through beats,
  // "Go to beat", jumping between keyframes ...). Moving the scroll slider by
  // hand does not trigger this, so it never fights the user.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || duration <= 0 || el.scrollWidth <= el.clientWidth + 1) return;
    const x = (time / duration) * el.scrollWidth;
    const margin = 24;
    if (x >= el.scrollLeft + margin && x <= el.scrollLeft + el.clientWidth - margin) {
      return;
    }
    // While playing, turn the page: put the playhead near the left edge so
    // there is room ahead of it. Otherwise centre it.
    el.scrollLeft = isPlaying ? x - el.clientWidth * 0.15 : x - el.clientWidth / 2;
  }, [time, duration, isPlaying]);

  if (!analysis) {
    return (
      <p className="text-center text-sm text-white/30">
        Upload a song on the Song tab to start building the light sequence.
      </p>
    );
  }

  const beats = analysis.beatTimes;

  if (beats.length === 0) {
    return (
      <p className="text-center text-sm text-white/30">
        No beats were detected in this song, so there is nothing to snap
        keyframes to.
      </p>
    );
  }

  const frames = [...(animationNode.frames ?? [])].sort(
    (a, b) => a.time - b.time,
  );

  const pins = Array.from(
    new Set((groupNode.pinMappings ?? []).map((m) => m.pin)),
  ).sort((a, b) => a - b);

  // Pins the Zone Map tab marked as analog (dimmable).
  const analogPins = analogPinSet(groupNode);

  // In-betweens are worked out from the keyframes every time, never stored.
  const tricolorGroups = groupNode.tricolorGroups ?? [];
  // What the editor shows as one button each: plain pins, and every tricolor
  // LED as a single unit (its 3 pins are always on or off together).
  const pinUnits = buildPinUnits(pins, tricolorGroups);
  const mergedGroups = pinUnits.flatMap((u) => (u.group ? [u.group] : []));
  const inbetweens = buildInbetweens(
    analysis,
    frames,
    analogPins,
    mergedGroups,
  );
  const allFrames = [...frames, ...inbetweens].sort((a, b) => a.time - b.time);

  const span = duration || 1;

  // ---- Where the playhead is ----
  const beatIndex = nearestIndex(beats, time);

  const sectionAt = (t: number): AudioSection | undefined =>
    analysis.sections.find((s) => t >= s.start && t < s.end) ??
    analysis.sections[analysis.sections.length - 1];

  const section = sectionAt(time);
  const sectionIndex = section ? analysis.sections.indexOf(section) : -1;
  const previousSection =
    sectionIndex > 0 ? analysis.sections[sectionIndex - 1] : undefined;
  // Like the Song tab: only mention the BPM when it changes.
  const showBpm =
    section !== undefined &&
    (!previousSection ||
      Math.round(previousSection.bpm) !== Math.round(section.bpm));

  // Lights hold the last keyframe's pins until the next keyframe.
  const frameAt = (t: number): Frame | undefined => {
    let current: Frame | undefined;
    for (const frame of allFrames) {
      if (frame.time <= t + SAME_MOMENT) current = frame;
      else break;
    }
    return current;
  };
  const litPinsAt = (t: number): number[] => frameAt(t)?.litPins ?? [];
  const levelsAt = (t: number) => frameAt(t)?.levels;
  const colorsAt = (t: number) => frameAt(t)?.tricolors;

  const keyframeHere = frames.find(
    (f) => Math.abs(f.time - time) < SAME_MOMENT,
  );
  const litNow = litPinsAt(time);
  const levelsNow = levelsAt(time);
  const colorsNow = colorsAt(time);

  const inbetweenHere = keyframeHere
    ? undefined
    : inbetweens.find((f) => Math.abs(f.time - time) < SAME_MOMENT);
  const nextKeyframe = keyframeHere
    ? frames.find((f) => f.time > keyframeHere.time + SAME_MOMENT)
    : undefined;

  // ---- Timing mode and tempo changes ----
  const isManual = animationNode.timingMode === "manual";
  const changes = sortChanges(animationNode.bpmChanges);
  const segments = analysis.tempoSegments;
  // The tempo in effect at a time.
  const bpmAt = (t: number) =>
    segments ? segmentBpmAt(segments, t) : (sectionAt(t)?.bpm ?? analysis.bpm);

  // Keyframes may sit between beats (placed in Manual timing). They are still
  // shown, played and exported at their exact time.
  const isOffGrid = (t: number) =>
    Math.abs(beats[nearestIndex(beats, t)] - t) > ON_BEAT;
  const offGridCount = frames.filter((f) => isOffGrid(f.time)).length;
  // Tenths of a second are enough on the beat grid; off-beat times and Manual
  // timing show hundredths.
  const fmtKey = (t: number) =>
    isManual || isOffGrid(t) ? formatTimeFine(t) : formatTime(t);

  // "125 → 145 → 120 BPM", or the BPM here plus a count when there are many.
  const segmentLabel = !segments
    ? ""
    : segments.length <= 4
      ? `${segments.map((seg) => fmtBpm(seg.bpm)).join(" → ")} BPM`
      : `${fmtBpm(segmentBpmAt(segments, time))} BPM here · ${segments.length - 1} tempo changes`;

  // ---- Moving the playhead ----
  const seek = (t: number) => {
    const clamped = Math.min(duration, Math.max(0, t));
    setTime(clamped);
    clockRef.current = { startMs: performance.now(), startTime: clamped };
    if (audioRef.current && audioUrl)
      audioRef.current.currentTime = clipStart + clamped;
  };

  // Manual timing: fine playhead movement.
  const nudge = (delta: number) => seek(round2(time + delta));

  // The time under a pointer, measured along the timeline bar.
  const timeFromClientX = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return time;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  const stepBeat = (direction: 1 | -1) => {
    let target = beatIndex;
    if (direction === 1) {
      target = beats[beatIndex] > time + SAME_MOMENT ? beatIndex : beatIndex + 1;
    } else {
      target = beats[beatIndex] < time - SAME_MOMENT ? beatIndex : beatIndex - 1;
    }
    target = Math.min(beats.length - 1, Math.max(0, target));
    seek(beats[target]);
  };

  // Zoom in or out around the playhead (or around the middle of the view if the
  // playhead is off screen).
  const zoomTo = (index: number) => {
    const next = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index));
    if (next === zoomIndex) return;
    const el = scrollRef.current;
    if (el && el.scrollWidth > 0) {
      const playheadX = (time / span) * el.scrollWidth - el.scrollLeft;
      if (playheadX >= 0 && playheadX <= el.clientWidth) {
        pendingZoom.current = { ratio: time / span, screenX: playheadX };
      } else {
        pendingZoom.current = {
          ratio: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth,
          screenX: el.clientWidth / 2,
        };
      }
    }
    setZoomIndex(next);
  };

  // "Go to beat": type a beat number (as shown in "Beat 67 of 240") and the
  // playhead jumps there. The timeline follows it when zoomed in.
  const jumpToBeat = () => {
    const text = beatQuery.trim();
    const number = Number(text);
    if (text === "" || !Number.isInteger(number) || number < 1 || number > beats.length) {
      setBeatError(`Enter a beat from 1 to ${beats.length}.`);
      return;
    }
    setBeatError("");
    seek(beats[number - 1]);
  };

  const jumpKeyframe = (direction: 1 | -1) => {
    const target =
      direction === 1
        ? frames.find((f) => f.time > time + SAME_MOMENT)
        : [...frames].reverse().find((f) => f.time < time - SAME_MOMENT);
    if (target) seek(target.time);
  };

  const toggleLoop = () => {
    const next = !loopRef.current;
    loopRef.current = next;
    setLoopOn(next);
  };

  const togglePlay = () => {
    setPopover(null);
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    seek(time >= duration - 0.05 ? 0 : time);
    setIsPlaying(true);
  };

  // ---- Editing keyframes ----
  const sortByTime = (list: Frame[]) => [...list].sort((a, b) => a.time - b.time);

  const addKeyframe = () => {
    // Beat timing: keyframes always sit exactly on a beat. Manual timing: at
    // the exact playhead time (on the beat itself if the playhead is on one).
    const snapped =
      isManual && isOffGrid(time) ? round2(time) : beats[beatIndex];
    if (frames.some((f) => Math.abs(f.time - snapped) < SAME_MOMENT)) {
      seek(snapped);
      return;
    }
    const newFrame: Frame = {
      id: crypto.randomUUID(),
      kind: "key",
      sectionId: sectionAt(snapped)?.id,
      time: snapped,
      // Start from what is already lit, so you only change what's different.
      litPins: [...litPinsAt(snapped)],
      ...(levelsAt(snapped) ? { levels: { ...levelsAt(snapped) } } : {}),
      ...(colorsAt(snapped) ? { tricolors: { ...colorsAt(snapped) } } : {}),
    };
    onFramesChange(sortByTime([...frames, newFrame]));
    seek(snapped);
  };

  const deleteKeyframe = () => {
    if (!keyframeHere) return;
    onFramesChange(frames.filter((f) => f.id !== keyframeHere.id));
  };

  const setHerePins = (litPins: number[]) => {
    if (!keyframeHere) return;
    onFramesChange(
      frames.map((f) =>
        f.id === keyframeHere.id
          ? { ...f, litPins, levels: pruneLevels(f.levels, litPins) }
          : f,
      ),
    );
  };

  // Brightness of one analog pin, in percent.
  const setHereLevel = (pin: number, level: number) => {
    if (!keyframeHere) return;
    onFramesChange(
      frames.map((f) =>
        f.id === keyframeHere.id
          ? { ...f, levels: { ...(f.levels ?? {}), [pin]: level } }
          : f,
      ),
    );
  };

  const setTransition = (transition: Transition) => {
    if (!keyframeHere) return;
    onFramesChange(
      frames.map((f) =>
        f.id === keyframeHere.id ? { ...f, transition } : f,
      ),
    );
  };

  const togglePin = (pin: number) => {
    if (!keyframeHere) return;
    setHerePins(
      keyframeHere.litPins.includes(pin)
        ? keyframeHere.litPins.filter((p) => p !== pin)
        : [...keyframeHere.litPins, pin],
    );
  };

  // A tricolor LED is one thing: all 3 pins go on or off together.
  const toggleUnit = (unit: (typeof pinUnits)[number]) => {
    if (!keyframeHere) return;
    if (!unit.group) {
      togglePin(unit.pins[0]);
      return;
    }
    setHerePins(
      setTricolorOn(
        keyframeHere.litPins,
        unit.group,
        !isTricolorOn(unit.group, keyframeHere.litPins),
      ),
    );
  };

  // The color of a tricolor LED in this keyframe only.
  const setHereTricolor = (groupId: string, color: string) => {
    if (!keyframeHere) return;
    onFramesChange(
      frames.map((f) =>
        f.id === keyframeHere.id
          ? { ...f, tricolors: { ...(f.tricolors ?? {}), [groupId]: color } }
          : f,
      ),
    );
  };

  // Brightness of every analog pin of a unit at once (a tricolor LED dims as
  // one).
  const setHereUnitLevel = (pinsOfUnit: number[], level: number) => {
    if (!keyframeHere) return;
    onFramesChange(
      frames.map((f) =>
        f.id === keyframeHere.id
          ? {
              ...f,
              levels: {
                ...(f.levels ?? {}),
                ...Object.fromEntries(
                  pinsOfUnit
                    .filter((p) => f.litPins.includes(p))
                    .map((p) => [p, level]),
                ),
              },
            }
          : f,
      ),
    );
  };

  // ---- Copy / paste pins between keyframes ----
  // The keyframe right before the one at the playhead.
  const previousKeyframe = keyframeHere
    ? [...frames].reverse().find((f) => f.time < keyframeHere.time - SAME_MOMENT)
    : undefined;

  const copyPins = (source: Frame | undefined) => {
    if (!source) return;
    const next = { litPins: source.litPins, levels: source.levels };
    setPinClipboard(next);
    setPinClip(getPinClipboard());
  };

  // Writes copied pins onto the keyframe at the playhead. Pins that no longer
  // exist on this parol are skipped.
  const applyPins = (clip: PinClipboard | null) => {
    if (!keyframeHere || !clip) return;
    const valid = clip.litPins.filter((p) => pins.includes(p));
    const sorted = [...valid].sort((a, b) => a - b);
    const kept = pruneLevels(clip.levels, sorted);
    onFramesChange(
      frames.map((f) => {
        if (f.id !== keyframeHere.id) return f;
        const { levels: _old, ...rest } = f;
        return { ...rest, litPins: sorted, ...(kept ? { levels: kept } : {}) };
      }),
    );
  };

  // One click: take the previous keyframe's pins and put them here.
  const copyFromPrevious = () => {
    if (!previousKeyframe) return;
    copyPins(previousKeyframe);
    applyPins({ litPins: previousKeyframe.litPins, levels: previousKeyframe.levels });
  };

  // ---- Save as video ----
  const startVideoExport = async () => {
    if (videoExport.state === "working") return;
    setIsPlaying(false);
    setPopover(null);
    const controller = new AbortController();
    exportAbort.current = controller;
    setVideoExport({ state: "working", progress: 0 });

    try {
      let audioData: ArrayBuffer | undefined;
      if (audioUrl) {
        try {
          audioData = await (await fetch(audioUrl)).arrayBuffer();
        } catch {
          audioData = undefined;
        }
      }

      const result = await exportVideo({
        node: groupNode,
        frames: allFrames,
        duration,
        clipStart,
        audioData,
        signal: controller.signal,
        onProgress: (ratio) =>
          setVideoExport({ state: "working", progress: ratio }),
      });

      const baseName = (animationNode.audioFileName ?? "parol-preview").replace(
        /\.[^.]+$/,
        "",
      );
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${baseName}.${result.extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      setVideoExport({
        state: "done",
        progress: 1,
        message: result.hasAudio
          ? "Saved. Check your downloads."
          : "Saved without sound (the song file wasn't available). Check your downloads.",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setVideoExport({ state: "idle", progress: 0 });
      } else {
        setVideoExport({
          state: "error",
          progress: 0,
          message: error instanceof Error ? error.message : "Export failed.",
        });
      }
    } finally {
      exportAbort.current = null;
    }
  };

  const cancelVideoExport = () => exportAbort.current?.abort();

  const addSectionKeyframes = () => {
    const snapped = makeKeyFrames(analysis).map((frame) => ({
      ...frame,
      time: beats[nearestIndex(beats, frame.time)],
    }));
    onFramesChange(sortByTime(snapped));
  };

  const startOver = () => {
    if (window.confirm("Reset all keyframes and start over? The song stays.")) {
      setIsPlaying(false);
      seek(0);
      onFramesChange([]);
    }
  };

  // Manual timing: drop a dragged keyframe at its new exact time.
  const moveKeyframe = (id: string, newTime: number) => {
    onFramesChange(
      sortByTime(
        frames.map((f) =>
          f.id === id
            ? { ...f, time: newTime, sectionId: sectionAt(newTime)?.id ?? f.sectionId }
            : f,
        ),
      ),
    );
    seek(newTime);
  };

  // ---- BPM change points ----
  const applyChanges = (nextChanges: BpmChange[], fromTime: number) => {
    if (!baseAnalysis) return;
    const nextBeats = effectiveAnalysis(baseAnalysis, nextChanges).beatTimes;
    // Beat timing: from that beat on, the keyframes follow the new beats.
    // Manual timing: no keyframe moves at all.
    if (!isManual && frames.length > 0) {
      onFramesChange(sortByTime(snapFramesFrom(frames, fromTime, nextBeats)));
    }
    onTimingChange({
      bpmChanges: nextChanges.length > 0 ? nextChanges : undefined,
    });
    setPopover(null);
  };

  const saveChange = (beatTime: number, bpm: number) =>
    applyChanges(
      sortChanges([
        ...changes.filter((c) => c !== changeAt(changes, beatTime)),
        { beatTime, bpm },
      ]),
      beatTime,
    );

  const removeChange = (beatTime: number) =>
    applyChanges(
      changes.filter((c) => c !== changeAt(changes, beatTime)),
      beatTime,
    );

  const toggleRowPopover = () => {
    if (popover?.anchor === "row") setPopover(null);
    else setPopover({ anchor: "row", beatTime: beats[beatIndex] });
  };

  const resetToBeats = () => {
    if (
      window.confirm(
        "Move every keyframe to its nearest beat? Keyframes between beats will shift.",
      )
    ) {
      onFramesChange(remapFramesToBeats(frames, beats));
    }
  };

  // The BPM box, shown under the bar or under the control row.
  const renderPopover = (anchor: "bar" | "row") => {
    if (!popover || popover.anchor !== anchor) return null;
    const index = nearestIndex(beats, popover.beatTime);
    return (
      <BpmPopover
        key={popover.beatTime}
        anchor={anchor}
        title={`Beat ${index + 1} · ${formatTime(beats[index])}`}
        existing={changeAt(changes, beats[index])?.bpm}
        currentBpm={bpmAt(beats[index])}
        onSave={(bpm) => saveChange(beats[index], bpm)}
        onRemove={() => removeChange(beats[index])}
        onClose={() => setPopover(null)}
      />
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Hidden player, only used when the user loads the song file */}
      <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" />

      {/* Readout */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-serif text-3xl text-white">
          {isManual ? formatTimeFine(time) : formatTime(time)}
        </p>
        <p className="text-xs text-white/40">
          Beat {beatIndex + 1} of {beats.length}
          {sectionIndex >= 0 && ` · Section ${sectionIndex + 1}`}
          {segments
            ? ` · ${fmtBpm(bpmAt(time))} BPM`
            : showBpm && section && ` · ${Math.round(section.bpm)} BPM`}
        </p>
      </div>

      {/* The parol, lit the way it would be at the playhead */}
      <ParolPreview
        node={groupNode}
        litPins={litNow}
        levels={levelsNow}
        tricolorColors={colorsNow}
        allowPinLabels
      />

      {/* Timeline strip: section lines, keyframe markers, playhead */}
      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/30">
            Timeline · {frames.length} keyframe{frames.length === 1 ? "" : "s"} ·{" "}
            {inbetweens.length} in-between{inbetweens.length === 1 ? "" : "s"}
          </p>
          {segmentLabel && (
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">
              {segmentLabel}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={undo}
              disabled={historySize.undo === 0}
              aria-label="Undo"
              title="Undo your last change (Ctrl+Z)"
              className={`${miniPillClass} inline-flex items-center gap-1.5`}
            >
              <UndoRedoIcon direction="undo" />
              Undo
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={historySize.redo === 0}
              aria-label="Redo"
              title="Redo (Ctrl+Shift+Z or Ctrl+Y)"
              className={`${miniPillClass} inline-flex items-center gap-1.5`}
            >
              <UndoRedoIcon direction="redo" />
              Redo
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/30">
              Zoom
            </span>
            <button
              type="button"
              onClick={() => zoomTo(zoomIndex - 1)}
              disabled={zoomIndex === 0}
              aria-label="Zoom out"
              title="Zoom out"
              className={`${miniPillClass} px-2.5`}
            >
              −
            </button>
            <span className="w-8 text-center text-xs text-white/60">{zoom}×</span>
            <button
              type="button"
              onClick={() => zoomTo(zoomIndex + 1)}
              disabled={zoomIndex === ZOOM_LEVELS.length - 1}
              aria-label="Zoom in"
              title="Zoom in to see how far apart the keyframes are"
              className={`${miniPillClass} px-2.5`}
            >
              +
            </button>
            {zoomIndex > 0 && (
              <button type="button" onClick={() => zoomTo(0)} className={linkClass}>
                Fit
              </button>
            )}
          </div>
        </div>
        <div className="relative">
        {/* The frame scrolls sideways when zoomed in. Its own scrollbar is
            hidden; the slider under it does the same job. */}
        <div
          ref={scrollRef}
          onScroll={(event) => {
            const el = event.currentTarget;
            const room = el.scrollWidth - el.clientWidth;
            setViewRatio(room > 0 ? el.scrollLeft / room : 0);
          }}
          className="overflow-x-auto overflow-y-hidden rounded-xl border border-white/10 bg-white/[0.03] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
        <div
          ref={barRef}
          className="relative h-12 cursor-pointer"
          style={{ width: `${zoom * 100}%` }}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.min(
              1,
              Math.max(0, (event.clientX - rect.left) / rect.width),
            );
            // Beat timing: land on the nearest beat. Manual timing: the exact
            // spot that was clicked.
            seek(
              isManual
                ? round2(ratio * duration)
                : beats[nearestIndex(beats, ratio * duration)],
            );
          }}
        >
          {analysis.sections.map((s, index) =>
            index === 0 ? null : (
              <div
                key={s.id}
                className="absolute inset-y-0 w-px bg-white/10"
                style={{ left: `${(s.start / span) * 100}%` }}
              />
            ),
          )}

          {/* Manual timing: the beats as a quiet guide. Click a dot to change
              the tempo from that beat on. */}
          {isManual &&
            beats.map((beat, i) => {
              const before = i > 0 ? beat - beats[i - 1] : Infinity;
              const after = i < beats.length - 1 ? beats[i + 1] - beat : Infinity;
              const room = Math.min(before, after);
              const width = Number.isFinite(room) ? (room / span) * 100 : 2;
              return (
                <button
                  key={`beat-${i}`}
                  type="button"
                  data-bpm-trigger=""
                  title={`Beat ${i + 1} · ${formatTime(beat)} — click to set the tempo from here`}
                  onClick={(event) => {
                    if (isPlaying) return;
                    event.stopPropagation();
                    setPopover({ anchor: "bar", beatTime: beat });
                  }}
                  className="group absolute top-1/2 flex h-4 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center"
                  style={{ left: `${(beat / span) * 100}%`, width: `${width}%` }}
                >
                  <span className="h-1 w-1 rounded-full bg-white/15 transition group-hover:scale-[2] group-hover:bg-white/80" />
                </button>
              );
            })}

          {inbetweens.map((frame) => (
            <div
              key={frame.id}
              className="pointer-events-none absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/25"
              style={{ left: `${(frame.time / span) * 100}%` }}
            />
          ))}

          {frames.map((frame, index) => {
            // Manual timing: a keyframe can be dragged along the bar. It stays
            // between its neighbours so the order (and the transitions) never
            // change. A plain click still just moves the playhead there.
            const canDrag = isManual && !isPlaying;
            const shownTime = drag?.id === frame.id ? drag.time : frame.time;
            return (
              <button
                key={frame.id}
                title={fmtKey(shownTime)}
                onPointerDown={(event) => {
                  if (!canDrag) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const previous = frames[index - 1];
                  const next = frames[index + 1];
                  dragRef.current = {
                    id: frame.id,
                    startX: event.clientX,
                    moved: false,
                    lo: previous ? previous.time + MIN_KEY_GAP : 0,
                    hi: next ? next.time - MIN_KEY_GAP : duration,
                    time: frame.time,
                  };
                }}
                onPointerMove={(event) => {
                  const d = dragRef.current;
                  if (!d || d.id !== frame.id) return;
                  if (!d.moved && Math.abs(event.clientX - d.startX) < 4) return;
                  d.moved = true;
                  d.time = Math.min(
                    d.hi,
                    Math.max(d.lo, round2(timeFromClientX(event.clientX))),
                  );
                  setDrag({ id: d.id, time: d.time });
                }}
                onPointerUp={() => {
                  const d = dragRef.current;
                  dragRef.current = null;
                  setDrag(null);
                  if (!d || d.id !== frame.id) return;
                  if (d.moved) moveKeyframe(d.id, d.time);
                  else seek(frame.time);
                }}
                onPointerCancel={() => {
                  dragRef.current = null;
                  setDrag(null);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!canDrag) seek(frame.time);
                }}
                className={`absolute inset-y-2 w-2 -translate-x-1/2 cursor-pointer rounded-full transition ${
                  canDrag ? "touch-none" : ""
                } ${
                  frame.id === keyframeHere?.id
                    ? "bg-white"
                    : "bg-white/40 hover:bg-white/80"
                }`}
                style={{ left: `${(shownTime / span) * 100}%` }}
              />
            );
          })}

          {/* Tempo changes: a thin line and a small BPM label */}
          {changes.map((change) => (
            <div
              key={`change-line-${change.beatTime}`}
              className="pointer-events-none absolute inset-y-0 w-px bg-white/25"
              style={{ left: `${(change.beatTime / span) * 100}%` }}
            />
          ))}
          {changes.map((change) => (
            <button
              key={`change-${change.beatTime}`}
              type="button"
              data-bpm-trigger=""
              title={`Tempo changes to ${fmtBpm(change.bpm)} BPM at Beat ${
                nearestIndex(beats, change.beatTime) + 1
              } · ${formatTime(change.beatTime)} — click to edit or remove`}
              onClick={(event) => {
                if (isPlaying) return;
                event.stopPropagation();
                setPopover({ anchor: "bar", beatTime: change.beatTime });
              }}
              className="absolute top-0 z-20 -translate-x-1/2 cursor-pointer rounded-b-md border border-t-0 border-white/20 bg-black/70 px-1 text-[9px] leading-4 text-white/70 transition hover:border-white/40 hover:text-white"
              style={{ left: `${(change.beatTime / span) * 100}%` }}
            >
              {fmtBpm(change.bpm)}
            </button>
          ))}

          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-white"
            style={{ left: `${(time / span) * 100}%` }}
          />
        </div>
        </div>
        {renderPopover("bar")}
        </div>

        {/* Zoomed in: a second slider to move along the song */}
        {zoom > 1 && (
          <div className="mt-2">
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={viewRatio}
              onChange={(event) => {
                const el = scrollRef.current;
                if (!el) return;
                el.scrollLeft =
                  Number(event.target.value) * (el.scrollWidth - el.clientWidth);
              }}
              aria-label="Scroll the timeline left and right"
              title="Drag to scroll the zoomed timeline"
              className="w-full accent-white/40"
            />
            <p className="mt-1 text-[10px] text-white/30">
              Zoomed {zoom}× · drag this slider (or scroll sideways) to move
              along the song
            </p>
          </div>
        )}

        {isManual ? (
          /* Manual timing: the slider moves in hundredths of a second */
          <input
            type="range"
            min={0}
            max={duration}
            step={0.01}
            value={time}
            onChange={(event) => seek(Number(event.target.value))}
            className="mt-4 w-full accent-white"
          />
        ) : (
          /* Beat slider: moving it always lands exactly on a beat */
          <input
            type="range"
            min={0}
            max={beats.length - 1}
            step={1}
            value={beatIndex}
            onChange={(event) => seek(beats[Number(event.target.value)])}
            className="mt-4 w-full accent-white"
          />
        )}
      </div>

      {/* Transport */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={togglePlay}
          className="cursor-pointer rounded-full bg-white px-6 py-2 text-xs uppercase tracking-[0.15em] text-black transition hover:bg-white/90"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button
          onClick={toggleLoop}
          aria-pressed={loopOn}
          title="Keep playing the light show and the song over and over until you press Pause"
          className={`cursor-pointer rounded-full border px-5 py-2 text-xs uppercase tracking-[0.15em] transition ${
            loopOn
              ? "border-amber-200/70 bg-amber-200/15 text-amber-100"
              : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
          }`}
        >
          {loopOn ? "Loop: on" : "Loop"}
        </button>
        <button onClick={() => stepBeat(-1)} className={navClass}>
          <Chevron direction="left" />
          Beat
        </button>
        <button onClick={() => stepBeat(1)} className={navClass}>
          Beat
          <Chevron direction="right" />
        </button>
        <button
          onClick={() => jumpKeyframe(-1)}
          disabled={!frames.some((f) => f.time < time - SAME_MOMENT)}
          className={navClass}
        >
          <Chevron direction="left" />
          Keyframe
        </button>
        <button
          onClick={() => jumpKeyframe(1)}
          disabled={!frames.some((f) => f.time > time + SAME_MOMENT)}
          className={navClass}
        >
          Keyframe
          <Chevron direction="right" />
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            jumpToBeat();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            inputMode="numeric"
            value={beatQuery}
            onChange={(event) => {
              setBeatQuery(event.target.value.replace(/\D/g, ""));
              setBeatError("");
            }}
            placeholder="Go to beat"
            aria-label="Go to beat number"
            className="w-28 rounded-full border border-white/10 bg-transparent px-3 py-2 text-center text-xs text-white/80 outline-none placeholder:text-white/30 focus:border-white/30"
          />
          <button type="submit" className={miniPillClass}>
            Go
          </button>
        </form>
        {beatError && <p className="w-full text-xs text-red-400">{beatError}</p>}
        {isManual && (
          <>
            <button
              onClick={() => nudge(-0.01)}
              title="Move the playhead back 0.01 seconds"
              className={`${miniPillClass} self-center`}
            >
              −0.01s
            </button>
            <button
              onClick={() => nudge(0.01)}
              title="Move the playhead forward 0.01 seconds"
              className={`${miniPillClass} self-center`}
            >
              +0.01s
            </button>
          </>
        )}
      </div>

      {/* Timing mode and tempo changes: the one extra row */}
      <div>
        <div className="relative flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Timing mode"
            className="inline-flex rounded-full border border-white/10 p-0.5"
          >
            {(
              [
                {
                  value: "beat",
                  label: "Beat timing",
                  hint: "New keyframes snap to the beats.",
                },
                {
                  value: "manual",
                  label: "Manual timing",
                  hint: "Place keyframes at any exact time. The dots on the bar are only a guide.",
                },
              ] as const
            ).map((option) => {
              const active = (isManual ? "manual" : "beat") === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  title={option.hint}
                  aria-pressed={active}
                  onClick={() => onTimingChange({ timingMode: option.value })}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.15em] transition ${
                    active
                      ? "border-white/40 bg-white/[0.08] text-white"
                      : "border-transparent text-white/50 hover:text-white"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            data-bpm-trigger=""
            onClick={toggleRowPopover}
            disabled={isPlaying}
            title="Change the tempo from the beat nearest the playhead onward"
            className={miniPillClass}
          >
            Set BPM
          </button>

          {offGridCount > 0 && (
            <button
              type="button"
              onClick={resetToBeats}
              title={`Move ${offGridCount} keyframe${offGridCount === 1 ? "" : "s"} that sit between beats to the nearest beat`}
              className={linkClass}
            >
              Reset to beats
            </button>
          )}

          {renderPopover("row")}
        </div>

        {isManual && (
          <p className="mt-2 text-[11px] text-white/25">
            Click the bar or nudge to pick an exact time.
          </p>
        )}
      </div>

      {/* Keyframe at the playhead */}
      <div>
        <p className={labelClass}>
          {keyframeHere
            ? `Keyframe at ${fmtKey(keyframeHere.time)}`
            : inbetweenHere
              ? "In-between beat (generated)"
              : isManual
                ? "No keyframe at this time"
                : "No keyframe at this beat"}
        </p>

        {!keyframeHere && (
          <button
            onClick={addKeyframe}
            disabled={isPlaying}
            className="mb-4 cursor-pointer rounded-xl bg-white px-6 py-3 font-serif text-black transition hover:bg-white/90 disabled:cursor-default disabled:opacity-30"
          >
            {inbetweenHere
              ? "Make this beat a keyframe"
              : isManual
                ? `Add keyframe at ${formatTimeFine(time)}`
                : `Add keyframe at beat ${beatIndex + 1}`}
          </button>
        )}

        {pins.length === 0 ? (
          <p className="text-sm text-white/30">
            No pins assigned yet. Assign pins on the Zone Map tab first.
          </p>
        ) : (
          <>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              onClick={() => setHerePins([...pins])}
              disabled={
                !keyframeHere ||
                isPlaying ||
                pins.every((pin) => keyframeHere.litPins.includes(pin))
              }
              className={miniPillClass}
            >
              Select all
            </button>
            <button
              onClick={() => setHerePins([])}
              disabled={!keyframeHere || isPlaying || keyframeHere.litPins.length === 0}
              className={miniPillClass}
            >
              Turn all off
            </button>
            <button
              onClick={() => copyFromPrevious()}
              disabled={!keyframeHere || isPlaying || !previousKeyframe}
              title="Use the pins of the keyframe before this one"
              className={miniPillClass}
            >
              Copy from previous
            </button>
            <button
              onClick={() => copyPins(keyframeHere)}
              disabled={!keyframeHere || isPlaying}
              title="Remember this keyframe's pins so you can paste them on another keyframe"
              className={miniPillClass}
            >
              Copy pins
            </button>
            <button
              onClick={() => applyPins(pinClip)}
              disabled={!keyframeHere || isPlaying || !pinClip}
              title={
                pinClip
                  ? `Paste ${pinClip.litPins.length} copied pin${pinClip.litPins.length === 1 ? "" : "s"} onto this keyframe`
                  : "Copy pins from a keyframe first"
              }
              className={miniPillClass}
            >
              Paste pins
              {pinClip ? ` (${pinClip.litPins.length})` : ""}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {pinUnits.map((unit) => {
              const shownPins = (keyframeHere ?? { litPins: litNow }).litPins;
              const isOn = unit.group
                ? isTricolorOn(unit.group, shownPins)
                : shownPins.includes(unit.pins[0]);
              return (
                <button
                  key={unit.key}
                  onClick={() => toggleUnit(unit)}
                  title={
                    unit.group
                      ? "A tricolor LED: its 3 pins go on and off together"
                      : undefined
                  }
                  disabled={!keyframeHere || isPlaying}
                  className={`rounded-full border px-3 py-1 font-serif text-xs transition ${
                    isOn
                      ? "border-white/40 bg-white/[0.08] text-white"
                      : "border-white/10 text-white/50"
                  } ${
                    keyframeHere && !isPlaying
                      ? "cursor-pointer hover:text-white"
                      : "cursor-default opacity-60"
                  }`}
                >
                  {unit.group
                    ? `Tricolor ${unit.pins.map(formatPin).join("+")}`
                    : `Pin ${formatPin(unit.pins[0])}`}
                </button>
              );
            })}
          </div>

          {/* One color per tricolor LED, for this keyframe only */}
          {mergedGroups.length > 0 && (
            <div className="mt-4 flex flex-col gap-2">
              {mergedGroups.map((g) => {
                const current = tricolorColor(
                  g,
                  (keyframeHere ?? { tricolors: colorsNow }).tricolors,
                );
                return (
                  <div
                    key={g.id}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
                  >
                    <span className="mr-1 text-[11px] text-white/45">
                      Tricolor {[...g.pins].sort((a, b) => a - b).map(formatPin).join("+")} color
                    </span>
                    {PIN_COLORS.map((c) => (
                      <button
                        key={c.name}
                        type="button"
                        title={c.name}
                        aria-label={`${c.name} for tricolor ${g.pins.map(formatPin).join("+")}`}
                        aria-pressed={current.toLowerCase() === c.hex.toLowerCase()}
                        disabled={!keyframeHere || isPlaying}
                        onClick={() => setHereTricolor(g.id, c.hex)}
                        className={`h-6 w-6 rounded-full border-2 transition ${
                          current.toLowerCase() === c.hex.toLowerCase()
                            ? "border-white ring-2 ring-white/30"
                            : "border-transparent"
                        } ${
                          keyframeHere && !isPlaying
                            ? "cursor-pointer hover:scale-110"
                            : "cursor-default opacity-50"
                        }`}
                        style={{ backgroundColor: c.hex }}
                      />
                    ))}
                    <input
                      type="color"
                      value={current}
                      disabled={!keyframeHere || isPlaying}
                      onChange={(event) =>
                        setHereTricolor(g.id, event.target.value)
                      }
                      aria-label="Custom color"
                      className="h-6 w-8 cursor-pointer rounded border border-white/10 bg-transparent disabled:cursor-default disabled:opacity-50"
                    />
                  </div>
                );
              })}
              {!keyframeHere && (
                <p className="text-xs text-white/30">
                  Each keyframe has its own tricolor colors. Add a keyframe
                  to change them.
                </p>
              )}
            </div>
          )}
          </>
        )}

        {!keyframeHere && pins.length > 0 && (
          <p className="mt-3 text-xs text-white/30">
            These are the pins on at this beat. Add a keyframe here to change
            them.
          </p>
        )}

        {/* Brightness for each analog pin (or tricolor LED) that is on in this keyframe */}
        {keyframeHere &&
          (() => {
            const dimUnits = pinUnits.filter((unit) =>
              unit.pins.some(
                (p) => analogPins.has(p) && keyframeHere.litPins.includes(p),
              ),
            );
            if (dimUnits.length === 0) return null;
            return (
              <div className="mt-5">
                <p className={labelClass}>Brightness</p>
                <div className="flex flex-col gap-3">
                  {dimUnits.map((unit) => {
                    const dimPins = unit.pins.filter(
                      (p) =>
                        analogPins.has(p) && keyframeHere.litPins.includes(p),
                    );
                    const level = Math.max(
                      ...dimPins.map((p) => levelOf(keyframeHere.levels, p)),
                    );
                    return (
                      <label
                        key={unit.key}
                        className="flex items-center gap-3 text-xs text-white/60"
                      >
                        <span className="w-24 font-serif">
                          {unit.group
                            ? `Tricolor ${unit.pins.map(formatPin).join("+")}`
                            : `Pin ${formatPin(unit.pins[0])}`}
                        </span>
                        <input
                          type="range"
                          min={MIN_LEVEL}
                          max={FULL_LEVEL}
                          step={5}
                          value={level}
                          disabled={isPlaying}
                          onChange={(event) =>
                            unit.group
                              ? setHereUnitLevel(
                                  dimPins,
                                  Number(event.target.value),
                                )
                              : setHereLevel(
                                  unit.pins[0],
                                  Number(event.target.value),
                                )
                          }
                          className="flex-1 accent-white"
                        />
                        <span className="w-10 text-right text-white/40">
                          {level}%
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })()}

        {keyframeHere && (
          <div className="mt-6">
            <p className={labelClass}>Transition to next keyframe</p>
            {nextKeyframe ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {TRANSITIONS.map((option) => {
                    const isActive =
                      (keyframeHere.transition ?? "hold") === option.value;
                    return (
                      <button
                        key={option.value}
                        onClick={() => setTransition(option.value)}
                        disabled={isPlaying}
                        className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.15em] transition ${
                          isActive
                            ? "border-white/40 bg-white/[0.08] text-white"
                            : "border-white/10 text-white/50 hover:text-white"
                        } ${isPlaying ? "cursor-default opacity-60" : "cursor-pointer"}`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-white/30">
                  {
                    TRANSITIONS.find(
                      (o) => o.value === (keyframeHere.transition ?? "hold"),
                    )?.hint
                  }
                </p>
              </>
            ) : (
              <p className="text-xs text-white/30">
                This is the last keyframe. Add a later one to choose how this
                one transitions.
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-4">
          {keyframeHere && (
            <button
              onClick={deleteKeyframe}
              disabled={isPlaying}
              className={linkClass}
            >
              Delete this keyframe
            </button>
          )}
          {frames.length === 0 && (
            <button onClick={addSectionKeyframes} className={linkClass}>
              Add a keyframe at the start of every section
            </button>
          )}
          {frames.length > 0 && (
            <button
              onClick={startOver}
              className="cursor-pointer rounded-full border border-white/15 px-4 py-1.5 text-xs uppercase tracking-wider text-white/60 transition hover:border-white/40 hover:text-white"
            >
              Reset keyframes
            </button>
          )}
        </div>
      </div>

      {/* Save the preview as a video, with the song */}
      <div>
        <p className={labelClass}>Save as video</p>
        {!isVideoExportSupported() ? (
          <p className="text-xs text-white/30">
            This browser can't record video. Use a recent Chrome, Edge or
            Firefox.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={startVideoExport}
                disabled={videoExport.state === "working" || frames.length === 0}
                className="cursor-pointer rounded-full bg-white px-6 py-2 text-xs uppercase tracking-[0.15em] text-black transition hover:bg-white/90 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-white"
              >
                {videoExport.state === "working"
                  ? `Recording ${Math.round(videoExport.progress * 100)}%`
                  : "Save as video"}
              </button>
              {videoExport.state === "working" && (
                <button onClick={cancelVideoExport} className={linkClass}>
                  Cancel
                </button>
              )}
            </div>
            {videoExport.state === "working" && (
              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-white transition-[width]"
                  style={{ width: `${videoExport.progress * 100}%` }}
                />
              </div>
            )}
            {videoExport.message && videoExport.state !== "working" && (
              <p
                className={`mt-3 text-xs ${
                  videoExport.state === "error" ? "text-red-400" : "text-white/50"
                }`}
              >
                {videoExport.message}
              </p>
            )}
            <p className="mt-2 text-[11px] text-white/25">
              Records the preview with the song, in real time, so it takes as
              long as the song. Keep this tab open and in front until it
              finishes. {frames.length === 0 && "Add a keyframe first."}
            </p>
          </>
        )}
      </div>

      {/* Optional sound */}
      <div>
        <label className={linkClass}>
          {audioUrl
            ? "Load a different audio file"
            : "Load the song file to hear it while previewing"}
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setIsPlaying(false);
              setAudioUrl(URL.createObjectURL(file));
              if (!audioSourceId) {
                saveAudio(animationNode.id, file).catch(() => {});
              }
            }}
          />
        </label>
        <p className="mt-2 text-[11px] text-white/25">
          The song is saved in this browser when you upload it on the Song
          tab, and plays here automatically. If you uploaded it before that
          was added, load the file once here. Without the file, Play runs the
          lights silently in real time.
        </p>
      </div>
    </div>
  );
}

export default SequenceEditor;