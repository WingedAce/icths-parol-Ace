import { useEffect, useRef, useState } from "react";

import type { AudioAnalysis, ProjectNode } from "../types";
import SongChangeDialog from "./SongChangeDialog";
import { deleteAudio, saveAudio } from "../lib/audioStore";
import {
  scaleAllTempo,
  scaleSectionTempo,
  setAllTempo,
  setSectionTempo,
  TEMPO_CORRECTIONS,
} from "../utils/audioTempo";
import { rollPracticeSong } from "../utils/practiceSongs";

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
  // A new song was uploaded and analyzed. resetKeyframes is true ONLY when the
  // student explicitly chose "Reset keyframes" in the Change Song dialog;
  // otherwise the round's keyframes must be left exactly as they are.
  onAnalyzed: (
    fileName: string,
    analysis: AudioAnalysis,
    resetKeyframes: boolean,
  ) => void;
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
  // How many BPM change points the Preview timeline has. Any tempo
  // correction below clears them, so it asks first when there are some.
  bpmChangeCount?: number;
  // The stored mp3 belongs to something shared (the Special Round's song):
  // removing the song here must not delete that file for everyone.
  keepStoredAudio?: boolean;
  // Longest part of a song that gets analyzed, in seconds. Normal rounds use
  // the full 120; the Special Round and Practice use 60.
  maxClipSeconds?: number;
  // Practice only: shows a "Roll a random song" button that picks one of the
  // fixed Practice songs (already analyzed, nothing to upload).
  rollSongs?: boolean;
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
  bpmChangeCount = 0,
  keepStoredAudio = false,
  maxClipSeconds = MAX_CLIP_SECONDS,
  rollSongs = false,
}: AudioUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set once a dropped/picked file turns out to be longer than the
  // maxClipSeconds cap — holds everything needed to show the trim
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

  // Changing the song of a round that has keyframes: the dialog asks first,
  // and `replacing` keeps the upload screen open while the OLD song stays in
  // place, so a failed upload loses nothing. resetOnUpload remembers the
  // choice made in the dialog until the new song has been analyzed.
  const [askChange, setAskChange] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const resetOnUpload = useRef(false);
  // Set when the Change Song dialog was opened by Roll instead of by the
  // "upload a different song" button.
  const rollAfterChoice = useRef(false);
  const [isRolling, setIsRolling] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLAudioElement>(null);

  // Stop the preview the instant playback crosses the end of the
  // selected window, so "preview" actually previews just the clip.
  useEffect(() => {
    const audio = previewRef.current;
    if (!audio) return;

    function handleTimeUpdate() {
      if (audio && audio.currentTime >= clipStart + maxClipSeconds) {
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
      if (maxClipSeconds < MAX_CLIP_SECONDS) {
        formData.append("max_seconds", String(maxClipSeconds));
      }

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

      // An analysis server that hasn't been updated ignores the shorter limit
      // and would hand back a longer song than allowed. Refuse it.
      if (raw.duration > maxClipSeconds + 1) {
        throw new Error(
          `This round allows ${Math.round(maxClipSeconds / 60) === 1 ? "1 minute" : maxClipSeconds + " seconds"} of music, but the analysis server hasn't been updated to enforce that yet. Ask the developer to redeploy the backend.`,
        );
      }

      // Keep the song itself so the Preview tab can play it. Best-effort:
      // if storage fails, analysis still works and preview is just silent.
      // We store the ORIGINAL file (not a trimmed copy) — the node's
      // audioAnalysis.clipStart/duration tell any playback UI which
      // window of it to actually use.
      await saveAudio(node.id, file).catch(() => {});

      const analysis = toAudioAnalysis(raw);
      onFreshAnalysis(analysis);
      onAnalyzed(file.name, analysis, resetOnUpload.current);
      resetOnUpload.current = false;
      setReplacing(false);
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

  // Roll: pick a fixed Practice song at random and load it with its saved
  // analysis, the same way an upload would end up, without the analysis server.
  async function rollSong() {
    setError(null);
    setIsRolling(true);
    try {
      const song = rollPracticeSong(node.audioFileName);
      const base = `${import.meta.env.BASE_URL}practice/${song.id}`;
      const [audioRes, dataRes] = await Promise.all([
        fetch(`${base}.mp3`),
        fetch(`${base}.json`),
      ]);
      if (!audioRes.ok || !dataRes.ok) {
        throw new Error("Couldn't load that song. Please try rolling again.");
      }
      const blob = await audioRes.blob();
      const data: { analysis: AudioAnalysisResponse } = await dataRes.json();

      await saveAudio(node.id, blob).catch(() => {});

      const analysis = toAudioAnalysis(data.analysis);
      onFreshAnalysis(analysis);
      onAnalyzed(song.title, analysis, resetOnUpload.current);
      resetOnUpload.current = false;
      setReplacing(false);
      setManualBpmInput("");
      setSectionBpmInputs({});
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't roll a song right now.",
      );
    } finally {
      setIsRolling(false);
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
      // maxClipSeconds anyway.
      if (
        !Number.isFinite(probe.duration) ||
        probe.duration <= maxClipSeconds
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

  // Every tempo correction redoes the base beats, which also clears the BPM
  // change points on the Preview timeline. Returns false if the student
  // backed out.
  function changeTempo(next: AudioAnalysis) {
    if (
      bpmChangeCount > 0 &&
      !window.confirm(
        "This also clears the BPM change points on the Preview timeline. Continue?",
      )
    ) {
      return false;
    }
    onTempoChange(next);
    return true;
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

  if (node.audioAnalysis && !replacing) {
    const { duration, bpm, sections } = node.audioAnalysis;
    // Keyframes a shorter song can no longer reach. They are never deleted.
    const framesPastEnd = (node.frames ?? []).filter(
      (frame) => frame.time > duration + 0.05,
    ).length;

    return (
      <div className="mx-auto max-w-xl rounded-xl bg-surface px-8 py-10">
        <p className="text-xs text-fg-muted">
          Song
        </p>

        <h3 className="mt-2 font-semibold tracking-tight text-2xl">
          {node.audioFileName ?? "Untitled track"}
        </h3>

        {node.audioAnalysis.sourceDuration !== undefined &&
          node.audioAnalysis.sourceDuration > duration && (
            <p className="mt-1 text-xs text-fg-muted">
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
            <p className="mt-1 text-xs text-fg-muted">
              Duration
            </p>
          </div>

          <div>
            <p className="text-2xl font-light">{bpm}</p>
            <p className="mt-1 text-xs text-fg-muted">
              BPM
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-1">
              {TEMPO_CORRECTIONS.map(({ label, factor }) => (
                <button
                  key={label}
                  onClick={() =>
                    changeTempo(scaleAllTempo(node.audioAnalysis!, factor))
                  }
                  title={`If the detected tempo should be ${label} what's shown`}
                  className="cursor-pointer rounded-full px-2 py-0.5 text-xs text-fg-muted transition hover:text-fg bg-elevated hover:bg-line-strong"
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
                if (changeTempo(setAllTempo(node.audioAnalysis!, value))) {
                  setManualBpmInput("");
                }
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
                className="w-20 rounded-lg border bg-transparent px-2 py-0.5 text-center text-xs text-fg-soft outline-none focus:border-line-hover border-transparent bg-elevated"
              />
              <button
                type="submit"
                title="Replace the detected beats with an even grid at this BPM — use this if detection failed outright, not just by a wrong ratio"
                className="cursor-pointer rounded-full px-2 py-0.5 text-xs text-fg-muted transition hover:text-fg bg-elevated hover:bg-line-strong"
              >
                Set
              </button>
            </form>

            {node.audioAnalysisOriginal && (
              <button
                onClick={() => changeTempo(node.audioAnalysisOriginal!)}
                title="Undo every correction and go back to what was originally detected"
                className="mt-2 cursor-pointer text-xs text-fg-muted underline underline-offset-2 transition hover:text-fg-soft"
              >
                Reset to detected
              </button>
            )}
          </div>

          <div>
            <p className="text-2xl font-light">{sections.length}</p>
            <p className="mt-1 text-xs text-fg-muted">
              Sections
            </p>
          </div>
        </div>

        <div className="mt-8 border-t border-line pt-4">
          <p className="mb-2 text-xs text-fg-muted">
            Sections
          </p>
          <ul className="space-y-1 text-left text-sm text-fg-soft">
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
                        changeTempo(
                          scaleSectionTempo(
                            node.audioAnalysis!,
                            section.id,
                            factor,
                          ),
                        )
                      }
                      title={`Correct this section's tempo by ${label}`}
                      className="cursor-pointer rounded-full px-1.5 py-0.5 text-xs text-fg-muted transition hover:text-fg bg-elevated hover:bg-line-strong"
                    >
                      {label}
                    </button>
                  ))}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const value = Number(sectionBpmInputs[section.id]);
                      if (!value || value <= 0) return;
                      const applied = changeTempo(
                        setSectionTempo(
                          node.audioAnalysis!,
                          section.id,
                          value,
                        ),
                      );
                      if (!applied) return;
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
                      className="w-14 rounded-lg border bg-transparent px-1.5 py-0.5 text-center text-xs text-fg-soft outline-none focus:border-line-hover border-transparent bg-elevated"
                    />
                    <button
                      type="submit"
                      title="Replace this section's beats with an even grid at this BPM"
                      className="cursor-pointer rounded-full px-1.5 py-0.5 text-xs text-fg-muted transition hover:text-fg bg-elevated hover:bg-line-strong"
                    >
                      Set
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {framesPastEnd > 0 && (
          <p className="mt-8 rounded-lg bg-elevated px-4 py-3 text-xs leading-relaxed text-warn">
            {framesPastEnd} keyframe{framesPastEnd === 1 ? "" : "s"} sit
            {framesPastEnd === 1 ? "s" : ""} after the end of this song (
            {formatDuration(duration)}). {framesPastEnd === 1 ? "It is" : "They are"} kept,
            but the Preview can't reach {framesPastEnd === 1 ? "it" : "them"}. The Gallery tab
            still lists {framesPastEnd === 1 ? "it" : "them"}.
          </p>
        )}

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
            className="mt-8 w-full cursor-pointer rounded-full px-4 py-2 text-xs text-fg-soft transition hover:text-fg disabled:cursor-default disabled:opacity-30 disabled:hover:border-line-strong disabled:hover:text-fg-soft bg-elevated hover:bg-line-strong"
          >
            Reset keyframes{frameCount > 0 ? ` (${frameCount})` : ""}
          </button>
        )}

        {rollSongs && (
          <button
            onClick={() => {
              // With keyframes saved, ask first, same as changing the song.
              if (frameCount > 0) {
                rollAfterChoice.current = true;
                setAskChange(true);
                return;
              }
              resetOnUpload.current = false;
              void rollSong();
            }}
            disabled={isRolling}
            className="mt-8 w-full cursor-pointer rounded-full px-4 py-2 text-xs text-fg-soft transition hover:text-fg disabled:cursor-wait disabled:opacity-50 bg-elevated hover:bg-line-strong"
          >
            {isRolling ? "Rolling…" : "Roll another random song"}
          </button>
        )}

        <button
          onClick={() => {
            // With keyframes saved, ask first and keep the current song until
            // the new one has been analyzed. Nothing is removed yet.
            if (frameCount > 0) {
              setAskChange(true);
              return;
            }
            if (!keepStoredAudio) deleteAudio(node.id).catch(() => {});
            setManualBpmInput("");
            setSectionBpmInputs({});
            onClear();
          }}
          className="mt-3 w-full cursor-pointer rounded-full px-4 py-2 text-xs text-fg-muted transition hover:text-fg bg-elevated hover:bg-line-strong"
        >
          Remove & upload a different song
        </button>

        {askChange && (
          <SongChangeDialog
            keyframeCount={frameCount}
            onKeep={() => {
              resetOnUpload.current = false;
              setAskChange(false);
              setError(null);
              if (rollAfterChoice.current) {
                rollAfterChoice.current = false;
                void rollSong();
                return;
              }
              setReplacing(true);
            }}
            onReset={() => {
              resetOnUpload.current = true;
              setAskChange(false);
              setError(null);
              if (rollAfterChoice.current) {
                rollAfterChoice.current = false;
                void rollSong();
                return;
              }
              setReplacing(true);
            }}
            onCancel={() => {
              rollAfterChoice.current = false;
              setAskChange(false);
            }}
          />
        )}
      </div>
    );
  }

  if (pendingFile && pendingUrl) {
    const maxStart = Math.max(0, pendingDuration - maxClipSeconds);
    const clipEnd = Math.min(clipStart + maxClipSeconds, pendingDuration);

    return (
      <div className="mx-auto max-w-xl rounded-xl bg-surface px-8 py-10">
        <p className="text-xs text-fg-muted">
          Pick a {formatDuration(maxClipSeconds)} window
        </p>

        <h3 className="mt-2 font-medium text-xl">
          {pendingFile.name}
        </h3>

        <p className="mt-2 text-xs text-fg-muted">
          This song is {formatDuration(pendingDuration)} long — only{" "}
          {formatDuration(maxClipSeconds)} can be analyzed. Drag the
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
            className="w-full cursor-pointer accent-pine"
          />

          <div className="mt-2 flex justify-between text-xs text-fg-muted">
            <span>0:00</span>
            <span>{formatDuration(pendingDuration)}</span>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-xl bg-surface px-5 py-3">
          <span className="text-sm text-fg-soft">
            Using {formatDuration(clipStart)} – {formatDuration(clipEnd)}
          </span>

          <button
            onClick={togglePreview}
            className="cursor-pointer rounded-full px-4 py-1.5 text-xs text-fg-soft transition hover:text-fg bg-elevated hover:bg-line-strong"
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
            className="flex-1 cursor-pointer rounded-full px-4 py-2 text-xs text-fg-muted transition hover:text-fg bg-elevated hover:bg-line-strong"
          >
            Choose a different song
          </button>

          <button
            onClick={() => {
              previewRef.current?.pause();
              doUpload(pendingFile, clipStart);
            }}
            className="flex-1 cursor-pointer rounded-lg border px-4 py-2 text-xs text-fg transition hover:bg-line-strong border-transparent bg-line-strong"
          >
            Use this part
          </button>
        </div>

        {error && <p className="mt-4 text-xs text-holly-soft">{error}</p>}
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
      className={`mx-auto flex max-w-xl flex-col items-center justify-center rounded-xl border border-dashed px-10 py-16 text-center transition ${
        isDragging
          ? "bg-line-strong"
          : "bg-elevated"
      }`}
    >
      {isUploading || isRolling ? (
        <p className="text-fg-soft">
          {isRolling
            ? "Rolling a song…"
            : "Analyzing audio — this can take a moment…"}
        </p>
      ) : (
        <>
          <p className="text-fg-soft">
            Drop your song's MP3 here, or{" "}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer text-fg underline underline-offset-2 hover:text-fg"
            >
              browse
            </button>
          </p>

          <p className="mt-2 text-xs text-fg-muted">
            MP3 only — analyzed for BPM, sections, and energy
          </p>

          {rollSongs && (
            <button
              onClick={() => void rollSong()}
              className="mt-6 cursor-pointer rounded-full px-5 py-2 text-xs text-fg-soft transition hover:text-fg bg-line-strong hover:bg-line-hover"
            >
              Or roll a random song
            </button>
          )}

          {replacing && (
            <>
              <p className="mt-4 text-xs text-fg-muted">
                {resetOnUpload.current
                  ? "The keyframes of this round are cleared once the new song has been analyzed."
                  : "Your keyframes are kept exactly as they are."}
              </p>
              <button
                onClick={() => {
                  resetOnUpload.current = false;
                  setReplacing(false);
                  setError(null);
                }}
                className="mt-3 cursor-pointer rounded-full px-4 py-2 text-xs text-fg-muted transition hover:text-fg bg-elevated hover:bg-line-strong"
              >
                Cancel and keep the current song
              </button>
            </>
          )}
        </>
      )}

      {error && (
        <p className="mt-4 text-xs text-holly-soft">{error}</p>
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
