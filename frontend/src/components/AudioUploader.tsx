import { useEffect, useRef, useState } from "react";

import type { AudioAnalysis, ProjectNode } from "../types";
import { deleteAudio, saveAudio } from "../lib/audioStore";
import {
  scaleAllTempo,
  scaleSectionTempo,
  setAllTempo,
  setSectionTempo,
  TEMPO_CORRECTIONS,
} from "../utils/audioTempo";

const AUDIO_API_URL =
  import.meta.env.VITE_AUDIO_API_URL ?? "http://localhost:8000/analyze-audio";

// Matches MAX_CLIP_SECONDS in backend/main.py — keep these in sync. The
// backend enforces this regardless of what the frontend sends, this is
// just so the picker UI below knows how wide a window to offer.
const MAX_CLIP_SECONDS = 120;

// Raw shape returned by the backend (snake_case, matching main.py's
// analyze_audio()). Converted to our camelCase AudioAnalysis type below
// so the rest of the frontend never has to think about the wire format.
type AudioAnalysisResponse = {
  duration: number;
  source_duration: number;
  clip_start: number;
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
    sourceDuration: raw.source_duration,
    clipStart: raw.clip_start,
    bpm: raw.bpm,
    beatTimes: raw.beat_times,
    tempoCurve: raw.tempo_curve,
    energyCurve: raw.energy_curve,
    sections: raw.sections,
  };
}

