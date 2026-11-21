import { TIMED_MINUTES, type TimedMinutes } from "../lib/timedSession";

const formatTimer = (ms: number) => {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

type SidebarProps = {
  status: "idle" | "countdown" | "running" | "paused" | "finished";
  // Idle: what the person picked. Otherwise: what the session is using.
  minutes: TimedMinutes;
  remainingMs: number;
  onPickMinutes: (minutes: TimedMinutes) => void;
  onPause: () => void;
  onNewSession: () => void;
  // The finished attempt: already in the logbook, and the button that saves it.
  logged: boolean;
  onSaveToLogbook: () => void;
  saving: boolean;
};

// The timer, at the side of the Timed mode workspace.
export function TimedSidebar({
  status,
  minutes,
  remainingMs,
  onPickMinutes,
  onPause,
  onNewSession,
  logged,
  onSaveToLogbook,
  saving,
}: SidebarProps) {
  const totalMs = minutes * 60_000;
  const used = Math.min(1, Math.max(0, 1 - remainingMs / totalMs));

  return (
    <aside
      aria-label="Timer"
      className="w-full rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-6 lg:order-2 lg:w-60 lg:shrink-0"
    >
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
        Timer
      </p>

      {status === "idle" || status === "countdown" ? (
        <>
          <div
            role="radiogroup"
            aria-label="Timer length"
            className="mt-4 grid grid-cols-3 gap-2 lg:grid-cols-1"
          >
            {TIMED_MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={minutes === m}
                disabled={status === "countdown"}
                onClick={() => onPickMinutes(m)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-default ${
                  minutes === m
                    ? "bg-pine text-fg"
                    : "bg-elevated text-fg-muted hover:text-fg disabled:hover:text-fg-muted"
                } ${status === "idle" ? "cursor-pointer" : ""}`}
              >
                {m} minutes
              </button>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-fg-muted">
            Upload your song on the Song tab. Once it is analyzed, a 10 second
            countdown starts and then the timer begins.
          </p>
        </>
      ) : (
        <>
          <p
            className={`mt-3 font-mono text-4xl tabular-nums ${
              status === "finished" ? "text-holly-soft" : "text-fg"
            }`}
            aria-live="off"
          >
            {formatTimer(remainingMs)}
          </p>
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-elevated"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full bg-pine-soft"
              style={{ width: `${used * 100}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-fg-muted">{minutes} minute timer</p>

          {status === "running" ? (
            <button
              type="button"
              onClick={onPause}
              className="mt-5 w-full cursor-pointer rounded-lg bg-elevated px-4 py-2.5 text-sm font-medium text-fg transition hover:bg-line-strong"
            >
              Pause
            </button>
          ) : (
            <>
              <p className="mt-5 text-sm font-medium text-fg">Time's up</p>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                Nothing can be changed anymore. You can still play your attempt
                and open the Code tab.
              </p>
              <button
                type="button"
                onClick={onSaveToLogbook}
                disabled={logged || saving}
                className="mt-5 w-full cursor-pointer rounded-lg bg-pine px-4 py-2.5 text-sm font-medium text-fg transition hover:bg-pine/80 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-pine"
              >
                {logged ? "Saved to logbook" : saving ? "Saving..." : "Save to logbook"}
              </button>
              <button
                type="button"
                onClick={onNewSession}
                className="mt-3 w-full cursor-pointer rounded-lg bg-elevated px-4 py-2.5 text-sm text-fg-soft transition hover:bg-line-strong hover:text-fg"
              >
                Start a new session
              </button>
            </>
          )}
        </>
      )}
    </aside>
  );
}

// The 10 second "get ready" screen. It covers the whole page, so nothing can
// be touched until the timer starts.
export function TimedCountdown({ secondsLeft }: { secondsLeft: number }) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Timer starting"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-canvas/95 p-6 text-center backdrop-blur-sm"
    >
      <p className="text-sm font-medium uppercase tracking-widest text-fg-muted">
        Get ready
      </p>
      <p
        className="mt-6 font-mono text-8xl tabular-nums text-fg sm:text-9xl"
        aria-live="polite"
      >
        {secondsLeft}
      </p>
      <p className="mt-6 max-w-xs text-sm text-fg-muted">
        Your timer starts when this reaches zero.
      </p>
    </div>
  );
}

// Shown instead of the whole workspace while the timer is paused: no tabs,
// no keyframes, no transitions.
export function TimedPaused({
  remainingMs,
  onPlay,
  onQuit,
}: {
  remainingMs: number;
  onPlay: () => void;
  onQuit: () => void;
}) {
  return (
    <section
      aria-label="Timer Mode is paused"
      className="mx-auto flex max-w-xl flex-col items-center rounded-2xl border border-line bg-surface px-8 py-16 text-center"
    >
      <h2 className="text-2xl font-medium text-fg">Timer Mode is paused.</h2>
      <p className="mt-2 font-mono text-sm tabular-nums text-fg-muted">
        {formatTimer(remainingMs)} left
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onPlay}
          className="cursor-pointer rounded-lg bg-pine px-6 py-2.5 text-sm font-medium text-fg transition hover:bg-pine/80"
        >
          Play
        </button>
        <button
          type="button"
          onClick={onQuit}
          className="cursor-pointer rounded-lg bg-elevated px-6 py-2.5 text-sm text-fg-soft transition hover:bg-line-strong hover:text-fg"
        >
          Quit
        </button>
      </div>
    </section>
  );
}
