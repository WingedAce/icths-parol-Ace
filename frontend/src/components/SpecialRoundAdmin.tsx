import { useRef, useState } from "react";

import AudioUploader from "./AudioUploader";
import ConfirmDialog from "./ConfirmDialog";
import { deleteAudio } from "../lib/audioStore";
import {
  removeSpecialRoundSongAndKeyframes,
  setSpecialRoundSong,
  setSpecialRoundUnlocked,
  SPECIAL_ROUND_DEADLINE,
  SPECIAL_SONG_ID,
  type SpecialSong,
} from "../lib/specialRound";
import { useServerNow, useSpecialRound } from "../lib/useSpecialRound";
import type { AudioAnalysis, ProjectNode } from "../types";

function Switch({
  label,
  checked,
  busy,
  onToggle,
}: {
  label: string;
  checked: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={busy}
      onClick={onToggle}
      className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-[#d8aa3e]" : "bg-elevated"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-fg transition-transform ${
          checked ? "translate-x-5" : ""
        }`}
      />
    </button>
  );
}

// Developer controls for the Special Round, at the top of the Developer
// Window (the page itself is behind the admin gate, and every change is also
// checked by the database). Nothing here can move the countdown: the
// December 7 deadline is fixed in the code.
export default function SpecialRoundAdmin() {
  const special = useSpecialRound();
  const [busy, setBusy] = useState<"" | "unlock" | "song">("");
  const [error, setError] = useState("");
  // Choosing a different song: the current one stays live for every group
  // until the new one has been analyzed and saved.
  const [replacing, setReplacing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const freshOriginal = useRef<AudioAnalysis | undefined>(undefined);

  const FAIL =
    "Couldn't save that. Check your connection, and that the Special Round SQL was run in Supabase.";

  async function toggleUnlock() {
    if (busy) return;
    const next = !special.unlocked;
    setBusy("unlock");
    setError("");
    try {
      await setSpecialRoundUnlocked(next);
      special.setUnlockedLocal(next);
      void special.refresh();
    } catch (err) {
      console.error("Special Round change failed:", err);
      setError(FAIL);
    } finally {
      setBusy("");
    }
  }

  // REMOVE SONG: deletes the song and every group's Special Round keyframes.
  // (Different from replacing the song, which keeps the keyframes.)
  async function removeSong() {
    setConfirmRemove(false);
    setBusy("song");
    setError("");
    try {
      await removeSpecialRoundSongAndKeyframes();
      special.setSongLocal(null);
      setReplacing(false);
      void deleteAudio(SPECIAL_SONG_ID).catch(() => {});
      void special.refresh();
    } catch (err) {
      console.error("Special Round remove failed:", err);
      setError(FAIL);
    } finally {
      setBusy("");
    }
  }

  async function saveSong(song: SpecialSong) {
    setBusy("song");
    setError("");
    try {
      await setSpecialRoundSong(song);
      special.setSongLocal(song);
      void special.refresh();
      setReplacing(false);
    } catch (err) {
      console.error("Special Round song failed:", err);
      setError(FAIL);
    } finally {
      setBusy("");
    }
  }

  // Ticks once a second only until the deadline, then stops.
  const beforeDeadline = Date.now() + special.clockOffset < SPECIAL_ROUND_DEADLINE;
  const now = useServerNow(beforeDeadline, special.clockOffset);
  // The countdown has ended and groups are waiting for a developer to unlock.
  const needsUnlock = now >= SPECIAL_ROUND_DEADLINE && !special.unlocked && special.loaded;

  const song = special.song;
  // The uploader works on a stand-in node that only holds the song.
  const songNode: ProjectNode = {
    id: SPECIAL_SONG_ID,
    name: "Special Round song",
    type: "animation",
    parentId: "",
    audioFileName: replacing ? undefined : song?.fileName,
    audioAnalysis: replacing ? undefined : song?.analysis,
    audioAnalysisOriginal: replacing ? undefined : song?.original,
  };

  const deadline = new Date(SPECIAL_ROUND_DEADLINE).toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <section
      aria-label="Special Round controls"
      className="mt-8 rounded-2xl border border-[#e6c15a]/50 bg-surface px-5 py-5"
    >
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#f1cf72]">
        Special Round
      </p>

      {needsUnlock && (
        <div
          role="alert"
          className="sr-reminder mt-4 rounded-xl px-4 py-3 text-sm leading-relaxed"
        >
          <strong className="font-semibold">Reminder:</strong> the countdown has
          ended and groups are waiting for the system confirmation. Turn on
          “Unlock Special Round” below when the round should begin.
        </div>
      )}

      <div
        className={`mt-4 flex items-center justify-between gap-4 rounded-xl ${
          needsUnlock ? "sr-reminder-row px-4 py-3" : ""
        }`}
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">Unlock Special Round</p>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            {special.unlocked
              ? "Unlocked: groups can use the Special Round now."
              : needsUnlock
                ? "Groups are waiting. Turn this on to let them start."
                : `Groups wait on the countdown until ${deadline} (Philippine Time), then for you to unlock. You can also unlock early.`}
          </p>
        </div>
        <Switch
          label="Unlock Special Round"
          checked={special.unlocked}
          busy={busy !== "" || !special.loaded}
          onToggle={toggleUnlock}
        />
      </div>

      <div className="mt-4 border-t border-line/70 pt-4">
        <p className="text-sm font-medium text-fg">Special Round song</p>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">
          One song for every group, new and existing. Groups keep their own
          keyframes if you change it.
        </p>

        <div className="mt-3">
          <AudioUploader
            node={songNode}
            keepStoredAudio
            maxClipSeconds={60}
            onFreshAnalysis={(analysis) => {
              freshOriginal.current = analysis;
            }}
            onAnalyzed={(fileName, analysis) => {
              void saveSong({
                fileName,
                analysis,
                original: freshOriginal.current ?? analysis,
              });
            }}
            onTempoChange={(analysis) => {
              if (!song) return;
              void saveSong({ ...song, analysis });
            }}
            onClear={() => setReplacing(true)}
          />
          {song && !replacing && (
            <button
              type="button"
              disabled={busy !== ""}
              onClick={() => setConfirmRemove(true)}
              className="mt-2 w-full cursor-pointer rounded-full border border-holly/50 px-4 py-2 text-xs text-holly-soft transition hover:bg-holly/10 disabled:opacity-50"
            >
              Remove song and keyframes
            </button>
          )}
          {replacing && song && (
            <button
              type="button"
              onClick={() => setReplacing(false)}
              className="mt-2 w-full cursor-pointer rounded-full bg-elevated px-4 py-2 text-xs text-fg-soft transition hover:text-fg"
            >
              Cancel and keep the current song
            </button>
          )}
        </div>
      </div>

      {confirmRemove && (
        <ConfirmDialog
          title="Remove the Special Round song?"
          checkboxLabel="I understand this also deletes the Special Round keyframes of every group."
          confirmLabel="Remove song and keyframes"
          onConfirm={removeSong}
          onCancel={() => setConfirmRemove(false)}
        >
          <p>
            This removes the song for all groups and <strong>deletes the
            Special Round keyframes</strong> they made. It can't be undone.
          </p>
          <p className="text-fg-muted">
            To switch to another song and keep everyone's keyframes, use
            “Remove &amp; upload a different song” above instead.
          </p>
        </ConfirmDialog>
      )}

      {error && (
        <p role="alert" className="mt-4 text-xs text-holly-soft">
          {error}
        </p>
      )}
    </section>
  );
}
