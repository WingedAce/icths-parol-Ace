import { useRef, useState } from "react";

import AudioUploader from "./AudioUploader";
import ConfirmDialog from "./ConfirmDialog";
import { deleteAudio } from "../lib/audioStore";
import {
  removeSpecialRoundSongAndKeyframes,
  setSpecialRoundDuration,
  setSpecialRoundSong,
  setSpecialRoundTest,
  setSpecialRoundUnlocked,
  SPECIAL_ROUND_DEADLINE,
  SPECIAL_SONG_ID,
  type SpecialSong,
} from "../lib/specialRound";
import {
  activeRun,
  clampDuration,
  formatClock,
  MAX_DURATION_MIN,
  MIN_DURATION_MIN,
  timerAt,
} from "../lib/specialTimer";
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
// Where this browser remembers whether the Special Round section is open.
const OPEN_KEY = "parol-dev-special-round";

export default function SpecialRoundAdmin() {
  // Re-read every 2 seconds: this window shows the live shared timer.
  const special = useSpecialRound(2_000);
  const [busy, setBusy] = useState<"" | "unlock" | "song" | "timer">("");
  const [confirmEndTest, setConfirmEndTest] = useState(false);
  // Open / closed (the arrow in the header). Remembered on this browser only.
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(OPEN_KEY) !== "closed";
    } catch {
      return true;
    }
  });
  function toggleOpen() {
    setOpen((was) => {
      try {
        window.localStorage.setItem(OPEN_KEY, was ? "closed" : "open");
      } catch {
        // Not remembering is fine.
      }
      return !was;
    });
  }
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

  // The shared timer: the very same start time and length every group uses
  // (official round if unlocked, otherwise a TEST RUN), not a copy of its own.
  const run = activeRun(special);
  const liveNow = useServerNow(true, special.clockOffset, 500);
  const timer = run ? timerAt(run, liveNow) : null;
  const testOn = special.test?.active === true;

  async function changeDuration(delta: number) {
    if (busy || !special.loaded) return;
    const next = clampDuration(special.durationMin + delta);
    if (next === special.durationMin) return;
    setBusy("timer");
    setError("");
    try {
      await setSpecialRoundDuration(next);
      special.setDurationLocal(next);
      void special.refresh();
    } catch (err) {
      console.error("Special Round duration change failed:", err);
      setError(FAIL);
    } finally {
      setBusy("");
    }
  }

  async function changeTest(active: boolean) {
    if (busy) return;
    setBusy("timer");
    setError("");
    try {
      await setSpecialRoundTest(active);
      void special.refresh();
    } catch (err) {
      console.error("Special Round test run change failed:", err);
      setError(FAIL);
    } finally {
      setBusy("");
    }
  }

  const officialLabel = !special.unlocked
    ? "Not unlocked"
    : timer?.finished
      ? "Active, timer ended"
      : "Active";
  const testLabel = !testOn
    ? "Off"
    : special.unlocked
      ? "On, but ignored while the official round is unlocked"
      : timer?.finished
        ? "Active, timer ended"
        : "Active";
  const timerLabel = !run
    ? "No timer running"
    : timer?.finished
      ? "Ended"
      : timer?.counting
        ? `Get ready: starts in ${Math.ceil(timer.countdownMs / 1000)} s`
        : "Running";

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
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-controls="sr-admin-body"
        className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
      >
        <span className="text-xs font-medium uppercase tracking-[0.2em] text-[#f1cf72]">
          Special Round
        </span>
        <span
          aria-hidden="true"
          className="text-sm leading-none text-[#f1cf72]"
          title={open ? "Close" : "Open"}
        >
          {open ? "▲" : "▼"}
        </span>
      </button>
      {!open && (
        <p className="mt-2 text-xs text-fg-muted">
          Official: {officialLabel} · Test run: {testLabel}
          {timer ? ` · Timer: ${formatClock(timer.remainingMs)}` : ""} ·{" "}
          {special.durationMin} min
        </p>
      )}

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

      {/* Everything below opens and closes. It stays mounted (just hidden) so
          nothing in it is lost, e.g. a song being uploaded. */}
      <div id="sr-admin-body" hidden={!open}>
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
        <p className="text-sm font-medium text-fg">Timer and test run</p>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">
          One shared timer for every group and device. It starts when the round
          unlocks (or when a test run starts). When it reaches zero, groups can
          only extract their code.
        </p>

        <div
          className="sr-timer-banner mt-3"
          role="timer"
          aria-label="Special Round time left"
        >
          <p className="sr-timer-kicker">
            {run ? (run.kind === "test" ? "Test run" : "Official round") : "Timer"}
          </p>
          <p
            className={`sr-timer-digits sr-timer-digits-lg${
              timer?.finished ? " sr-timer-done" : ""
            }`}
            aria-live="off"
          >
            {timer ? formatClock(timer.remainingMs) : "--:--"}
          </p>
          <p className="sr-timer-sub">{timerLabel}</p>
        </div>

        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-fg-muted">Official Special Round</dt>
          <dd className="text-fg">{officialLabel}</dd>
          <dt className="text-fg-muted">Test run</dt>
          <dd className="text-fg">{testLabel}</dd>
          <dt className="text-fg-muted">Configured duration</dt>
          <dd className="text-fg">{special.durationMin} minutes</dd>
        </dl>

        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">Duration</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">
              1 to {MAX_DURATION_MIN} minutes. Takes effect for every group
              right away, even while the timer is running.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="Decrease duration by one minute"
              className="sr-ghost-btn"
              disabled={
                busy !== "" || !special.loaded || special.durationMin <= MIN_DURATION_MIN
              }
              onClick={() => void changeDuration(-1)}
            >
              −
            </button>
            <span
              className="w-20 text-center font-mono text-sm tabular-nums text-fg"
              aria-live="polite"
            >
              {special.durationMin} min
            </span>
            <button
              type="button"
              aria-label="Increase duration by one minute"
              className="sr-ghost-btn"
              disabled={
                busy !== "" || !special.loaded || special.durationMin >= MAX_DURATION_MIN
              }
              onClick={() => void changeDuration(1)}
            >
              +
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {testOn ? (
            <button
              type="button"
              className="sr-ghost-btn"
              disabled={busy !== ""}
              onClick={() => setConfirmEndTest(true)}
            >
              End test run
            </button>
          ) : (
            <button
              type="button"
              className="sr-gold-btn"
              disabled={busy !== "" || !special.loaded || special.unlocked}
              onClick={() => void changeTest(true)}
            >
              TEST RUN
            </button>
          )}
          <p className="text-xs text-fg-muted">
            {special.unlocked
              ? "The official round is unlocked, so a test run isn't needed."
              : "Developers see the unlocked round on the shared timer. Regular users don't, and nothing is unlocked."}
          </p>
        </div>
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

      </div>

      {confirmEndTest && (
        <ConfirmDialog
          title="End the test run?"
          checkboxLabel="I understand"
          confirmLabel="End test run"
          onConfirm={() => {
            setConfirmEndTest(false);
            void changeTest(false);
          }}
          onCancel={() => setConfirmEndTest(false)}
        >
          <p>
            The test run ends for every developer. The Special Round goes back
            to its normal state. Nothing is unlocked and the deadline is not
            changed.
          </p>
        </ConfirmDialog>
      )}

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
