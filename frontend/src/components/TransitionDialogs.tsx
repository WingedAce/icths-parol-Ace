import { useEffect, useState, type ReactNode } from "react";

import type { SavedTransition } from "../types";

// Same shell as ConfirmDialog / SongChangeDialog.
function Shell({
  title,
  titleId,
  onCancel,
  children,
}: {
  title: string;
  titleId: string;
  onCancel: () => void;
  children: ReactNode;
}) {
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
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl bg-surface p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="font-semibold tracking-tight text-3xl">
            {title}
          </h2>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="cursor-pointer text-fg-muted hover:text-fg"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function formatLength(seconds: number) {
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

export function transitionLength(t: SavedTransition) {
  return t.frames.length > 0 ? t.frames[t.frames.length - 1].time : 0;
}

// "Label as Transition": any name the user likes.
export function LabelTransitionDialog({
  count,
  existingNames,
  onSave,
  onCancel,
}: {
  count: number;
  existingNames: string[];
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const clean = name.trim();
  const taken = existingNames.some((n) => n.toLowerCase() === clean.toLowerCase());

  return (
    <Shell title="Label as Transition" titleId="label-transition-title" onCancel={onCancel}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (clean) onSave(clean);
        }}
      >
        <p className="mt-6 text-sm leading-relaxed text-fg-soft">
          Save the {count} selected keyframe{count === 1 ? "" : "s"} as one
          reusable transition. Your keyframes on this timeline stay as they are.
        </p>
        <input
          autoFocus
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name, e.g. Star Burst"
          aria-label="Transition name"
          className="mt-4 w-full rounded-lg bg-elevated px-4 py-3 text-sm text-fg outline-none ring-1 ring-line focus:ring-line-hover"
        />
        {taken && (
          <p className="mt-2 text-xs text-fg-muted">
            A transition with this name already exists. This one is saved as a
            separate transition and the old one is not changed.
          </p>
        )}
        <div className="mt-8 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 cursor-pointer rounded-full bg-elevated px-4 py-3 text-fg-soft transition hover:bg-line-strong hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!clean}
            className="flex-1 cursor-pointer rounded-lg bg-fg px-4 py-3 text-canvas transition hover:bg-fg/90 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-fg"
          >
            Save
          </button>
        </div>
      </form>
    </Shell>
  );
}

// "Import keyframes": pick a saved transition, then Import. Importing never
// uses the transition up, it stays in the library.
export function ImportTransitionDialog({
  library,
  onImport,
  onCancel,
}: {
  library: SavedTransition[];
  onImport: (transition: SavedTransition) => void;
  onCancel: () => void;
}) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = library.find((t) => t.id === pickedId);

  return (
    <Shell title="Import keyframes" titleId="import-transition-title" onCancel={onCancel}>
      {library.length === 0 ? (
        <p className="mt-6 text-sm leading-relaxed text-fg-soft">
          No saved transitions yet. In the Practice tab, select keyframes and
          press “Label as Transition”, then they show up here.
        </p>
      ) : (
        <>
          <p className="mt-6 text-sm leading-relaxed text-fg-soft">
            The keyframes are added at the playhead and keep their gaps. Nothing
            already on the timeline is replaced.
          </p>
          <div role="radiogroup" aria-label="Saved transitions" className="mt-4 flex max-h-72 flex-col gap-2 overflow-y-auto">
            {library.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={pickedId === t.id}
                onClick={() => setPickedId(t.id)}
                className={`cursor-pointer rounded-lg px-4 py-3 text-left transition ring-1 ${
                  pickedId === t.id
                    ? "bg-elevated ring-line-hover"
                    : "ring-line hover:bg-elevated"
                }`}
              >
                <span className="block text-sm text-fg">{t.name}</span>
                <span className="mt-0.5 block text-xs text-fg-muted">
                  {t.frames.length} keyframe{t.frames.length === 1 ? "" : "s"} ·{" "}
                  {formatLength(transitionLength(t))}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="mt-8 flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 cursor-pointer rounded-full bg-elevated px-4 py-3 text-fg-soft transition hover:bg-line-strong hover:text-fg"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!picked}
          onClick={() => picked && onImport(picked)}
          className="flex-1 cursor-pointer rounded-lg bg-fg px-4 py-3 text-canvas transition hover:bg-fg/90 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-fg"
        >
          Import
        </button>
      </div>
    </Shell>
  );
}
