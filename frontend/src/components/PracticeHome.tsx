// The Practice workspace's start screen: two big cards, Timed mode (left)
// and Free practice (right). It replaces the Round 1-3 / Trial / Special
// Round tabs while Practice is open, so none of those are visible here.

export type PracticeMode = "choose" | "timed" | "free" | "logbook";

function StopwatchIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-24 w-24 sm:h-28 sm:w-28"
      aria-hidden="true"
    >
      <circle cx="32" cy="36" r="21" />
      <path d="M26 7h12" />
      <path d="M32 7v8" />
      <path d="M32 36V24" />
      <path d="M32 36l8 5" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-24 w-24 sm:h-28 sm:w-28"
      aria-hidden="true"
    >
      <path d="M32 7l7.6 16 17.4 2.2-12.8 12 3.3 17.3L32 45.6 16.5 54.5l3.3-17.3L7 25.2 24.4 23z" />
    </svg>
  );
}

const cardClass =
  "group flex min-h-64 cursor-pointer flex-col items-center justify-center gap-5 rounded-2xl border border-line bg-surface p-8 text-center transition hover:border-line-hover hover:bg-elevated focus-visible:outline-2 sm:aspect-square sm:min-h-0";

export default function PracticeHome({
  onPick,
}: {
  onPick: (mode: "timed" | "free" | "logbook") => void;
}) {
  return (
    <section aria-label="Practice" className="mx-auto max-w-3xl">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onPick("timed")}
          className={cardClass}
        >
          <span className="text-fg-soft transition group-hover:text-fg">
            <StopwatchIcon />
          </span>
          <span>
            <span className="block text-lg font-medium text-fg">
              Timed mode
            </span>
            <span className="mt-1 block text-sm text-fg-muted">
              Practice against the clock
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => onPick("free")}
          className={cardClass}
        >
          <span className="text-fg-soft transition group-hover:text-fg">
            <StarIcon />
          </span>
          <span>
            <span className="block text-lg font-medium text-fg">
              Free practice
            </span>
            <span className="mt-1 block text-sm text-fg-muted">
              Build and try things with no time limit
            </span>
          </span>
        </button>
      </div>

      <div className="mt-6 flex justify-center">
        <button
          type="button"
          onClick={() => onPick("logbook")}
          className="cursor-pointer rounded-xl border border-line bg-surface px-8 py-3 text-sm font-medium text-fg-soft transition hover:border-line-hover hover:bg-elevated hover:text-fg"
        >
          Logbook
        </button>
      </div>
    </section>
  );
}
