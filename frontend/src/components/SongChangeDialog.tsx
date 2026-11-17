import { useEffect, useState } from "react";

type SongChangeDialogProps = {
  keyframeCount: number;
  // Swap the song and leave every keyframe exactly as it is.
  onKeep: () => void;
  // Swap the song and clear this round's keyframes (needs a second press).
  onReset: () => void;
  onCancel: () => void;
};

// Asked before a round's song is swapped while that round already has
// keyframes. Same look as ConfirmDialog. Keeping the keyframes is the first,
// focused choice; resetting them needs a second, explicit press, and
// cancelling changes nothing at all.
function SongChangeDialog({
  keyframeCount,
  onKeep,
  onReset,
  onCancel,
}: SongChangeDialogProps) {
  const [confirmReset, setConfirmReset] = useState(false);
  const plural = keyframeCount === 1 ? "" : "s";

  // Escape closes it, like clicking Cancel.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        // Clicking the dark area outside the box cancels.
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="song-change-title"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl bg-surface p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="song-change-title" className="font-semibold tracking-tight text-3xl">
            Change Song?
          </h2>

          <button
            onClick={onCancel}
            aria-label="Close"
            className="cursor-pointer text-fg-muted hover:text-fg"
          >
            ✕
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-3 text-sm leading-relaxed text-fg-soft">
          <p>
            You already have {keyframeCount} keyframe{plural} saved for this round. What
            would you like to do with {keyframeCount === 1 ? "it" : "them"}?
          </p>
          <p className="text-fg-muted">
            If the new song is shorter, keyframes after its end are kept, but the Preview
            can't reach them.
          </p>
          {confirmReset && (
            <p className="text-holly-soft">
              This clears the {keyframeCount} keyframe{plural} of this round only, once the
              new song has been analyzed. Other rounds are not affected.
            </p>
          )}
        </div>

        <div className="mt-8 flex flex-col gap-3">
          <button
            autoFocus
            onClick={onKeep}
            className="cursor-pointer rounded-lg bg-fg px-4 py-3 text-canvas transition hover:bg-fg/90"
          >
            Keep keyframes
          </button>

          <button
            onClick={() => (confirmReset ? onReset() : setConfirmReset(true))}
            className="cursor-pointer rounded-lg border border-holly/50 px-4 py-3 text-holly-soft transition hover:bg-holly/10"
          >
            {confirmReset
              ? `Yes, reset ${keyframeCount} keyframe${plural}`
              : "Reset keyframes"}
          </button>

          <button
            onClick={onCancel}
            className="cursor-pointer rounded-full px-4 py-3 text-fg-soft transition hover:text-fg bg-elevated hover:bg-line-strong"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default SongChangeDialog;
