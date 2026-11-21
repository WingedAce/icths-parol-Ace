import { memo, useState } from "react";

import LazyMount from "./LazyMount";
import ParolPreview from "./ParolPreview";
import { formatLength, transitionLength } from "./TransitionDialogs";
import type { ProjectNode, SavedTransition } from "../types";

// The Gallery's "Transitions" collection: one folder per saved transition,
// named by the user. Opening a folder shows its keyframes. A folder can be
// renamed or deleted here; importing a transition never removes it.
function TransitionFolders({
  groupNode,
  transitions,
  onChange,
}: {
  groupNode: ProjectNode;
  transitions: SavedTransition[];
  onChange?: (next: SavedTransition[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (transitions.length === 0) return null;

  return (
    <section aria-label="Saved transitions" className="flex flex-col gap-3">
      <p className="text-xs text-fg-muted">
        Transitions ({transitions.length}). Import them into the Special Round
        from its Preview tab.
      </p>
      {transitions.map((t) => {
        const open = openId === t.id;
        return (
          <div key={t.id} className="rounded-xl bg-surface p-4 ring-1 ring-line">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : t.id)}
                aria-expanded={open}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
              >
                <span aria-hidden="true" className="text-fg-muted">
                  {open ? "▾" : "▸"}
                </span>
                {renamingId === t.id ? null : (
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-fg">{t.name}</span>
                    <span className="block text-xs text-fg-muted">
                      {t.frames.length} keyframe{t.frames.length === 1 ? "" : "s"} ·{" "}
                      {formatLength(transitionLength(t))}
                    </span>
                  </span>
                )}
              </button>
              {renamingId === t.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const name = draft.trim();
                    if (name && onChange) {
                      onChange(transitions.map((x) => (x.id === t.id ? { ...x, name } : x)));
                    }
                    setRenamingId(null);
                  }}
                >
                  <input
                    autoFocus
                    value={draft}
                    maxLength={60}
                    onChange={(event) => setDraft(event.target.value)}
                    aria-label="Transition name"
                    className="min-w-0 flex-1 rounded-lg bg-elevated px-3 py-2 text-sm text-fg outline-none ring-1 ring-line focus:ring-line-hover"
                  />
                  <button type="submit" className="cursor-pointer rounded-full bg-elevated px-3 py-2 text-xs text-fg-soft hover:text-fg">
                    Save
                  </button>
                  <button type="button" onClick={() => setRenamingId(null)} className="cursor-pointer rounded-full bg-elevated px-3 py-2 text-xs text-fg-soft hover:text-fg">
                    Cancel
                  </button>
                </form>
              ) : (
                onChange && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(t.name);
                        setRenamingId(t.id);
                      }}
                      className="cursor-pointer rounded-full bg-elevated px-3 py-1.5 text-xs text-fg-soft transition hover:text-fg"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete the transition “${t.name}”? Keyframes on your timelines are not affected.`)) {
                          onChange(transitions.filter((x) => x.id !== t.id));
                        }
                      }}
                      className="cursor-pointer rounded-full bg-elevated px-3 py-1.5 text-xs text-fg-soft transition hover:text-fg"
                    >
                      Delete
                    </button>
                  </div>
                )
              )}
            </div>

            {open && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {t.frames.map((frame, index) => (
                  <div key={index} className="min-w-0">
                    <LazyMount>
                      <ParolPreview
                        node={groupNode}
                        litPins={frame.litPins}
                        levels={frame.levels}
                        tricolorColors={frame.tricolors}
                      />
                    </LazyMount>
                    <p className="mt-1 text-xs text-fg-muted">
                      {index + 1} · +{frame.time.toFixed(2)}s
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

export default memo(TransitionFolders);
