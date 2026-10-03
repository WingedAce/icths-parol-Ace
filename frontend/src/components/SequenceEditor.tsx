import { useEffect, useRef, useState } from "react";

import ParolPreview from "./ParolPreview";
import { makeKeyFrames } from "../utils/audioTiming";
import type { AudioSection, Frame, ProjectNode } from "../types";

// Two times closer than this (in seconds) count as "the same moment".
const SAME_MOMENT = 0.02;

const pillClass =
  "cursor-pointer rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.15em] text-white/60 transition hover:border-white/25 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:border-white/10 disabled:hover:text-white/60";
const labelClass = "mb-3 text-[10px] uppercase tracking-[0.3em] text-white/30";
const linkClass =
  "cursor-pointer text-xs text-white/30 underline underline-offset-2 hover:text-white/60";

type SequenceEditorProps = {
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

function SequenceEditor({
  groupNode,
  animationNode,
  onFramesChange,
}: SequenceEditorProps) {
  // The playhead, in seconds. This is the source of truth for "where are we".
  const [time, setTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  // The app never stores the MP3 itself, so to hear the song the user can
  // load the file here. It stays on their computer, only in this tab.
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clockRef = useRef({ startMs: 0, startTime: 0 });

  const analysis = animationNode.audioAnalysis;
  const duration = analysis?.duration ?? 0;

  // Free the loaded audio file when it's replaced or this tab closes.
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  // Playback loop: moves the playhead forward in real time. If an audio
  // file is loaded, the audio is the clock so lights and sound stay locked.
  useEffect(() => {
    if (!isPlaying) return;

    const audio = audioUrl ? audioRef.current : null;
    if (audio) {
      audio.currentTime = clockRef.current.startTime;
      audio.play().catch(() => setIsPlaying(false));
    }

    let frameId = 0;
    const tick = () => {
      const now = audio
        ? audio.currentTime
        : clockRef.current.startTime +
          (performance.now() - clockRef.current.startMs) / 1000;

      if (now >= duration) {
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
  }, [isPlaying, audioUrl, duration]);

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
  const litPinsAt = (t: number): number[] => {
    let lit: number[] = [];
    for (const frame of frames) {
      if (frame.time <= t + SAME_MOMENT) lit = frame.litPins;
      else break;
    }
    return lit;
  };

  const keyframeHere = frames.find(
    (f) => Math.abs(f.time - time) < SAME_MOMENT,
  );
  const litNow = litPinsAt(time);

  // ---- Moving the playhead ----
  const seek = (t: number) => {
    const clamped = Math.min(duration, Math.max(0, t));
    setTime(clamped);
    clockRef.current = { startMs: performance.now(), startTime: clamped };
    if (audioRef.current && audioUrl) audioRef.current.currentTime = clamped;
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

  const jumpKeyframe = (direction: 1 | -1) => {
    const target =
      direction === 1
        ? frames.find((f) => f.time > time + SAME_MOMENT)
        : [...frames].reverse().find((f) => f.time < time - SAME_MOMENT);
    if (target) seek(target.time);
  };

  const togglePlay = () => {
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
    // Keyframes always sit exactly on a beat.
    const snapped = beats[beatIndex];
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
      frames.map((f) => (f.id === keyframeHere.id ? { ...f, litPins } : f)),
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

  const addSectionKeyframes = () => {
    const snapped = makeKeyFrames(analysis).map((frame) => ({
      ...frame,
      time: beats[nearestIndex(beats, frame.time)],
    }));
    onFramesChange(sortByTime(snapped));
  };

  const startOver = () => {
    if (window.confirm("Delete all keyframes and start over?")) {
      setIsPlaying(false);
      seek(0);
      onFramesChange([]);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Hidden player, only used when the user loads the song file */}
      <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" />

      {/* Readout */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-serif text-3xl text-white">{formatTime(time)}</p>
        <p className="text-xs text-white/40">
          Beat {beatIndex + 1} of {beats.length}
          {sectionIndex >= 0 && ` · Section ${sectionIndex + 1}`}
          {showBpm && section && ` · ${Math.round(section.bpm)} BPM`}
        </p>
      </div>

      {/* The parol, lit the way it would be at the playhead */}
      <ParolPreview node={groupNode} litPins={litNow} />

      {/* Timeline strip: section lines, keyframe markers, playhead */}
      <div>
        <p className={labelClass}>
          Timeline · {frames.length} keyframe{frames.length === 1 ? "" : "s"}
        </p>
        <div
          className="relative h-12 w-full cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.min(
              1,
              Math.max(0, (event.clientX - rect.left) / rect.width),
            );
            seek(beats[nearestIndex(beats, ratio * duration)]);
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

          {frames.map((frame) => (
            <button
              key={frame.id}
              title={formatTime(frame.time)}
              onClick={(event) => {
                event.stopPropagation();
                seek(frame.time);
              }}
              className={`absolute inset-y-2 w-2 -translate-x-1/2 cursor-pointer rounded-full transition ${
                frame.id === keyframeHere?.id
                  ? "bg-white"
                  : "bg-white/40 hover:bg-white/80"
              }`}
              style={{ left: `${(frame.time / span) * 100}%` }}
            />
          ))}

          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-white"
            style={{ left: `${(time / span) * 100}%` }}
          />
        </div>

        {/* Beat slider: moving it always lands exactly on a beat */}
        <input
          type="range"
          min={0}
          max={beats.length - 1}
          step={1}
          value={beatIndex}
          onChange={(event) => seek(beats[Number(event.target.value)])}
          className="mt-4 w-full accent-white"
        />
      </div>

      {/* Transport */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={togglePlay}
          className="cursor-pointer rounded-full bg-white px-6 py-2 text-xs uppercase tracking-[0.15em] text-black transition hover:bg-white/90"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button onClick={() => stepBeat(-1)} className={pillClass}>
          ◀ Beat
        </button>
        <button onClick={() => stepBeat(1)} className={pillClass}>
          Beat ▶
        </button>
        <button
          onClick={() => jumpKeyframe(-1)}
          disabled={!frames.some((f) => f.time < time - SAME_MOMENT)}
          className={pillClass}
        >
          ◀ Keyframe
        </button>
        <button
          onClick={() => jumpKeyframe(1)}
          disabled={!frames.some((f) => f.time > time + SAME_MOMENT)}
          className={pillClass}
        >
          Keyframe ▶
        </button>
      </div>

      {/* Keyframe at the playhead */}
      <div>
        <p className={labelClass}>
          {keyframeHere
            ? `Keyframe at ${formatTime(keyframeHere.time)}`
            : "No keyframe at this beat"}
        </p>

        {!keyframeHere && (
          <button
            onClick={addKeyframe}
            disabled={isPlaying}
            className="mb-4 cursor-pointer rounded-xl bg-white px-6 py-3 font-serif text-black transition hover:bg-white/90 disabled:cursor-default disabled:opacity-30"
          >
            Add keyframe at beat {beatIndex + 1}
          </button>
        )}

        {pins.length === 0 ? (
          <p className="text-sm text-white/30">
            No pins assigned yet. Assign pins on the Zone Map tab first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {pins.map((pin) => {
              const isOn = (keyframeHere ?? { litPins: litNow }).litPins.includes(
                pin,
              );
              return (
                <button
                  key={pin}
                  onClick={() => togglePin(pin)}
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
                  Pin {pin}
                </button>
              );
            })}
          </div>
        )}

        {!keyframeHere && pins.length > 0 && (
          <p className="mt-3 text-xs text-white/30">
            These are the pins currently held on. Add a keyframe here to change
            them.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-4">
          {keyframeHere && (
            <>
              <button
                onClick={() => setHerePins([])}
                disabled={isPlaying}
                className={linkClass}
              >
                Turn all off
              </button>
              <button
                onClick={deleteKeyframe}
                disabled={isPlaying}
                className={linkClass}
              >
                Delete this keyframe
              </button>
            </>
          )}
          {frames.length === 0 && (
            <button onClick={addSectionKeyframes} className={linkClass}>
              Add a keyframe at the start of every section
            </button>
          )}
          {frames.length > 0 && (
            <button onClick={startOver} className={linkClass}>
              Start over
            </button>
          )}
        </div>
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
            }}
          />
        </label>
        <p className="mt-2 text-[11px] text-white/25">
          The app only stores the song's analysis, not the MP3. Without the
          file, Play runs the lights silently in real time.
        </p>
      </div>
    </div>
  );
}

export default SequenceEditor;
