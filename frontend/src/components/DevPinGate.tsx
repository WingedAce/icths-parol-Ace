import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useNavigate } from "react-router";

import {
  DEV_MAX_FAILS,
  DEV_PIN_MAX_LENGTH,
  DEV_PIN_MIN_LENGTH,
  checkDevPin,
  clearFailures,
  formatUnlockTime,
  getLockState,
  hasDevPin,
  registerFailure,
  saveDevPin,
} from "../utils/accessLock";

type Mode = "create" | "enter" | "locked";

const PIN_PATTERN = new RegExp(
  `^\\d{${DEV_PIN_MIN_LENGTH},${DEV_PIN_MAX_LENGTH}}$`,
);

const inputClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-center text-xl tracking-[0.5em] text-white outline-none placeholder:text-white/20 focus:border-white/30";

function digitsOnly(value: string) {
  return value.replace(/\D/g, "").slice(0, DEV_PIN_MAX_LENGTH);
}

// Wraps the Developer Window. The first time it's ever opened on this device
// it asks for a new PIN (saved permanently); after that the PIN is required
// every time. Two wrong guesses and the PIN prompt disappears for a day.
export default function DevPinGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  const [unlocked, setUnlocked] = useState(false);
  const [mode, setMode] = useState<Mode>(() =>
    getLockState("pin").lockedUntil
      ? "locked"
      : hasDevPin()
        ? "enter"
        : "create",
  );
  const [lockedUntil, setLockedUntil] = useState<number | null>(
    () => getLockState("pin").lockedUntil,
  );

  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  if (unlocked) {
    return <>{children}</>;
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    if (!PIN_PATTERN.test(pin)) {
      setMessage(
        `Use ${DEV_PIN_MIN_LENGTH} to ${DEV_PIN_MAX_LENGTH} digits for the PIN.`,
      );
      return;
    }

    if (pin !== confirmPin) {
      setMessage("The two PINs don't match.");
      return;
    }

    setBusy(true);
    const saved = await saveDevPin(pin);
    setBusy(false);

    if (!saved) {
      setMessage(
        "Your browser wouldn't let this site save the PIN. Check that site data isn't blocked, then try again.",
      );
      return;
    }

    setPin("");
    setConfirmPin("");
    setMessage("");
    setUnlocked(true);
  }

  async function handleEnter(event: FormEvent) {
    event.preventDefault();
    if (busy || !pin) return;

    setBusy(true);
    const correct = await checkDevPin(pin);
    setBusy(false);

    if (correct) {
      clearFailures("pin");
      setPin("");
      setMessage("");
      setUnlocked(true);
      return;
    }

    const state = registerFailure("pin");
    setPin("");

    if (state.lockedUntil) {
      setLockedUntil(state.lockedUntil);
      setMode("locked");
      return;
    }

    setMessage(
      `Wrong PIN. ${state.failsLeft} guess${state.failsLeft === 1 ? "" : "es"} left.`,
    );
  }

  const backButton = (
    <button
      type="button"
      onClick={() => navigate("/")}
      className="mt-3 w-full cursor-pointer rounded-xl border border-white/15 px-4 py-3 text-sm text-white/60 transition hover:border-white/40 hover:text-white"
    >
      Back
    </button>
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050505] px-6 text-white">
      <div className="w-full max-w-sm text-center">
        <p className="mb-4 text-[10px] uppercase tracking-[0.45em] text-white/30">
          Developer Window
        </p>

        {mode === "create" && (
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <h1 className="font-serif text-3xl font-light tracking-[-0.03em]">
              Create a developer PIN
            </h1>

            <p className="text-sm leading-relaxed text-white/50">
              Choose {DEV_PIN_MIN_LENGTH} to {DEV_PIN_MAX_LENGTH} digits. It's
              saved on this device and will be asked every time you open the
              Developer Window. Write it down: it can't be recovered.
            </p>

            <input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(event) => setPin(digitsOnly(event.target.value))}
              placeholder="New PIN"
              aria-label="New PIN"
              className={inputClass}
            />

            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={confirmPin}
              onChange={(event) =>
                setConfirmPin(digitsOnly(event.target.value))
              }
              placeholder="Confirm PIN"
              aria-label="Confirm PIN"
              className={inputClass}
            />

            {message && (
              <p
                role="alert"
                className="rounded-xl border border-[#ff3b41]/60 bg-[#ff3b41]/10 px-4 py-3 text-xs leading-relaxed text-[#ff8a8e]"
              >
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-2 w-full cursor-pointer rounded-xl bg-white px-4 py-3 text-black transition hover:bg-white/90 disabled:opacity-50"
            >
              Save PIN
            </button>
          </form>
        )}

        {mode === "enter" && (
          <form onSubmit={handleEnter} className="flex flex-col gap-4">
            <h1 className="font-serif text-3xl font-light tracking-[-0.03em]">
              Enter developer PIN
            </h1>

            <p className="text-sm leading-relaxed text-white/50">
              You get {DEV_MAX_FAILS} guesses. After that this prompt is
              disabled for 24 hours.
            </p>

            <input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(event) => setPin(digitsOnly(event.target.value))}
              placeholder="PIN"
              aria-label="Developer PIN"
              className={inputClass}
            />

            {message && (
              <p
                role="alert"
                className="rounded-xl border border-[#ff3b41]/60 bg-[#ff3b41]/10 px-4 py-3 text-xs leading-relaxed text-[#ff8a8e]"
              >
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !pin}
              className="mt-2 w-full cursor-pointer rounded-xl bg-white px-4 py-3 text-black transition hover:bg-white/90 disabled:opacity-50"
            >
              Unlock
            </button>
          </form>
        )}

        {mode === "locked" && (
          <div className="flex flex-col">
            <h1 className="font-serif text-3xl font-light tracking-[-0.03em]">
              Developer access disabled
            </h1>

            <p className="mt-4 text-sm leading-relaxed text-white/50">
              Too many wrong PIN guesses.{" "}
              {lockedUntil
                ? `The PIN prompt is disabled until ${formatUnlockTime(lockedUntil)}.`
                : "Please try again later."}
            </p>
          </div>
        )}

        {backButton}
      </div>
    </main>
  );
}
