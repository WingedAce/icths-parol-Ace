import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import AdminReauthDialog from "../components/AdminReauthDialog";
import ConfirmDialog from "../components/ConfirmDialog";
import ParolPreview from "../components/ParolPreview";
import RenameParolDialog from "../components/RenameParolDialog";
import { useProjects } from "../context/ProjectContext";
import Brand from "../components/Brand";
import SpecialRoundAdmin from "../components/SpecialRoundAdmin";
import WinterBackdrop from "../components/WinterBackdrop";
import type { ProjectNode } from "../types";
import { grantSessionPass } from "../utils/accessLock";
import { displayName } from "../utils/parolName";
import {
  listColorLockedGroups,
  resetColorLocks as resetColorLocksOnServer,
} from "../lib/colorLock";

// One registered design = one group that has a drawing (or detected zones).
type Design = {
  node: ProjectNode;
  // "Batch '26 · Section A"
  where: string;
  // The group's page: /workspace/<workspace>/<section>/<group>
  url: string;
};

type PendingDelete =
  | { kind: "all" }
  | { kind: "selected" }
  | { kind: "reset" }
  | null;

// "delete" = picking designs to delete, "lock" = picking designs to lock or
// unlock, "reset" = picking designs whose color combo lock should be cleared.
// null = not picking anything.
type Mode = "delete" | "lock" | "reset" | null;

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
    <div className="dev-thumb flex h-56 items-center justify-center overflow-hidden rounded-xl bg-surface p-2">
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
          <p className="absolute inset-x-0 bottom-1 text-center text-xs text-fg-muted">
            No pins assigned yet
          </p>
        </div>
      ) : (
        <p className="text-xs text-fg-muted">Drawing not loaded</p>
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

// The name shown for a parol: the custom one if an admin gave it, otherwise
// the group's own name ("Group 3").
const parolLabel = displayName;

function DeveloperPage() {
  const navigate = useNavigate();
  const {
    workspaces,
    getChildren,
    deleteNodes,
    undoDelete,
    lastDeletion,
    deletionCount,
    setNodesLocked,
    setNodeParolName,
  } = useProjects();

  // Access: this page is wrapped in <AdminGate> (see router.tsx), so it only
  // opens for signed-in admins listed in the Supabase "admins" table.

  const [mode, setMode] = useState<Mode>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingDelete>(null);
  // The design the admin clicked to open (waiting for email + password), and
  // the design being renamed.
  const [opening, setOpening] = useState<Design | null>(null);
  const [renaming, setRenaming] = useState<Design | null>(null);

  // Ids of groups that have a color lock. It is kept online, so we ask the
  // server (instead of this browser) which groups have one.
  const [lockedGroupIds, setLockedGroupIds] = useState<Set<string>>(new Set());
  const [resetError, setResetError] = useState("");
  // Undo for deletes: busy while it runs, and a short result message.
  const [undoing, setUndoing] = useState(false);
  const [undoNote, setUndoNote] = useState("");

  async function refreshColorLocks() {
    try {
      setLockedGroupIds(await listColorLockedGroups());
    } catch (error) {
      console.error("Could not load color locks:", error);
    }
  }

  useEffect(() => {
    let cancelled = false;
    listColorLockedGroups()
      .then((ids) => {
        if (!cancelled) setLockedGroupIds(ids);
      })
      .catch((error) => console.error("Could not load color locks:", error));
    return () => {
      cancelled = true;
    };
  }, []);

  const hasColorLockData = (groupId: string) => lockedGroupIds.has(groupId);

  // Walk batch -> section -> group and collect every group with a design.
  const designs: Design[] = [];
  function collect(parentId: string, trail: string[], ids: string[]) {
    for (const child of getChildren(parentId)) {
      if (child.type === "group") {
        if (hasDesign(child)) {
          designs.push({
            node: child,
            where: trail.join(" · "),
            url: `/workspace/${ids.join("/")}/${child.id}`,
          });
        }
      } else if (child.type !== "animation") {
        collect(child.id, [...trail, child.name], [...ids, child.id]);
      }
    }
  }
  for (const workspace of workspaces) {
    collect(workspace.id, [workspace.name], [workspace.id]);
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
  // Only groups that already have a color combo (or a wrong-guess record) have
  // something to reset.
  const resettable = designs.filter((d) => hasColorLockData(d.node.id));
  const chosenToReset = chosen.filter((d) => hasColorLockData(d.node.id));

  const selecting = mode !== null;

  function toggle(design: Design) {
    // A locked design can't be picked for deleting.
    if (mode === "delete" && isLocked(design)) return;
    // Nothing to reset for a group that has no color combo yet.
    if (mode === "reset" && !hasColorLockData(design.node.id)) return;
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

  // Clears each group's color combo + lockout. The designs are kept; the group
  // simply creates a new combo the next time it's opened.
  async function resetColorLocks(list: Design[]) {
    setResetError("");
    try {
      await resetColorLocksOnServer(list.map((d) => d.node.id));
      stopSelecting();
    } catch (error) {
      console.error("Could not reset color locks:", error);
      setResetError("Couldn't reset the color lock. Check your connection and try again.");
    }
    await refreshColorLocks();
  }

  // Deleting a group removes its drawing, zones, pins and the song and
  // keyframes of every round.
  function deleteDesigns(list: Design[]) {
    setUndoNote("");
    // One step, so a single Undo brings every one of them back.
    deleteNodes(list.map((design) => design.node.id));
    stopSelecting();
  }

  // Brings back the most recent deletion, drawings included.
  async function handleUndo() {
    setUndoing(true);
    setUndoNote("");
    const result = await undoDelete();
    setUndoing(false);
    if (result.ok) {
      setUndoNote(`Restored ${result.label}.`);
    } else if (result.reason === "images") {
      setUndoNote(
        "Couldn't put the drawings back. Check your connection and try Undo again.",
      );
    }
  }

  const nameOf = (d: Design) => `${parolLabel(d.node)} (${d.where})`;

  return (
    <main className="dev-window winter-app isolate min-h-screen bg-canvas text-fg">
      <WinterBackdrop variant="quiet" />
      <div className="mx-auto max-w-5xl px-6 pb-4 pt-10">
        <button
          onClick={() => navigate("/")}
          className="dev-back mb-8 cursor-pointer text-xs text-fg-muted transition hover:text-fg"
        >
          ← Back
        </button>

        <Brand className="dev-brand mb-4" />
        <h1 className="dev-title font-semibold tracking-tight text-4xl tracking-[-0.03em] sm:text-5xl">
          Developer Window
        </h1>

        <SpecialRoundAdmin />

        <p className="dev-count mb-8 mt-8 font-medium text-xl text-fg sm:text-2xl">
          Current designs registered :{" "}
          <span className="dev-count-num font-bold text-fg">{designs.length}</span>
        </p>

        {designs.length > 0 && !selecting && (
          <p className="dev-hint -mt-4 mb-6 text-xs text-fg-muted">
            Click a design to open it. You will be asked for your Developer
            Window email and password first.
          </p>
        )}

        {designs.length === 0 ? (
          <p className="py-24 text-center text-sm text-fg-muted">
            No designs registered yet.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3">
            {designs.map((design) => {
              const locked = isLocked(design);
              // In delete mode a locked design can't be picked.
              const pickable =
                selecting &&
                !(mode === "delete" && locked) &&
                !(mode === "reset" && !hasColorLockData(design.node.id));
              const isSelected = pickable && selected.has(design.node.id);
              return (
                <li key={design.node.id}>
                  <div
                    role={pickable || !selecting ? "button" : undefined}
                    tabIndex={pickable || !selecting ? 0 : undefined}
                    aria-pressed={pickable ? isSelected : undefined}
                    aria-label={
                      !selecting
                        ? `Open ${parolLabel(design.node)} (password required)`
                        : undefined
                    }
                    onClick={
                      pickable
                        ? () => toggle(design)
                        : !selecting
                          ? () => setOpening(design)
                          : undefined
                    }
                    onKeyDown={
                      pickable || !selecting
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              if (pickable) toggle(design);
                              else setOpening(design);
                            }
                          }
                        : undefined
                    }
                    className={`dev-card relative rounded-xl border p-2 transition ${
                      pickable || !selecting ? "cursor-pointer" : ""
                    } ${
                      !selecting && !locked ? "bg-elevated" : ""
                    } ${
                      selecting && !pickable && !locked ? "opacity-50" : ""
                    } ${
                      // Locked designs always have red edges.
                      locked
                        ? `border border-holly ${
                            isSelected ? "bg-elevated ring-2 ring-line-hover" : ""
                          } ${selecting && !pickable ? "opacity-50" : ""}`
                        : isSelected
                          ? mode !== "delete"
                            ? "border-fg bg-elevated ring-2 ring-line-hover"
                            : "border-holly bg-holly/10 ring-2 ring-holly/40"
                          : selecting
                            ? "border-line-strong hover:border-line-hover"
                            : "border-line"
                    }`}
                  >
                    {locked && (
                      <span className="dev-lock-badge absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg bg-holly px-2.5 py-1 text-xs font-bold text-fg">
                        <LockIcon /> Locked
                      </span>
                    )}

                    {pickable && (
                      <span
                        aria-hidden="true"
                        className={`dev-check absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold ${
                          isSelected
                            ? mode !== "delete"
                              ? "border-fg bg-fg text-canvas"
                              : "border-holly bg-holly text-fg"
                            : "bg-black/60 text-transparent bg-line-strong"
                        }`}
                      >
                        ✓
                      </span>
                    )}

                    <DesignThumbnail node={design.node} />

                    <div className="px-1 pb-1 pt-3 text-center">
                      <p className="dev-card-title font-medium text-base text-fg">
                        {parolLabel(design.node)}
                      </p>
                      <p className="dev-card-sub mt-0.5 text-xs text-fg-muted">
                        {design.node.parolName?.trim()
                          ? `${design.node.name} · ${design.where}`
                          : design.where}
                      </p>
                      {!selecting && (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            setRenaming(design);
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                          className="mt-2 cursor-pointer rounded-full px-3 py-1 text-xs text-fg-muted transition hover:text-fg bg-elevated hover:bg-line-strong dev-btn"
                        >
                          Rename
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Stays at the bottom of the screen, like the buttons in the layout */}
      <div className="dev-bar sticky bottom-0 mt-8 border-t border-line bg-[#050505]/90 px-6 py-4 ">
        {lastDeletion && (
          <div className="dev-note mx-auto mb-4 flex max-w-5xl flex-wrap items-center justify-center gap-3 rounded-xl border bg-elevated px-5 py-3 border-transparent">
            <p className="text-sm text-fg-soft">
              Deleted {lastDeletion.label}.
              {deletionCount > 1 &&
                ` ${deletionCount - 1} earlier ${
                  deletionCount - 1 === 1 ? "deletion" : "deletions"
                } can be undone after this.`}
            </p>
            <button
              onClick={() => void handleUndo()}
              disabled={undoing}
              className="dev-btn-gold cursor-pointer rounded-lg bg-fg px-5 py-2 font-medium text-sm font-semibold text-canvas transition hover:bg-fg/90 disabled:cursor-default disabled:opacity-40"
            >
              {undoing ? "Restoring…" : "Undo delete"}
            </button>
          </div>
        )}
        {undoNote && (
          <p
            role="status"
            className={`mx-auto mb-3 max-w-5xl text-center text-xs ${
              undoNote.startsWith("Restored")
                ? "text-fg-soft"
                : "text-holly-soft"
            }`}
          >
            {undoNote}
          </p>
        )}
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-3 sm:gap-6">
          {mode === "delete" ? (
            <>
              <button
                onClick={stopSelecting}
                className="cursor-pointer rounded-full px-6 py-3 font-medium text-base text-fg transition hover:text-fg sm:px-8 bg-elevated hover:bg-line-strong dev-btn"
              >
                Cancel
              </button>
              <button
                onClick={() => setPending({ kind: "selected" })}
                disabled={chosen.length === 0}
                className="dev-btn-cran cursor-pointer rounded-lg bg-holly px-6 py-3 font-medium text-base font-semibold text-fg transition hover:bg-holly/90 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-holly sm:px-8"
              >
                Delete selected ({chosen.length})
              </button>
            </>
          ) : mode === "reset" ? (
            <>
              <button
                onClick={stopSelecting}
                className="cursor-pointer rounded-full px-6 py-3 font-medium text-base text-fg transition hover:text-fg sm:px-8 bg-elevated hover:bg-line-strong dev-btn"
              >
                Cancel
              </button>
              <button
                onClick={() => setPending({ kind: "reset" })}
                disabled={chosenToReset.length === 0}
                className="dev-btn-gold cursor-pointer rounded-lg bg-fg px-6 py-3 font-medium text-base font-semibold text-canvas transition hover:bg-fg/90 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-fg sm:px-8"
              >
                Reset color lock ({chosenToReset.length})
              </button>
            </>
          ) : mode === "lock" ? (
            <>
              <button
                onClick={stopSelecting}
                className="cursor-pointer rounded-full px-5 py-3 font-medium text-base text-fg transition hover:text-fg sm:px-8 bg-elevated hover:bg-line-strong dev-btn"
              >
                Cancel
              </button>
              <button
                onClick={() => applyLock(chosenToUnlock, false)}
                disabled={chosenToUnlock.length === 0}
                className="cursor-pointer rounded-full px-5 py-3 font-medium text-base font-semibold text-fg transition hover:bg-elevated disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent sm:px-8 bg-elevated hover:bg-line-strong dev-btn"
              >
                Unlock ({chosenToUnlock.length})
              </button>
              <button
                onClick={() => applyLock(chosenToLock, true)}
                disabled={chosenToLock.length === 0}
                className="dev-btn-cran cursor-pointer rounded-lg bg-holly px-5 py-3 font-medium text-base font-semibold text-fg transition hover:bg-holly/90 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-holly sm:px-8"
              >
                Lock ({chosenToLock.length})
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => startMode("lock")}
                disabled={designs.length === 0}
                className="flex cursor-pointer items-center gap-2 rounded-full px-6 py-3 font-medium text-base font-semibold text-fg transition hover:bg-elevated disabled:cursor-default disabled:opacity-30 sm:px-8 bg-elevated hover:bg-line-strong dev-btn"
              >
                <LockIcon /> Lock Design
              </button>
              <button
                onClick={() => startMode("reset")}
                disabled={resettable.length === 0}
                className="cursor-pointer rounded-full px-6 py-3 font-medium text-base font-semibold text-fg transition hover:bg-elevated disabled:cursor-default disabled:opacity-30 sm:px-8 bg-elevated hover:bg-line-strong dev-btn"
              >
                Reset Color Lock
              </button>
              <button
                onClick={() => setPending({ kind: "all" })}
                disabled={unlockedDesigns.length === 0}
                className="dev-btn-cran-outline cursor-pointer rounded-lg border border-holly/50 px-6 py-3 font-medium text-base font-semibold text-holly-soft transition hover:bg-holly/10 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent sm:px-8"
              >
                Delete all
              </button>
              <button
                onClick={() => startMode("delete")}
                disabled={unlockedDesigns.length === 0}
                className="cursor-pointer rounded-full px-6 py-3 font-medium text-base font-semibold text-fg transition hover:bg-elevated disabled:cursor-default disabled:opacity-30 sm:px-8 bg-elevated hover:bg-line-strong dev-btn"
              >
                Select to delete
              </button>
            </>
          )}
        </div>
        {mode === "delete" && (
          <p className="dev-hint mt-3 text-center text-xs text-fg-muted">
            Tap the designs you want to delete. Locked designs can't be
            deleted until you unlock them.
          </p>
        )}
        {mode === "reset" && (
          <p className="dev-hint mt-3 text-center text-xs text-fg-muted">
            Tap the groups that forgot their color combo, then press Reset. Dimmed
            designs have no color lock yet. The design is kept; the group makes
            a new combo the next time it opens.
          </p>
        )}
        {resetError && (
          <p role="alert" className="mt-3 text-center text-xs text-holly-soft">
            {resetError}
          </p>
        )}
        {mode === "lock" && (
          <p className="dev-hint mt-3 text-center text-xs text-fg-muted">
            Tap the designs you want to lock, then press Lock. To unlock, tap the locked designs and press Unlock.
          </p>
        )}
      </div>

      {opening && (
        <AdminReauthDialog
          designLabel={nameOf(opening)}
          onCancel={() => setOpening(null)}
          onVerified={() => {
            // Admins skip the group's color lock, but only after this check.
            grantSessionPass(opening.node.id);
            navigate(opening.url);
          }}
        />
      )}

      {renaming && (
        <RenameParolDialog
          currentName={parolLabel(renaming.node)}
          originalName={renaming.node.name}
          onCancel={() => setRenaming(null)}
          onSave={(name) => {
            setNodeParolName(renaming.node.id, name);
            setRenaming(null);
          }}
        />
      )}

      {pending?.kind === "all" && (
        <ConfirmDialog
          title="Delete all designs?"
          checkboxLabel="I understand Undo only works until this page is reloaded"
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
            <p className="text-holly-soft">
              {lockedCount} locked {lockedCount === 1 ? "design is" : "designs are"}{" "}
              kept. Unlock {lockedCount === 1 ? "it" : "them"} first to delete{" "}
              {lockedCount === 1 ? "it" : "them"}.
            </p>
          )}
          <p>
            For each group, the drawing, zones, pin assignments, colors and the
            song and keyframes of all three rounds are removed.
          </p>
          <p>
            You can bring them back with Undo delete, but only until you
            reload or close this page.
          </p>
        </ConfirmDialog>
      )}

      {pending?.kind === "reset" && chosenToReset.length > 0 && (
        <ConfirmDialog
          title={`Reset ${chosenToReset.length} color ${chosenToReset.length === 1 ? "lock" : "locks"}?`}
          checkboxLabel="I understand the old color combo will stop working"
          confirmLabel="Reset"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            void resetColorLocks(chosenToReset);
          }}
        >
          <ul className="list-inside list-disc">
            {chosenToReset.map((d) => (
              <li key={d.node.id}>{nameOf(d)}</li>
            ))}
          </ul>
          <p>
            The old color combo and any wrong-guess lockout are cleared. The
            next time the group opens its design, it creates a new combo. The
            design itself is not changed.
          </p>
        </ConfirmDialog>
      )}

      {pending?.kind === "selected" && chosen.length > 0 && (
        <ConfirmDialog
          title={`Delete ${chosen.length} ${chosen.length === 1 ? "design" : "designs"}?`}
          checkboxLabel="I understand Undo only works until this page is reloaded"
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
          <p>
            You can bring them back with Undo delete, but only until you
            reload or close this page.
          </p>
        </ConfirmDialog>
      )}
    </main>
  );
}

export default DeveloperPage;
