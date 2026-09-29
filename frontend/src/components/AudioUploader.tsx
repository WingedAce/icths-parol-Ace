import { useRef, useState } from "react";

import type { AudioAnalysis, ProjectNode } from "../types";
import { scaleAllTempo, scaleSectionTempo } from "../utils/audioTempo";

const AUDIO_API_URL =
  import.meta.env.VITE_AUDIO_API_URL ?? "http://localhost:8000/analyze-audio";

// Raw shape returned by the backend (snake_case, matching main.py's
// analyze_audio()). Converted to our camelCase AudioAnalysis type below
// so the rest of the frontend never has to think about the wire format.
type AudioAnalysisResponse = {
  duration: number;
  bpm: number;
  beat_times: number[];
  tempo_curve: { time: number; bpm: number }[];
  energy_curve: { time: number; energy: number }[];
  sections: {
    id: string;
    start: number;
    end: number;
    energy: number;
    bpm: number;
  }[];
};

function toAudioAnalysis(raw: AudioAnalysisResponse): AudioAnalysis {
  return {
    duration: raw.duration,
    bpm: raw.bpm,
    beatTimes: raw.beat_times,
    tempoCurve: raw.tempo_curve,
    energyCurve: raw.energy_curve,
    sections: raw.sections,
  };
}

type AudioUploaderProps = {
  node: ProjectNode;
  onAnalyzed: (fileName: string, analysis: AudioAnalysis) => void;
  onClear: () => void;
};

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function AudioUploader({ node, onAnalyzed, onClear }: AudioUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | null | undefined) {
    if (!file) return;

    if (file.type !== "audio/mpeg" && file.type !== "audio/mp3") {
      setError("Please upload an MP3 file.");
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(AUDIO_API_URL, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.detail ?? `Analysis failed (status ${response.status})`,
        );
      }

      const raw: AudioAnalysisResponse = await response.json();
      onAnalyzed(file.name, toAudioAnalysis(raw));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong analyzing this file.",
      );
    } finally {
      setIsUploading(false);
    }
  }

  if (node.audioAnalysis) {
    const { duration, bpm, sections } = node.audioAnalysis;

    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-white/15 bg-white/[0.02] px-8 py-10">
        <p className="text-[10px] uppercase tracking-[0.3em] text-white/30">
          Song
        </p>

        <h3 className="mt-2 font-serif text-2xl font-light">
          {node.audioFileName ?? "Untitled track"}
        </h3>

        <div className="mt-6 grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-light">{formatDuration(duration)}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.25em] text-white/30">
              Duration
            </p>
          </div>

          <div>
            <p className="text-2xl font-light">{bpm}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.25em] text-white/30">
              BPM
            </p>
            <div className="mt-2 flex justify-center gap-1">
              <button
                onClick={() =>
                  onAnalyzed(
                    node.audioFileName ?? "",
                    scaleAllTempo(node.audioAnalysis!, 0.5),
                  )
                }
                title="If the detected tempo sounds twice too fast"
                className="cursor-pointer rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/40 transition hover:border-white/25 hover:text-white"
              >
                ½×
              </button>
              <button
                onClick={() =>
                  onAnalyzed(
                    node.audioFileName ?? "",
                    scaleAllTempo(node.audioAnalysis!, 2),
                  )
                }
                title="If the detected tempo sounds twice too slow"
                className="cursor-pointer rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/40 transition hover:border-white/25 hover:text-white"
              >
                2×
              </button>
            </div>
          </div>

          <div>
            <p className="text-2xl font-light">{sections.length}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.25em] text-white/30">
              Sections
            </p>
          </div>
        </div>

        <div className="mt-8 border-t border-white/10 pt-4">
          <p className="mb-2 text-[10px] uppercase tracking-[0.25em] text-white/30">
            Sections
          </p>
          <ul className="space-y-1 text-left text-sm text-white/60">
            {sections.map((section) => (
              <li key={section.id} className="flex items-center justify-between gap-3">
                <span>
                  {formatDuration(section.start)} – {formatDuration(section.end)}
                </span>
                <span className="flex items-center gap-2">
                  {section.bpm} BPM
                  <button
                    onClick={() =>
                      onAnalyzed(
                        node.audioFileName ?? "",
                        scaleSectionTempo(node.audioAnalysis!, section.id, 0.5),
                      )
                    }
                    title="Halve this section's tempo"
                    className="cursor-pointer rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40 transition hover:border-white/25 hover:text-white"
                  >
                    ½×
                  </button>
                  <button
                    onClick={() =>
                      onAnalyzed(
                        node.audioFileName ?? "",
                        scaleSectionTempo(node.audioAnalysis!, section.id, 2),
                      )
                    }
                    title="Double this section's tempo"
                    className="cursor-pointer rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40 transition hover:border-white/25 hover:text-white"
                  >
                    2×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <button
          onClick={onClear}
          className="mt-8 w-full cursor-pointer rounded-full border border-white/10 px-4 py-2 text-xs text-white/40 transition hover:border-white/25 hover:text-white"
        >
          Remove & upload a different song
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        handleFile(event.dataTransfer.files?.[0]);
      }}
      className={`mx-auto flex max-w-xl flex-col items-center justify-center rounded-3xl border-2 border-dashed px-10 py-16 text-center transition ${
        isDragging
          ? "border-white/40 bg-white/[0.05]"
          : "border-white/15 bg-white/[0.02]"
      }`}
    >
      {isUploading ? (
        <p className="text-white/60">Analyzing audio — this can take a moment…</p>
      ) : (
        <>
          <p className="text-white/70">
            Drop your song's MP3 here, or{" "}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer text-white underline underline-offset-2 hover:text-white/80"
            >
              browse
            </button>
          </p>

          <p className="mt-2 text-xs text-white/25">
            MP3 only — analyzed for BPM, sections, and energy
          </p>
        </>
      )}

      {error && (
        <p className="mt-4 text-xs text-red-400">{error}</p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/mpeg,.mp3"
        className="hidden"
        disabled={isUploading}
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
    </div>
  );
}

export default AudioUploader;
