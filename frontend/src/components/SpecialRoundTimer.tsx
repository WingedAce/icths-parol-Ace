import { useEffect, useRef, useState } from "react";

import { useServerNow } from "../lib/useSpecialRound";
import {
  formatClock,
  LEAD_IN_MS,
  timerAt,
  type SpecialRun,
} from "../lib/specialTimer";

// The Special Round's timer, in gold. Same layout as the Practice timer
// (a panel at the side), plus a big clock above the workspace. Every device
// works the time out from the same shared start time (see lib/specialTimer),
// so all groups see the same number. `run` is the same for TEST RUN and the
// official round: only the small TEST RUN badge differs, and that only exists
// for developers.

function useRunTimer(run: SpecialRun, clockOffset: number) {
  const now = useServerNow(true, clockOffset, 250);
  return timerAt(run, now);
}

type TimerProps = { run: SpecialRun; clockOffset: number };

// The big clock above the workspace.
export function SpecialTimerBanner({ run, clockOffset }: TimerProps) {
  const timer = useRunTimer(run, clockOffset);
  const minutes = Math.round(run.durationMs / 60_000);
  return (
    <div className="sr-timer-banner" role="timer" aria-label="Special Round time left">
      <p className="sr-timer-kicker">
        Special Round
        {run.kind === "test" && <span className="sr-test-badge">Test run</span>}
      </p>
      <p
        className={`sr-timer-digits sr-timer-digits-lg${
          timer.finished ? " sr-timer-done" : ""
        }`}
        aria-live="off"
      >
        {formatClock(timer.remainingMs)}
      </p>
      <p className="sr-timer-sub">
        {timer.finished ? "Time's up" : `${minutes} minute timer`}
      </p>
    </div>
  );
}

// The timer at the side of the workspace (like Practice's).
export function SpecialTimerSidebar({
  run,
  clockOffset,
  onOpenCode,
}: TimerProps & { onOpenCode: () => void }) {
  const timer = useRunTimer(run, clockOffset);
  const minutes = Math.round(run.durationMs / 60_000);
  const used = Math.min(1, Math.max(0, 1 - timer.remainingMs / timer.totalMs));

  return (
    <aside
      aria-label="Timer"
      className="w-full rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-6 lg:order-2 lg:w-60 lg:shrink-0"
    >
      <p className="text-xs font-medium uppercase tracking-wider text-[#cdb470]">
        Timer
        {run.kind === "test" && <span className="sr-test-badge">Test run</span>}
      </p>
      <p
        className={`sr-timer-digits mt-3 text-4xl${
          timer.finished ? " sr-timer-done" : ""
        }`}
        aria-live="off"
      >
        {formatClock(timer.remainingMs)}
      </p>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-elevated"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${used * 100}%`,
            background: "linear-gradient(90deg, #d8aa3e, #f6dc8a)",
          }}
        />
      </div>
      <p className="mt-2 text-xs text-fg-muted">{minutes} minute timer</p>

      {timer.finished ? (
        <>
          <p className="sr-welldone-side">WELL DONE!</p>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            Time's up. Nothing can be changed anymore. You can still play your
            attempt and open the Code tab to extract your code.
          </p>
          <button
            type="button"
            onClick={onOpenCode}
            className="mt-5 w-full cursor-pointer rounded-lg px-4 py-2.5 text-sm font-semibold transition hover:brightness-110"
            style={{
              color: "#2a1f05",
              background: "linear-gradient(180deg, #f6dc8a, #d8aa3e)",
            }}
          >
            Extract code
          </button>
        </>
      ) : (
        <p className="mt-5 text-xs leading-relaxed text-fg-muted">
          The same time runs for every group. When it reaches zero the Preview
          locks and you can only extract your code.
        </p>
      )}
    </aside>
  );
}

// What the GET READY! screen says. It changes every 2 seconds, in this order.
const READY_MESSAGES = [
  "GET READY!",
  "GOOD LUCK!",
  "REMEMBER: THE SONG IS PRE-UPLOADED FOR THIS ROUND",
];

// The 15 ... 1 countdown before the minutes start: gold digits on a
// translucent black screen, like Practice's get-ready but gold. It covers the
// workspace (so nothing can be touched), and everyone sees the same number
// because it is worked out from the shared start time.
export function SpecialGetReady({ run, clockOffset }: TimerProps) {
  const now = useServerNow(true, clockOffset, 100);
  const left = Math.max(0, run.startedAt + LEAD_IN_MS - now);
  if (left <= 0) return null;
  const seconds = Math.ceil(left / 1000);
  const elapsed = Math.min(LEAD_IN_MS, Math.max(0, now - run.startedAt));
  const message =
    READY_MESSAGES[Math.floor(elapsed / 2000) % READY_MESSAGES.length];
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Special Round starting"
      className="sr-getready"
    >
      <p key={message} className="sr-getready-msg">
        {message}
      </p>
      <p className="sr-getready-digits" aria-live="off">
        {seconds}
      </p>
      <p className="sr-getready-sub">
        {run.kind === "test" ? "Test run. " : ""}Your timer starts when this
        reaches zero.
      </p>
    </div>
  );
}

