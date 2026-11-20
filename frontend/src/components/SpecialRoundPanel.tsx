import logo from "../assets/logo.png";
import { useServerNow } from "../lib/useSpecialRound";
import { countdownAt, SPECIAL_ROUND_DEADLINE } from "../lib/specialRound";

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

// The Special Round screen, shown while groups can't use the round yet.
//  - Before the deadline: logo, lock, LOCKED and a live countdown.
//  - After the deadline: the countdown has ended, but the start time is not
//    known in advance, so groups wait for the system's confirmation (a
//    developer turning on "Unlock Special Round"). The page then opens by
//    itself, no refresh needed.
// `now` is the server-adjusted clock, ticking once a second.
export default function SpecialRoundPanel({ clockOffset }: { clockOffset: number }) {
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
    </section>
  );
}