type AudioUploaderProps = {
  node: ProjectNode;
  // A new song was uploaded and analyzed.
  onAnalyzed: (fileName: string, analysis: AudioAnalysis) => void;
  // Called once, right after a FRESH backend analysis — never from a
  // correction — so the caller can snapshot it as the "detected"
  // baseline the student can always revert back to.
  onFreshAnalysis: (analysis: AudioAnalysis) => void;
  // The same song with its tempo corrected (the beats move) — a ratio
  // fix, a typed BPM, or a reset back to the detected tempo. Kept apart
  // from onAnalyzed so the caller can move keyframes onto the new beats
  // instead of clearing them like it does for a brand-new song.
  onTempoChange: (analysis: AudioAnalysis) => void;
  onClear: () => void;
  // Shows a "Reset keyframes" button (the song stays).
  frameCount?: number;
  onResetKeyframes?: () => void;
};

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function AudioUploader({
  node,
  onAnalyzed,
  onFreshAnalysis,
  onTempoChange,
  onClear,
  frameCount = 0,
  onResetKeyframes,
}: AudioUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set once a dropped/picked file turns out to be longer than the
  // MAX_CLIP_SECONDS cap — holds everything needed to show the trim
  // picker and preview-play the selected window before committing to
  // an upload.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [pendingDuration, setPendingDuration] = useState(0);
  const [clipStart, setClipStart] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  // Manual BPM entry — raw text so the student can clear/retype freely;
  // parsed to a number only when they confirm.
  const [manualBpmInput, setManualBpmInput] = useState("");
  const [sectionBpmInputs, setSectionBpmInputs] = useState<
    Record<string, string>
  >({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLAudioElement>(null);

  // Stop the preview the instant playback crosses the end of the
  // selected window, so "preview" actually previews just the clip.
  useEffect(() => {
    const audio = previewRef.current;
    if (!audio) return;

    function handleTimeUpdate() {
      if (audio && audio.currentTime >= clipStart + MAX_CLIP_SECONDS) {
        audio.pause();
      }
    }

    audio.addEventListener("timeupdate", handleTimeUpdate);
    return () => audio.removeEventListener("timeupdate", handleTimeUpdate);
  }, [clipStart]);

  // Release the temporary object URL once we're done with it (picker
  // dismissed or upload completed) rather than leaking it.
  useEffect(() => {
    return () => {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    };
  }, [pendingUrl]);

  async function doUpload(file: File, start: number) {
    setError(null);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("start", String(start));

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

      // Keep the song itself so the Preview tab can play it. Best-effort:
      // if storage fails, analysis still works and preview is just silent.
      // We store the ORIGINAL file (not a trimmed copy) — the node's
      // audioAnalysis.clipStart/duration tell any playback UI which
      // window of it to actually use.
      await saveAudio(node.id, file).catch(() => {});

      const analysis = toAudioAnalysis(raw);
      onFreshAnalysis(analysis);
      onAnalyzed(file.name, analysis);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong analyzing this file.",
      );
    } finally {
      setIsUploading(false);
      setPendingFile(null);
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
      setPendingUrl(null);
    }
  }

  function handleFile(file: File | null | undefined) {
    if (!file) return;

    if (file.type !== "audio/mpeg" && file.type !== "audio/mp3") {
      setError("Please upload an MP3 file.");
      return;
    }

    setError(null);

    // Read duration client-side first (via the browser's own metadata
    // parsing — fast, doesn't need the file uploaded anywhere) so we
    // only bother the student with the trim picker when the song
    // actually needs it.
    const url = URL.createObjectURL(file);
    const probe = new Audio(url);

    probe.addEventListener("loadedmetadata", () => {
      // If the browser can't tell the length (NaN/Infinity), skip the
      // picker and let the backend decide — it only analyzes the first
      // MAX_CLIP_SECONDS anyway.
      if (
        !Number.isFinite(probe.duration) ||
        probe.duration <= MAX_CLIP_SECONDS
      ) {
        URL.revokeObjectURL(url);
        doUpload(file, 0);
        return;
      }

      setPendingFile(file);
      setPendingUrl(url);
      setPendingDuration(probe.duration);
      setClipStart(0);
    });

    probe.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      setError("Couldn't read this file — is it a valid MP3?");
    });
  }

  function togglePreview() {
    const audio = previewRef.current;
    if (!audio) return;

    if (isPreviewPlaying) {
      audio.pause();
      return;
    }

    audio.currentTime = clipStart;
    audio.play();
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

        {node.audioAnalysis.sourceDuration !== undefined &&
          node.audioAnalysis.sourceDuration > duration && (
            <p className="mt-1 text-xs text-white/40">
              Using {formatDuration(node.audioAnalysis.clipStart ?? 0)} –{" "}
              {formatDuration(
                (node.audioAnalysis.clipStart ?? 0) + duration,
              )}{" "}
              of {formatDuration(node.audioAnalysis.sourceDuration)}
            </p>
          )}

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
            <div className="mt-2 flex flex-wrap justify-center gap-1">
              {TEMPO_CORRECTIONS.map(({ label, factor }) => (
                <button
                  key={label}
                  onClick={() =>
                    onTempoChange(scaleAllTempo(node.audioAnalysis!, factor))
                  }
                  title={`If the detected tempo should be ${label} what's shown`}
                  className="cursor-pointer rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/40 transition hover:border-white/25 hover:text-white"
                >
                  {label}
                </button>
              ))}
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const value = Number(manualBpmInput);
                if (!value || value <= 0) return;
                onTempoChange(setAllTempo(node.audioAnalysis!, value));
                setManualBpmInput("");
              }}
              className="mt-2 flex items-center justify-center gap-1"
            >
              <input
                type="number"
                min={1}
                step="any"
                placeholder="Type BPM"
                value={manualBpmInput}
                onChange={(event) => setManualBpmInput(event.target.value)}
                className="w-20 rounded-full border border-white/10 bg-transparent px-2 py-0.5 text-center text-[10px] text-white/70 outline-none focus:border-white/30"
              />
              <button
                type="submit"
                title="Replace the detected beats with an even grid at this BPM — use this if detection failed outright, not just by a wrong ratio"
                className="cursor-pointer rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/40 transition hover:border-white/25 hover:text-white"
              >
                Set
              </button>
            </form>

            {node.audioAnalysisOriginal && (
              <button
                onClick={() => onTempoChange(node.audioAnalysisOriginal!)}
                title="Undo every correction and go back to what was originally detected"
                className="mt-2 cursor-pointer text-[10px] text-white/30 underline underline-offset-2 transition hover:text-white/60"
              >
                Reset to detected
              </button>
            )}
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
                <span className="flex items-center gap-1.5">
                  {section.bpm} BPM
                  {TEMPO_CORRECTIONS.map(({ label, factor }) => (
                    <button
                      key={label}
                      onClick={() =>
                        onTempoChange(
                          scaleSectionTempo(
                            node.audioAnalysis!,
                            section.id,
                            factor,
                          ),
                        )
                      }
                      title={`Correct this section's tempo by ${label}`}
                      className="cursor-pointer rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40 transition hover:border-white/25 hover:text-white"
                    >
                      {label}
                    </button>
                  ))}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const value = Number(sectionBpmInputs[section.id]);
                      if (!value || value <= 0) return;
                      onTempoChange(
                        setSectionTempo(
                          node.audioAnalysis!,
                          section.id,
                          value,
                        ),
                      );
                      setSectionBpmInputs((prev) => ({
                        ...prev,
                        [section.id]: "",
                      }));
                    }}
                    className="flex items-center gap-1"
                  >
                    <input
                      type="number"
                      min={1}
                      step="any"
                      placeholder="BPM"
                      value={sectionBpmInputs[section.id] ?? ""}
                      onChange={(event) =>
                        setSectionBpmInputs((prev) => ({
                          ...prev,
                          [section.id]: event.target.value,
                        }))
                      }
                      className="w-14 rounded-full border border-white/10 bg-transparent px-1.5 py-0.5 text-center text-[10px] text-white/70 outline-none focus:border-white/30"
                    />
                    <button
                      type="submit"
                      title="Replace this section's beats with an even grid at this BPM"
                      className="cursor-pointer rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40 transition hover:border-white/25 hover:text-white"
                    >
                      Set
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {onResetKeyframes && (
          <button
            onClick={() => {
              if (
                window.confirm(
                  "Reset all keyframes for this song? The song itself stays.",
                )
              ) {
                onResetKeyframes();
              }
            }}
            disabled={frameCount === 0}
            className="mt-8 w-full cursor-pointer rounded-full border border-white/15 px-4 py-2 text-xs text-white/60 transition hover:border-white/40 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:border-white/15 disabled:hover:text-white/60"
          >
            Reset keyframes{frameCount > 0 ? ` (${frameCount})` : ""}
          </button>
        )}

        <button
          onClick={() => {
            deleteAudio(node.id).catch(() => {});
            setManualBpmInput("");
            setSectionBpmInputs({});
            onClear();
          }}
          className="mt-3 w-full cursor-pointer rounded-full border border-white/10 px-4 py-2 text-xs text-white/40 transition hover:border-white/25 hover:text-white"
        >
          Remove & upload a different song
        </button>
      </div>
    );
  }

  if (pendingFile && pendingUrl) {
    const maxStart = Math.max(0, pendingDuration - MAX_CLIP_SECONDS);
    const clipEnd = Math.min(clipStart + MAX_CLIP_SECONDS, pendingDuration);

    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-white/15 bg-white/[0.02] px-8 py-10">
        <p className="text-[10px] uppercase tracking-[0.3em] text-white/30">
          Pick a {formatDuration(MAX_CLIP_SECONDS)} window
        </p>

        <h3 className="mt-2 font-serif text-xl font-light">
          {pendingFile.name}
        </h3>

        <p className="mt-2 text-xs text-white/40">
          This song is {formatDuration(pendingDuration)} long — only{" "}
          {formatDuration(MAX_CLIP_SECONDS)} can be analyzed. Drag the
          slider to choose which part of the song to use, then preview it
          before confirming.
        </p>

        <audio
          ref={previewRef}
          src={pendingUrl}
          onPlay={() => setIsPreviewPlaying(true)}
          onPause={() => setIsPreviewPlaying(false)}
          className="hidden"
        />

        <div className="mt-8">
          <input
            type="range"
            min={0}
            max={maxStart}
            step={1}
            value={clipStart}
            onChange={(event) => {
              setClipStart(Number(event.target.value));
              if (previewRef.current && isPreviewPlaying) {
                previewRef.current.pause();
              }
            }}
            className="w-full cursor-pointer accent-white"
          />

          <div className="mt-2 flex justify-between text-xs text-white/40">
            <span>0:00</span>
            <span>{formatDuration(pendingDuration)}</span>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3">
          <span className="text-sm text-white/70">
            Using {formatDuration(clipStart)} – {formatDuration(clipEnd)}
          </span>

          <button
            onClick={togglePreview}
            className="cursor-pointer rounded-full border border-white/15 px-4 py-1.5 text-xs text-white/60 transition hover:border-white/30 hover:text-white"
          >
            {isPreviewPlaying ? "Pause" : "Preview"}
          </button>
        </div>

        <div className="mt-8 flex gap-3">
          <button
            onClick={() => {
              previewRef.current?.pause();
              URL.revokeObjectURL(pendingUrl);
              setPendingFile(null);
              setPendingUrl(null);
            }}
            className="flex-1 cursor-pointer rounded-full border border-white/10 px-4 py-2 text-xs text-white/40 transition hover:border-white/25 hover:text-white"
          >
            Choose a different song
          </button>

          <button
            onClick={() => {
              previewRef.current?.pause();
              doUpload(pendingFile, clipStart);
            }}
            className="flex-1 cursor-pointer rounded-full border border-white/40 bg-white/[0.08] px-4 py-2 text-xs text-white transition hover:bg-white/[0.14]"
          >
            Use this part
          </button>
        </div>

        {error && <p className="mt-4 text-xs text-red-400">{error}</p>}
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
