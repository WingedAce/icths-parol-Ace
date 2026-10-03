import { useState } from "react";

import ParolPreview from "./ParolPreview";
import { makeKeyFrames } from "../utils/audioTiming";
import type { Frame, ProjectNode } from "../types";

type SequenceEditorProps = {
  // The Group node: owns the drawing, zones and pin mappings.
  groupNode: ProjectNode;
  // The Song node: owns the audio analysis and the frames.
  animationNode: ProjectNode;
  onFramesChange: (frames: Frame[]) => void;
};

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function SequenceEditor({
  groupNode,
  animationNode,
  onFramesChange,
}: SequenceEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const analysis = animationNode.audioAnalysis;

  if (!analysis) {
    return (
      <p className="text-center text-sm text-white/30">
        Upload a song on the Song tab to start building the light sequence.
      </p>
    );
  }

  const frames = [...(animationNode.frames ?? [])].sort(
    (a, b) => a.time - b.time,
  );

  const pins = Array.from(
    new Set((groupNode.pinMappings ?? []).map((m) => m.pin)),
  ).sort((a, b) => a - b);

  // ---- No frames yet: offer to create the starting key frames ----
  if (frames.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="max-w-md text-sm text-white/40">
          Start the sequence with one key frame at the beginning of each song
          section. You choose which pins are lit in each one.
        </p>
        <button
          onClick={() => onFramesChange(makeKeyFrames(analysis))}
          className="cursor-pointer rounded-xl bg-white px-6 py-3 font-serif text-black transition hover:bg-white/90"
        >
          Create key frames
        </button>
      </div>
    );
  }

  const selectedIndex = Math.max(
    0,
    frames.findIndex((f) => f.id === selectedId),
  );
  const selected = frames[selectedIndex];

  const labelOf = (frame: Frame) => {
    const index = analysis.sections.findIndex((s) => s.id === frame.sectionId);
    return index >= 0 ? `Section ${index + 1}` : "Frame";
  };

  const setSelectedPins = (litPins: number[]) => {
    onFramesChange(
      frames.map((f) => (f.id === selected.id ? { ...f, litPins } : f)),
    );
  };

  const togglePin = (pin: number) => {
    setSelectedPins(
      selected.litPins.includes(pin)
        ? selected.litPins.filter((p) => p !== pin)
        : [...selected.litPins, pin],
    );
  };

  const copyFromPrevious = () => {
    if (selectedIndex === 0) return;
    setSelectedPins([...frames[selectedIndex - 1].litPins]);
  };

  const startOver = () => {
    const confirmed = window.confirm(
      "Delete all frames and start the sequence over?",
    );
    if (confirmed) {
      setSelectedId(null);
      onFramesChange([]);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Timeline: one chip per frame, in time order */}
      <div>
        <p className="mb-3 text-[10px] uppercase tracking-[0.3em] text-white/30">
          Frames
        </p>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {frames.map((frame) => (
            <button
              key={frame.id}
              onClick={() => setSelectedId(frame.id)}
              className={`shrink-0 cursor-pointer rounded-xl border px-4 py-2 text-left transition ${
                frame.id === selected.id
                  ? "border-white/40 bg-white/[0.08] text-white"
                  : "border-white/10 text-white/50 hover:border-white/25 hover:text-white"
              }`}
            >
              <span className="block font-serif text-sm">{labelOf(frame)}</span>
              <span className="block text-[11px] text-white/40">
                {formatTime(frame.time)} · {frame.litPins.length} on
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Live preview of the selected frame */}
      <ParolPreview node={groupNode} litPins={selected.litPins} />

      {/* Pin toggles for the selected frame */}
      <div>
        <p className="mb-3 text-[10px] uppercase tracking-[0.3em] text-white/30">
          Lit pins at {formatTime(selected.time)}
        </p>

        {pins.length === 0 ? (
          <p className="text-sm text-white/30">
            No pins assigned yet. Assign pins on the Zone Map tab first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {pins.map((pin) => (
              <button
                key={pin}
                onClick={() => togglePin(pin)}
                className={`cursor-pointer rounded-full border px-3 py-1 font-serif text-xs transition ${
                  selected.litPins.includes(pin)
                    ? "border-white/40 bg-white/[0.08] text-white"
                    : "border-white/10 text-white/50 hover:text-white"
                }`}
              >
                Pin {pin}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-4">
          <button
            onClick={copyFromPrevious}
            disabled={selectedIndex === 0}
            className="cursor-pointer text-xs text-white/30 underline underline-offset-2 hover:text-white/60 disabled:cursor-default disabled:no-underline disabled:opacity-40"
          >
            Copy pins from previous frame
          </button>
          <button
            onClick={() => setSelectedPins([])}
            className="cursor-pointer text-xs text-white/30 underline underline-offset-2 hover:text-white/60"
          >
            Turn all off
          </button>
          <button
            onClick={startOver}
            className="cursor-pointer text-xs text-white/30 underline underline-offset-2 hover:text-white/60"
          >
            Start over
          </button>
        </div>
      </div>
    </div>
  );
}

export default SequenceEditor;
