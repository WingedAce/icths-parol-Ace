import { useEffect, useState } from "react";

import {
  checkColorLock,
  createColorLock,
  getColorLockStatus,
  type ColorLockStatus,
} from "../lib/colorLock";
import {
  COLOR_COMBO_LENGTH,
  COLOR_MAX_FAILS,
  formatUnlockTime,
  grantSessionPass,
} from "../utils/accessLock";
import { PIN_COLORS } from "../utils/pins";

type Phase = "loading" | "pick" | "retry" | "locked" | "error";
type Swatch = (typeof PIN_COLORS)[number];

// The colors are laid out in a fresh random order every attempt, so the
// combo has to be remembered by color, not by where the buttons sit.
function shuffled(): Swatch[] {
  const list = [...PIN_COLORS];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function hexOf(name: string): string {
  return PIN_COLORS.find((color) => color.name === name)?.hex ?? "#ffffff";
}

type Props = {
  /** The group's node id: every group has ONE color combo, on every device. */
  groupId: string;
  /** Shown under the title, e.g. "Group 3 · Section A · Batch 2026". */
  label: string;
  onSuccess: () => void;
  onCancel: () => void;
};

export default function ColorLockGate({
  groupId,
  label,
  onSuccess,
  onCancel,
}: Props) {
  // The group's lock lives on the server, so we first ask it whether this
  // group already has a combo (and whether it is locked out).
  const [phase, setPhase] = useState<Phase>("loading");
  const [isSetup, setIsSetup] = useState(true);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [failsLeft, setFailsLeft] = useState(COLOR_MAX_FAILS);
  // "load" = could not ask the server, "network" = failed while submitting
  const [errorKind, setErrorKind] = useState<"load" | "network">("load");
  const [notice, setNotice] = useState("");

  const [order, setOrder] = useState<Swatch[]>(shuffled);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function applyStatus(status: ColorLockStatus) {
    setIsSetup(!status.exists);
    setLockedUntil(status.lockedUntil);
    setFailsLeft(status.failsLeft);
    setPhase(status.lockedUntil ? "locked" : "pick");
  }

  function failLoad(error: unknown) {
    console.error("Could not read the color lock:", error);
    setErrorKind("load");
    setPhase("error");
  }

  // Ask the server whether this group already has a color lock.
  useEffect(() => {
    let cancelled = false;
    getColorLockStatus(groupId)
      .then((status) => {
        if (!cancelled) applyStatus(status);
      })
      .catch((error) => {
        if (!cancelled) failLoad(error);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  function reloadStatus() {
    setPhase("loading");
    getColorLockStatus(groupId).then(applyStatus).catch(failLoad);
  }

  function resetAttempt() {
    setPicked([]);
    setOrder(shuffled());
    setBusy(false);
    setPhase("pick");
  }

  async function finish(combo: string[]) {
    try {
      if (isSetup) {
        const created = await createColorLock(groupId, combo);
        if (created) {
          grantSessionPass(groupId);
          onSuccess();
          return;
        }
        // Another device saved this group's color lock a moment ago.
        setIsSetup(false);
        setNotice(
          "This group already has a color lock (another device just made it). Enter that one.",
        );
        resetAttempt();
        return;
      }

      const result = await checkColorLock(groupId, combo);

      if (result.ok) {
        grantSessionPass(groupId);
        onSuccess();
        return;
      }

      if (!result.exists) {
        // The developer reset this group's lock while the screen was open.
        setIsSetup(true);
        setNotice("This group's color lock was reset. Create a new one.");
        resetAttempt();
        return;
      }

      setFailsLeft(result.failsLeft);
      setLockedUntil(result.lockedUntil);
      setPhase(result.lockedUntil ? "locked" : "retry");
    } catch (error) {
      console.error("Color lock request failed:", error);
      setErrorKind("network");
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }

  const isFull = picked.length === COLOR_COMBO_LENGTH;

  // Picking colors never submits by itself, so there is time to screenshot
  // the combo first. Only the Enter button submits.
  function handlePick(name: string) {
    if (busy || picked.length >= COLOR_COMBO_LENGTH) return;
    setPicked([...picked, name]);
  }

  function handleEnter() {
    if (busy || !isFull) return;
    setBusy(true);
    void finish(picked);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Color combo lock"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#050505] px-6 py-10 text-white"
    >
      <div className="w-full max-w-sm text-center">
        <p className="mb-2 text-[10px] uppercase tracking-[0.45em] text-white/30">
          Color Combo Lock
        </p>

        <p className="mb-5 text-xs text-white/50">{label}</p>

        {phase === "loading" && (
          <>
            <p className="mt-8 text-sm text-white/50">
              Checking this group's color lock…
            </p>

            <button
              type="button"
              onClick={onCancel}
              className="mt-8 w-full cursor-pointer rounded-xl border border-white/15 px-4 py-3 text-sm text-white/60 transition hover:border-white/40 hover:text-white"
            >
              Back
            </button>
          </>
        )}

        {phase === "pick" && (
          <>
            <h2 className="font-serif text-3xl font-light tracking-[-0.03em]">
              {isSetup ? "Create your color lock" : "Enter your color lock"}
            </h2>

            <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-white/50">
              {isSetup
                ? `Tap ${COLOR_COMBO_LENGTH} colors in the order you want. You can pick the same color more than once. This group will need this exact order every time it's opened, on any device. Take a screenshot of your colors before you press Enter.`
                : `Tap your ${COLOR_COMBO_LENGTH} colors in the right order.`}
            </p>

            {notice && (
              <p
                role="status"
                className="mx-auto mt-4 max-w-xs rounded-xl border border-[#ffb36b]/50 bg-[#ffb36b]/10 px-3 py-2 text-xs leading-relaxed text-[#ffc98f]"
              >
                {notice}
              </p>
            )}

            <div
              className="mt-8 flex justify-center gap-2.5"
              aria-label={`${picked.length} of ${COLOR_COMBO_LENGTH} colors chosen`}
            >
              {Array.from({ length: COLOR_COMBO_LENGTH }, (_, index) => {
                const name = picked[index];

                // While creating, show the chosen colors (with their names)
                // so they can be memorised or screenshotted; when entering,
                // keep them hidden.
                if (isSetup) {
                  return (
                    <div
                      key={index}
                      className="flex w-12 flex-col items-center gap-1"
                    >
                      <span
                        className="h-7 w-7 rounded-full border border-white/30"
                        style={{
                          backgroundColor: name ? hexOf(name) : "transparent",
                        }}
                      />
                      <span className="h-3 text-[8px] uppercase tracking-[0.12em] text-white/50">
                        {name ?? ""}
                      </span>
                    </div>
                  );
                }

                return (
                  <span
                    key={index}
                    className="h-3.5 w-3.5 rounded-full border border-white/30"
                    style={{
                      backgroundColor: name
                        ? "rgba(255,255,255,0.75)"
                        : "transparent",
                    }}
                  />
                );
              })}
            </div>

            <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-5">
              {order.map((color) => (
                <button
                  key={color.name}
                  type="button"
                  onClick={() => handlePick(color.name)}
                  disabled={busy}
                  aria-label={color.name}
                  className={`group flex cursor-pointer flex-col items-center gap-2 transition-opacity disabled:cursor-wait ${
                    isFull ? "opacity-40" : ""
                  }`}
                >
                  <span
                    className="flex h-14 w-14 items-center justify-center rounded-full border border-white/20 transition group-hover:scale-105 group-active:scale-95"
                    style={{ backgroundColor: color.hex }}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/35">
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    </span>
                  </span>

                  <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">
                    {color.name}
                  </span>
                </button>
              ))}
            </div>

            {isFull && isSetup && (
              <p className="mx-auto mt-8 max-w-xs text-xs leading-relaxed text-white/50">
                Screenshot your colors now, then press Enter.
              </p>
            )}

            <button
              type="button"
              onClick={handleEnter}
              disabled={busy || !isFull}
              className={`${isFull && isSetup ? "mt-4" : "mt-10"} w-full cursor-pointer rounded-xl bg-white px-4 py-3 text-black transition hover:bg-white/90 disabled:cursor-default disabled:opacity-30`}
            >
              Enter
            </button>

            <div className="mt-3 flex justify-center gap-3">
              <button
                type="button"
                onClick={resetAttempt}
                disabled={busy || picked.length === 0}
                className="cursor-pointer rounded-xl border border-white/15 px-4 py-2 text-xs text-white/60 transition hover:border-white/40 hover:text-white disabled:cursor-default disabled:opacity-30"
              >
                Clear
              </button>

              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="cursor-pointer rounded-xl border border-white/15 px-4 py-2 text-xs text-white/60 transition hover:border-white/40 hover:text-white disabled:opacity-30"
              >
                Back
              </button>
            </div>
          </>
        )}

        {phase === "retry" && (
          <>
            <h2 className="font-serif text-3xl font-light tracking-[-0.03em]">
              Try again
            </h2>

            <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-white/50">
              That wasn't your color combo. You have {failsLeft} of{" "}
              {COLOR_MAX_FAILS} tries left before this group is locked for 24
              hours.
            </p>

            <button
              type="button"
              onClick={resetAttempt}
              className="mt-8 w-full cursor-pointer rounded-xl bg-white px-4 py-3 text-black transition hover:bg-white/90"
            >
              Try again
            </button>

            <button
              type="button"
              onClick={onCancel}
              className="mt-3 w-full cursor-pointer rounded-xl border border-white/15 px-4 py-3 text-sm text-white/60 transition hover:border-white/40 hover:text-white"
            >
              Back
            </button>
          </>
        )}

        {phase === "locked" && (
          <>
            <h2 className="font-serif text-3xl font-light tracking-[-0.03em]">
              Locked for a day
            </h2>

            <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-white/50">
              Too many wrong color combos.{" "}
              {lockedUntil
                ? `You can try again after ${formatUnlockTime(lockedUntil)}.`
                : "Please try again later."}
            </p>

            <button
              type="button"
              onClick={onCancel}
              className="mt-8 w-full cursor-pointer rounded-xl border border-white/15 px-4 py-3 text-sm text-white/60 transition hover:border-white/40 hover:text-white"
            >
              Back
            </button>
          </>
        )}

        {phase === "error" && (
          <>
            <h2 className="font-serif text-3xl font-light tracking-[-0.03em]">
              Couldn't reach the server
            </h2>

            <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-white/50">
              Your color lock is kept online so it works on every device, so
              this needs an internet connection. Check your connection, then
              try again.
            </p>

            <button
              type="button"
              onClick={errorKind === "load" ? reloadStatus : resetAttempt}
              className="mt-8 w-full cursor-pointer rounded-xl bg-white px-4 py-3 text-black transition hover:bg-white/90"
            >
              Try again
            </button>

            <button
              type="button"
              onClick={onCancel}
              className="mt-3 w-full cursor-pointer rounded-xl border border-white/15 px-4 py-3 text-sm text-white/60 transition hover:border-white/40 hover:text-white"
            >
              Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
