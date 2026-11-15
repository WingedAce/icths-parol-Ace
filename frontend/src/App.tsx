import { useState } from "react";
import { useNavigate } from "react-router";

import ColorLockGate from "./components/ColorLockGate";
import { useProjects } from "./context/ProjectContext";
import FrozenTitle from "./components/FrozenTitle";
import WinterBackdrop from "./components/WinterBackdrop";
import SchoolCredit from "./components/SchoolCredit";
import logo from "./assets/logo.png";
import {
  BRAND_CATEGORY,
  BRAND_NAME,
  BRAND_SUBTAGLINE,
  BRAND_TAGLINE,
} from "./components/Brand";

function App() {
  const navigate = useNavigate();

  const { workspaces, addWorkspace, getChildren, addNode, syncStatus } =
    useProjects();

  // Wait until this device has loaded the groups that already exist online.
  // If it continued too early it would not see the group and would make a
  // brand-new copy of it, which would get a brand-new (different) color lock.
  const connecting = syncStatus === "loading" || syncStatus === "error";

  const [batch, setBatch] = useState("");
  const [section, setSection] = useState("");
  const [groupNumber, setGroupNumber] = useState("");
  const [lockedMessage, setLockedMessage] = useState("");
  // Set when a group is picked; the color lock for that group's URL must be
  // passed before navigating to it.
  const [pendingLock, setPendingLock] = useState<{
    groupId: string;
    path: string;
    label: string;
  } | null>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const batchName = batch.trim();
    const sectionName = section.trim();
    const groupNumberValue = groupNumber.trim();

    if (!batchName || !sectionName || !groupNumberValue || connecting) {
      return;
    }

    const groupLabel = `Group ${groupNumberValue}`;

    // Find or create the workspace for this batch. Keying the top level by
    // batch (not section) is what keeps different years from colliding: the
    // same "Section" + "Group Number" typed next year lands under a brand
    // new workspace instead of reusing last year's saved parol design.
    let workspace = workspaces.find(
      (item) =>
        item.type === "batch" &&
        item.name.toLowerCase() === batchName.toLowerCase(),
    );

    const workspaceId =
      workspace?.id ?? addWorkspace(batchName, "batch");

    // Find or create the hidden section-level node
    const sectionChildren = getChildren(workspaceId);

    let sectionNode = sectionChildren.find(
      (item) =>
        item.type === "section" &&
        item.name.toLowerCase() === sectionName.toLowerCase(),
    );

    const sectionNodeId =
      sectionNode?.id ??
      addNode(workspaceId, sectionName, "section");

    // Find or create the group node
    const groupChildren = getChildren(sectionNodeId);

    let groupNode = groupChildren.find(
      (item) =>
        item.type === "group" &&
        item.name.toLowerCase() === groupLabel.toLowerCase(),
    );

    // A group whose design was locked in the Developer Window can't be opened.
    if (groupNode?.locked) {
      setLockedMessage(
        `${groupLabel} (${sectionName}, Batch ${batchName}) is locked. Ask your teacher to unlock it.`,
      );
      return;
    }

    setLockedMessage("");

    const groupNodeId =
      groupNode?.id ??
      addNode(sectionNodeId, groupLabel, "group");

    // Every group URL has its own color combo: created the first time this
    // group is opened, asked for every time after.
    setPendingLock({
      groupId: groupNodeId,
      path: `/workspace/${workspaceId}/${sectionNodeId}/${groupNodeId}`,
      label: `${
        groupNode?.parolName?.trim()
          ? `${groupNode.parolName.trim()} (${groupLabel})`
          : groupLabel
      } · ${sectionName} · Batch ${batchName}`,
    });
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-6 py-16 text-fg">
      <WinterBackdrop paused={pendingLock !== null} />
      <div className="relative z-10 w-full max-w-md">
        <header className="mb-12 text-center">
          <img
            src={logo}
            alt="I-PAROL SYNAPSE logo"
            draggable={false}
            className="mx-auto mb-4 h-14 w-auto select-none"
          />

          <p className="text-sm text-fg-muted">{BRAND_CATEGORY}</p>
          <h1 className="mt-4 text-5xl font-semibold tracking-[-0.035em] sm:-mx-8 sm:text-6xl">
            <FrozenTitle text={BRAND_NAME} />
          </h1>
          <p className="mt-5 text-xl leading-snug text-fg-soft">
            {BRAND_TAGLINE}
          </p>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
            <div className="flex items-center gap-4 px-5 transition focus-within:bg-elevated">
              <label htmlFor="landing-batch" className="w-24 shrink-0 text-sm text-fg-muted">
                Batch
              </label>
              <input
                id="landing-batch"
                autoFocus
                value={batch}
                onChange={(event) => setBatch(event.target.value)}
                placeholder="e.g. 2026"
                className="h-14 min-w-0 flex-1 bg-transparent text-[17px] text-fg outline-none placeholder:text-fg-muted/50 focus-visible:outline-none"
              />
            </div>
            <div className="flex items-center gap-4 px-5 transition focus-within:bg-elevated">
              <label htmlFor="landing-section" className="w-24 shrink-0 text-sm text-fg-muted">
                Section
              </label>
              <input
                id="landing-section"
                value={section}
                onChange={(event) => setSection(event.target.value)}
                placeholder="Your section"
                className="h-14 min-w-0 flex-1 bg-transparent text-[17px] text-fg outline-none placeholder:text-fg-muted/50 focus-visible:outline-none"
              />
            </div>
            <div className="flex items-center gap-4 px-5 transition focus-within:bg-elevated">
              <label htmlFor="landing-group" className="w-24 shrink-0 text-sm text-fg-muted">
                Group
              </label>
              <input
                id="landing-group"
                value={groupNumber}
                onChange={(event) => setGroupNumber(event.target.value)}
                placeholder="Group number"
                className="h-14 min-w-0 flex-1 bg-transparent text-[17px] text-fg outline-none placeholder:text-fg-muted/50 focus-visible:outline-none"
              />
            </div>
          </div>

          {lockedMessage && (
            <p
              role="alert"
              className="rounded-2xl bg-holly/10 px-5 py-4 text-sm leading-relaxed text-holly-soft"
            >
              🔒 {lockedMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={connecting}
            className="mt-2 h-12 w-full rounded-full bg-fg px-6 text-[15px] font-medium text-canvas transition hover:bg-fg/90 disabled:opacity-40 disabled:hover:bg-fg"
          >
            {connecting ? "Connecting…" : "Continue"}
          </button>
        </form>

        {/* Easter egg: the sub-tagline quietly opens the Developer Window. */}
        <div className="mt-10 flex justify-center">
          <button
            type="button"
            onClick={() => navigate("/developer")}
            className="text-xs text-fg-muted/80 transition hover:text-fg-soft"
          >
            {BRAND_SUBTAGLINE}
          </button>
        </div>
      </div>

      <SchoolCredit />

      {pendingLock && (
        <ColorLockGate
          key={pendingLock.groupId}
          groupId={pendingLock.groupId}
          label={pendingLock.label}
          onSuccess={() => {
            const { path } = pendingLock;
            setPendingLock(null);
            navigate(path);
          }}
          onCancel={() => setPendingLock(null)}
        />
      )}
    </main>
  );
}

export default App;
