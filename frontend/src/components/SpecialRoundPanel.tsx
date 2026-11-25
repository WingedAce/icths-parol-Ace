import { useState } from "react";

import logo from "../assets/logo.png";
import { useServerNow } from "../lib/useSpecialRound";
import {
  countdownAt,
  setSpecialRoundTest,
  SPECIAL_ROUND_DEADLINE,
} from "../lib/specialRound";

const pad = (n: number) => String(n).padStart(2, "0");

function LockIcon({ open = false }: { open?: boolean }) {
  return (
    <svg
      className="sr-lock-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d={open ? "M8 10.5V7.5a4 4 0 0 1 7.6-1.7" : "M8 10.5V7.5a4 4 0 0 1 8 0v3"} />
      <circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

// TEST RUN: for signed-in developers only (it is not rendered for anyone else,
// and the database refuses it for anyone who isn't a developer). It shows
// every group's developers the same unlocked Special Round, on the same
// timer, without unlocking the real round or touching the deadline. It is
// separate from the "Unlock Special Round" switch in the Developer Window.
function TestRunStart({ onChanged }: { onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      await setSpecialRoundTest(true);
      onChanged();
    } catch (err) {
      console.error("Could not start the test run:", err);
      setError("Couldn't start the test run. Check that the Special Round timer SQL was run in Supabase.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sr-testbar mt-8 text-center">
      <p className="font-semibold uppercase tracking-widest">Developers only</p>
      <p className="mt-1">
        Preview the unlocked Special Round exactly as groups will get it. Other
        developers see it too. Regular users keep seeing this screen, and the
        real round stays locked.
      </p>
      <button type="button" className="sr-gold-btn mt-3" disabled={busy} onClick={start}>
        {busy ? "Starting..." : "TEST RUN"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-holly-soft">
          {error}
        </p>
      )}
    </div>
  );
}

// The Special Round screen, shown while groups can't use the round yet.
//  - Before the deadline: logo, lock, LOCKED and a live countdown.
//  - After the deadline: the countdown has ended, but the start time is not
//    known in advance, so groups wait for the system's confirmation (a
//    developer turning on "Unlock Special Round"). The page then opens by
//    itself, no refresh needed.
// `now` is the server-adjusted clock, ticking once a second.
export default function SpecialRoundPanel({
  clockOffset,
  isAdmin = false,
  onTestChanged,
}: {
  clockOffset: number;
  /** A signed-in developer: shows the TEST RUN button. */
  isAdmin?: boolean;
  /** Called after TEST RUN starts, so the page re-reads the shared state. */
  onTestChanged?: () => void;
}) {
  const now = useServerNow(true, clockOffset);
  const open = now >= SPECIAL_ROUND_DEADLINE;
  const left = countdownAt(now);

  if (open) {
    return (
      <section className="sr-locked sr-waiting" aria-label="Special Round waiting for confirmation">
        <img src={logo} alt="I-PAROL SYNAPSE logo" draggable={false} className="sr-logo" />
        <div className="sr-lock" aria-hidden="true">
          <LockIcon open />
        </div>
        <h2 className="sr-locked-label sr-unlocked-label">PLEASE WAIT</h2>
        <p className="sr-wait-title">Wait for the system confirmation</p>
        <p className="sr-wait-note" role="status">
          The countdown has ended, but the Special Round can't be used yet. It
          begins once the system confirms it. This page opens the round by
          itself, so you can stay here.
        </p>
        {isAdmin && <TestRunStart onChanged={() => onTestChanged?.()} />}
      </section>
    );
  }

  const units: [string, number][] = [
    ["Days", left.days],
    ["Hours", left.hours],
    ["Minutes", left.minutes],
    ["Seconds", left.seconds],
  ];

  return (
    <section className="sr-locked" aria-label="Special Round locked">
      <img src={logo} alt="I-PAROL SYNAPSE logo" draggable={false} className="sr-logo" />
      <div className="sr-lock" aria-hidden="true">
        <LockIcon />
      </div>
      <h2 className="sr-locked-label">LOCKED</h2>

      <div
        className="sr-count"
        role="timer"
        aria-label={`${left.days} days ${left.hours} hours ${left.minutes} minutes ${left.seconds} seconds left`}
      >
        {units.map(([label, value]) => (
          <div key={label} className="sr-count-cell">
            <span className="sr-count-num">{pad(value)}</span>
            <span className="sr-count-label">{label}</span>
          </div>
        ))}
      </div>

      <p className="sr-until">
        Unlocks{" "}
        {new Date(SPECIAL_ROUND_DEADLINE).toLocaleString("en-US", {
          timeZone: "Asia/Manila",
          dateStyle: "long",
          timeStyle: "short",
        })}{" "}
        (Philippine Time)
      </p>
      {isAdmin && <TestRunStart onChanged={() => onTestChanged?.()} />}
    </section>
  );
}
