import { useState } from "react";
import { useNavigate } from "react-router";

import ConfirmDialog from "../components/ConfirmDialog";
import ParolPreview from "../components/ParolPreview";
import { useProjects } from "../context/ProjectContext";
import type { ProjectNode } from "../types";

// One registered design = one group that has a drawing (or detected zones).
type Design = {
  node: ProjectNode;
  // "Batch '26 · Section A"
  where: string;
};

type PendingDelete = { kind: "all" } | { kind: "selected" } | null;

// "delete" = picking designs to delete, "lock" = picking designs to lock or
// unlock. null = not picking anything.
type Mode = "delete" | "lock" | null;

const hasDesign = (node: ProjectNode) =>
  !!node.imageDataUrl || (node.zones?.length ?? 0) > 0;

// The scanned drawing with its saved colors. Every pin is shown as "on", so
// each zone glows in the color that was set for its pin.
function DesignThumbnail({ node }: { node: ProjectNode }) {
  const aspect = `${node.imageWidth ?? 1} / ${node.imageHeight ?? 1}`;
  const mappings = node.pinMappings ?? [];
  const canColor =
    !!node.imageDataUrl && (node.zones?.length ?? 0) > 0 && mappings.length > 0;

  return (
    <div className="flex h-56 items-center justify-center overflow-hidden rounded-xl bg-[#0b0b0b] p-2">
      {canColor ? (
        <div
          className="h-full max-w-full"
          style={{ aspectRatio: aspect }}
        >
          <ParolPreview
            node={node}
            litPins={Array.from(new Set(mappings.map((m) => m.pin)))}
          />
        </div>
      ) : node.imageDataUrl ? (
        <div className="relative h-full max-w-full" style={{ aspectRatio: aspect }}>
          <img
            src={node.imageDataUrl}
            alt="Parol drawing"
            className="h-full w-full object-fill"
            style={{ filter: "invert(1) brightness(0.45)" }}
          />
          <p className="absolute inset-x-0 bottom-1 text-center text-[10px] uppercase tracking-wider text-white/50">
            No pins assigned yet
          </p>
        </div>
      ) : (
        <p className="text-xs text-white/30">Drawing not loaded</p>
      )}
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function DeveloperPage() {
  const navigate = useNavigate();
  const { workspaces, getChildren, deleteNode, setNodesLocked } =
    useProjects();

  // TODO(Supabase): this page must only open for the signed-in admins (the
  // teacher and Sir Gerald). Until the login exists it is open to anyone who
  // clicks the button, so do not put the site online before that is added.

  const [mode, setMode] = useState<Mode>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingDelete>(null);

  // Walk batch -> section -> group and collect every group with a design.
  const designs: Design[] = [];
  function collect(parentId: string, trail: string[]) {
    for (const child of getChildren(parentId)) {
      if (child.type === "group") {
        if (hasDesign(child)) {
          designs.push({ node: child, where: trail.join(" · ") });
        }
      } else if (child.type !== "animation") {
        collect(child.id, [...trail, child.name]);
      }
    }
  }
  for (const workspace of workspaces) {
    collect(workspace.id, [workspace.name]);
  }

  // Locked designs are protected: Delete all and Select to delete skip them
  // until they are unlocked.
  const isLocked = (d: Design) => !!d.node.locked;
  const unlockedDesigns = designs.filter((d) => !isLocked(d));
  const lockedCount = designs.length - unlockedDesigns.length;

  const designIds = new Set(designs.map((d) => d.node.id));
  const chosen = designs.filter(
    (d) => selected.has(d.node.id) && (mode !== "delete" || !isLocked(d)),
  );
  const chosenToLock = chosen.filter((d) => !isLocked(d));
  const chosenToUnlock = chosen.filter(isLocked);

  const selecting = mode !== null;

  function toggle(design: Design) {
    // A locked design can't be picked for deleting.
    if (mode === "delete" && isLocked(design)) return;
    const id = design.node.id;
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function stopSelecting() {
    setMode(null);
    setSelected(new Set());
  }

  function startMode(next: Exclude<Mode, null>) {
    setSelected(new Set());
    setMode(next);
  }

  function applyLock(list: Design[], locked: boolean) {
    setNodesLocked(
      list.map((d) => d.node.id),
      locked,
    );
    stopSelecting();
  }

  // Deleting a group removes its drawing, zones, pins and the song and
  // keyframes of every round.
  function deleteDesigns(list: Design[]) {
    for (const design of list) deleteNode(design.node.id);
    stopSelecting();
  }

  const nameOf = (d: Design) => `${d.node.name} (${d.where})`;

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <div className="mx-auto max-w-5xl px-6 pb-4 pt-10">
        <button
          onClick={() => navigate("/")}
          className="mb-8 cursor-pointer text-xs uppercase tracking-[0.3em] text-white/40 transition hover:text-white"
        >
          ← Back
        </button>

        <p className="mb-3 text-[10px] uppercase tracking-[0.45em] text-white/30">
          Lighting Design System
        </p>
        <h1 className="font-serif text-4xl font-light tracking-[-0.03em] sm:text-5xl">
          Developer Window
        </h1>

        <p className="mt-6 max-w-xl rounded-xl border border-amber-200/20 bg-amber-200/[0.04] px-4 py-3 text-xs leading-relaxed text-amber-100/70">
          Testing mode: the login is not connected yet, and this window only
          shows the designs saved in this browser.
        </p>

        <p className="mb-8 mt-10 font-serif text-xl text-white/90 sm:text-2xl">
          Current designs registered :{" "}
          <span className="font-bold text-white">{designs.length}</span>
        </p>

        {designs.length === 0 ? (
          <p className="py-24 text-center text-sm text-white/30">
            No designs registered yet.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3">
            {designs.map((design) => {
              const locked = isLocked(design);
              // In delete mode a locked design can't be picked.
              const pickable = selecting && !(mode === "delete" && locked);
              const isSelected = pickable && selected.has(design.node.id);
              return (
                <li key={design.node.id}>
                  <div
                    role={pickable ? "button" : undefined}
                    tabIndex={pickable ? 0 : undefined}
                    aria-pressed={pickable ? isSelected : undefined}
                    onClick={pickable ? () => toggle(design) : undefined}
                    onKeyDown={
                      pickable
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggle(design);
                            }
                          }
                        : undefined
                    }
                    className={`relative rounded-2xl border p-2 transition ${
                      pickable ? "cursor-pointer" : ""
                    } ${
                      // Locked designs always have red edges.
                      locked
                        ? `border-2 border-[#ff3b41] shadow-[0_0_18px_rgba(255,59,65,0.35)] ${
                            isSelected ? "bg-white/[0.08] ring-2 ring-white/70" : ""
                          } ${selecting && !pickable ? "opacity-50" : ""}`
                        : isSelected
                          ? mode === "lock"
                            ? "border-white bg-white/[0.08] ring-2 ring-white/50"
                            : "border-[#ff5a5f] bg-[#ff5a5f]/10 ring-2 ring-[#ff5a5f]/40"
                          : selecting
                            ? "border-white/15 hover:border-white/40"
                            : "border-white/10"
                    }`}
                  >
                    {locked && (
                      <span className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-full bg-[#ff3b41] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                        <LockIcon /> Locked
                      </span>
                    )}

                    {pickable && (
                      <span
                        aria-hidden="true"
                        className={`absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold ${
                          isSelected
                            ? mode === "lock"
                              ? "border-white bg-white text-black"
                              : "border-[#ff5a5f] bg-[#ff5a5f] text-white"
                            : "border-white/40 bg-black/60 text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                    )}

                    <DesignThumbnail node={design.node} />

                    <div className="px-1 pb-1 pt-3 text-center">
                      <p className="font-serif text-base text-white/90">
                        {design.node.name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-white/35">
                        {design.where}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Stays at the bottom of the screen, like the buttons in the layout */}
      <div className="sticky bottom-0 mt-8 border-t border-white/10 bg-[#050505]/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-center gap-3 sm:gap-6">
          {mode === "delete" ? (
            <>
              <button
                onClick={stopSelecting}
                className="cursor-pointer rounded-full border border-white/20 px-6 py-3 font-serif text-base text-white/80 transition hover:border-white/50 hover:text-white sm:px-8"
              >
                Cancel
              </button>
              <button
                onClick={() => setPending({ kind: "selected" })}
                disabled={chosen.length === 0}
                className="cursor-pointer rounded-full bg-[#ff5a5f] px-6 py-3 font-serif text-base font-semibold text-white transition hover:bg-[#f0484d] disabled:cursor-default disabled:opacity-30 disabled:hover:bg-[#ff5a5f] sm:px-8"
              >
                Delete selected ({chosen.length})
              </button>
            </>
          ) : mode === "lock" ? (
            <>
              <button
                onClick={stopSelecting}
                className="cursor-pointer rounded-full border border-white/20 px-5 py-3 font-serif text-base text-white/80 transition hover:border-white/50 hover:text-white sm:px-8"
              >
                Cancel
              </button>
              <button
                onClick={() => applyLock(chosenToUnlock, false)}
                disabled={chosenToUnlock.length === 0}
                className="cursor-pointer rounded-full border border-white/25 px-5 py-3 font-serif text-base font-semibold text-white transition hover:border-white/60 hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent sm:px-8"
              >
                Unlock ({chosenToUnlock.length})
              </button>
              <button
                onClick={() => applyLock(chosenToLock, true)}
                disabled={chosenToLock.length === 0}
                className="cursor-pointer rounded-full bg-[#ff3b41] px-5 py-3 font-serif text-base font-semibold text-white transition hover:bg-[#e8282e] disabled:cursor-default disabled:opacity-30 disabled:hover:bg-[#ff3b41] sm:px-8"
              >
                Lock ({chosenToLock.length})
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => startMode("lock")}
                disabled={designs.length === 0}
                className="flex cursor-pointer items-center gap-2 rounded-full border border-white/25 px-6 py-3 font-serif text-base font-semibold text-white transition hover:border-white/60 hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-30 sm:px-8"
              >
                <LockIcon /> Lock Design
              </button>
              <button
                onClick={() => setPending({ kind: "all" })}
                disabled={unlockedDesigns.length === 0}
                className="cursor-pointer rounded-full border border-[#ff5a5f]/50 px-6 py-3 font-serif text-base font-semibold text-[#ff8a8e] transition hover:bg-[#ff5a5f]/10 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent sm:px-8"
              >
                Delete all
              </button>
              <button
                onClick={() => startMode("delete")}
                disabled={unlockedDesigns.length === 0}
                className="cursor-pointer rounded-full border border-white/25 px-6 py-3 font-serif text-base font-semibold text-white transition hover:border-white/60 hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-30 sm:px-8"
              >
                Select to delete
              </button>
            </>
          )}
        </div>
        {mode === "delete" && (
          <p className="mt-3 text-center text-[11px] text-white/35">
            Tap the designs you want to delete. Locked designs can't be
            deleted until you unlock them.
          </p>
        )}
        {mode === "lock" && (
          <p className="mt-3 text-center text-[11px] text-white/35">
            Tap the designs you want to lock, then press Lock. To unlock, tap the locked designs and press Unlock.
          </p>
        )}
      </div>

      {pending?.kind === "all" && (
        <ConfirmDialog
          title="Delete all designs?"
          checkboxLabel="I understand this cannot be undone"
          confirmLabel="Delete all"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            deleteDesigns(unlockedDesigns);
          }}
        >
          <p>
            This permanently deletes all {unlockedDesigns.length} unlocked{" "}
            {unlockedDesigns.length === 1 ? "design" : "designs"}.
          </p>
          {lockedCount > 0 && (
            <p className="text-[#ff8a8e]">
              {lockedCount} locked {lockedCount === 1 ? "design is" : "designs are"}{" "}
              kept. Unlock {lockedCount === 1 ? "it" : "them"} first to delete{" "}
              {lockedCount === 1 ? "it" : "them"}.
            </p>
          )}
          <p>
            For each group, the drawing, zones, pin assignments, colors and the
            song and keyframes of all three rounds are removed.
          </p>
        </ConfirmDialog>
      )}

      {pending?.kind === "selected" && chosen.length > 0 && (
        <ConfirmDialog
          title={`Delete ${chosen.length} ${chosen.length === 1 ? "design" : "designs"}?`}
          checkboxLabel="I understand this cannot be undone"
          confirmLabel="Delete"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            // Only delete what is still registered (nothing changed meanwhile).
            deleteDesigns(
              chosen.filter((d) => designIds.has(d.node.id) && !isLocked(d)),
            );
          }}
        >
          <ul className="list-inside list-disc">
            {chosen.map((d) => (
              <li key={d.node.id}>{nameOf(d)}</li>
            ))}
          </ul>
          <p>
            For each one, the drawing, zones, pin assignments, colors and the
            song and keyframes of all three rounds are removed.
          </p>
        </ConfirmDialog>
      )}
    </main>
  );
}

export default DeveloperPage;