const SHOW_MS = 10000; // well over the 5 seconds asked for, so it can be enjoyed

// Christmas colours with gold: red, green, white, gold.
const FESTIVE = ["#f6dc8a", "#d8aa3e", "#e23b3b", "#2fa84f", "#ffffff", "#c8102e"];

const CONFETTI = Array.from({ length: 56 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  delay: (i % 9) * 0.16,
  duration: 2.6 + (i % 6) * 0.45,
  rotate: (i * 53) % 360,
  color: FESTIVE[i % FESTIVE.length],
  wide: i % 4 === 0,
}));

const SNOW = Array.from({ length: 34 }, (_, i) => ({
  left: (i * 29 + 7) % 100,
  size: 0.6 + (i % 5) * 0.28,
  delay: (i % 11) * 0.35,
  duration: 4.2 + (i % 7) * 0.7,
  drift: ((i % 5) - 2) * 18,
}));

// String lights along the top: red, gold, green, blue, taking turns to blink.
const BULB_COLORS = ["#e23b3b", "#f6dc8a", "#2fa84f", "#4aa3ff"];
const BULBS = Array.from({ length: 22 }, (_, i) => ({
  left: 2 + (i * 96) / 21,
  color: BULB_COLORS[i % BULB_COLORS.length],
  delay: (i % 4) * 0.35,
}));

const SPARKLES = [
  { top: "8%", left: "6%", size: 1.6, delay: 0 },
  { top: "14%", left: "90%", size: 1.2, delay: 0.5 },
  { top: "78%", left: "4%", size: 1.3, delay: 0.9 },
  { top: "84%", left: "93%", size: 1.7, delay: 0.3 },
  { top: "-9%", left: "30%", size: 1.1, delay: 0.7 },
  { top: "-7%", left: "72%", size: 1.4, delay: 0.2 },
];

// The celebration, shown when this device sees the timer reach zero. It floats
// over the page without blocking it (so Extract code stays usable), and stays
// for 10 seconds: string lights, falling snow, confetti, twinkling stars and
// a shimmering gold WELL DONE!. Someone who opens the round after time is up
// doesn't get the pop-up, but still sees WELL DONE! in the side panel.
export function SpecialWellDone({ finished }: { finished: boolean }) {
  const [show, setShow] = useState(false);
  const wasFinished = useRef(finished);

  useEffect(() => {
    const before = wasFinished.current;
    wasFinished.current = finished;
    if (!finished || before) return;
    const open = window.setTimeout(() => setShow(true), 0);
    const close = window.setTimeout(() => setShow(false), SHOW_MS);
    return () => {
      window.clearTimeout(open);
      window.clearTimeout(close);
    };
  }, [finished]);

  if (!show) return null;
  return (
    <div className="sr-welldone" role="status" aria-live="polite">
      <div className="sr-welldone-glow" aria-hidden="true" />

      <div className="sr-lights" aria-hidden="true">
        {BULBS.map((b, i) => (
          <span
            key={i}
            className="sr-bulb"
            style={{
              left: `${b.left}%`,
              color: b.color,
              animationDelay: `${b.delay}s`,
            }}
          />
        ))}
      </div>

      <div className="sr-snow" aria-hidden="true">
        {SNOW.map((f, i) => (
          <span
            key={i}
            style={{
              left: `${f.left}%`,
              fontSize: `${f.size}rem`,
              animationDelay: `${f.delay}s`,
              animationDuration: `${f.duration}s`,
              ["--drift" as string]: `${f.drift}px`,
            }}
          >
            ❄
          </span>
        ))}
      </div>

      <div className="sr-confetti" aria-hidden="true">
        {CONFETTI.map((c, i) => (
          <span
            key={i}
            style={{
              left: `${c.left}%`,
              background: c.color,
              width: c.wide ? "1rem" : "0.6rem",
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.duration}s`,
              transform: `rotate(${c.rotate}deg)`,
            }}
          />
        ))}
      </div>

      <div className="sr-welldone-card">
        {SPARKLES.map((sp, i) => (
          <span
            key={i}
            className="sr-sparkle"
            aria-hidden="true"
            style={{
              top: sp.top,
              left: sp.left,
              fontSize: `${sp.size}rem`,
              animationDelay: `${sp.delay}s`,
            }}
          >
            ✦
          </span>
        ))}
        <p className="sr-welldone-deco" aria-hidden="true">
          🎄 ❄ 🎁 ❄ 🎄
        </p>
        <p className="sr-welldone-title">WELL DONE!</p>
        <p className="sr-welldone-cheer">Merry &amp; bright. You lit up the season!</p>
        <p className="sr-welldone-note">
          Time's up. Your work is kept. Open the Code tab to extract your code.
        </p>
      </div>
    </div>
  );
}
