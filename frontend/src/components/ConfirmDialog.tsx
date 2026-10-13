import { useEffect, useState, type ReactNode } from "react";

type ConfirmDialogProps = {
  title: string;
  // The explanation, usually a few <p> tags.
  children: ReactNode;
  // Text next to the checkbox. Continue stays locked until it is ticked.
  checkboxLabel: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

// An in-page popup for actions that throw work away. It replaces the
// browser's own confirm box: the person has to tick the checkbox before
// Continue works, so it can't be dismissed by accident. Same look as the
// "New ..." popup. Render it only while it should be open; it starts
// unticked every time.
function ConfirmDialog({
  title,
  children,
  checkboxLabel,
  confirmLabel = "Continue",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [understood, setUnderstood] = useState(false);

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
        aria-labelledby="confirm-dialog-title"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#0b0b0b] p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="confirm-dialog-title" className="font-serif text-3xl">
            {title}
          </h2>

          <button
            onClick={onCancel}
            aria-label="Close"
            className="cursor-pointer text-white/40 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-3 text-sm leading-relaxed text-white/55">
          {children}
        </div>

        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70 transition hover:border-white/20">
          <input
            type="checkbox"
            autoFocus
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-white"
          />
          <span>{checkboxLabel}</span>
        </label>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 cursor-pointer rounded-lg border border-white/10 px-4 py-3 text-white/60 transition hover:border-white/25 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!understood}
            className="flex-1 cursor-pointer rounded-lg bg-white px-4 py-3 text-black transition hover:bg-white/90 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-white"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
