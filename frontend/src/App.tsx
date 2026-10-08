import { useState } from "react";
import { useNavigate } from "react-router";

import { useProjects } from "./context/ProjectContext";
import GmailVerification from "./components/GmailVerification";

function App() {
  const navigate = useNavigate();

  const { workspaces, addWorkspace, getChildren, addNode } =
    useProjects();

  const [batch, setBatch] = useState("");
  const [section, setSection] = useState("");
  const [groupNumber, setGroupNumber] = useState("");
  const [lockedMessage, setLockedMessage] = useState("");

  const [showGmailVerification, setShowGmailVerification] =
    useState(false);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const batchName = batch.trim();
    const sectionName = section.trim();
    const groupNumberValue = groupNumber.trim();

    if (!batchName || !sectionName || !groupNumberValue) {
      return;
    }

    const groupLabel = `Group ${groupNumberValue}`;

    let workspace = workspaces.find(
      (item) =>
        item.type === "batch" &&
        item.name.toLowerCase() === batchName.toLowerCase(),
    );

    const workspaceId =
      workspace?.id ?? addWorkspace(batchName, "batch");

    const sectionChildren = getChildren(workspaceId);

    let sectionNode = sectionChildren.find(
      (item) =>
        item.type === "section" &&
        item.name.toLowerCase() === sectionName.toLowerCase(),
    );

    const sectionNodeId =
      sectionNode?.id ??
      addNode(workspaceId, sectionName, "section");

    const groupChildren = getChildren(sectionNodeId);

    let groupNode = groupChildren.find(
      (item) =>
        item.type === "group" &&
        item.name.toLowerCase() === groupLabel.toLowerCase(),
    );

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

    // Store the destination temporarily, then verify Gmail.
    setShowGmailVerification(true);

    // Keep these IDs available for the verification callback.
    setPendingDestination({
      workspaceId,
      sectionNodeId,
      groupNodeId,
    });
  }

  const [pendingDestination, setPendingDestination] = useState<{
    workspaceId: string;
    sectionNodeId: string;
    groupNodeId: string;
  } | null>(null);

  function handleGmailVerified() {
    if (!pendingDestination) {
      return;
    }

    navigate(
      `/workspace/${pendingDestination.workspaceId}/${pendingDestination.sectionNodeId}/${pendingDestination.groupNodeId}`,
    );
  }

  if (showGmailVerification) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] px-6 text-white">
        <div className="w-full max-w-sm">

          <div className="mb-12 text-center">
            <p className="mb-5 text-[10px] uppercase tracking-[0.45em] text-white/30">
              Group Verification
            </p>

            <h1 className="font-serif text-5xl font-light tracking-[-0.04em]">
              Verify Gmail
            </h1>

            <p className="mt-4 text-sm leading-relaxed text-white/40">
              Verify your Gmail address before entering your group workspace.
            </p>
          </div>

          <GmailVerification
            onVerified={handleGmailVerified}
          />

          <button
            type="button"
            onClick={() => setShowGmailVerification(false)}
            className="mt-4 w-full cursor-pointer rounded-xl border border-white/15 px-4 py-3 text-sm text-white/60 transition hover:border-white/40 hover:text-white"
          >
            Back
          </button>

        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050505] px-6 text-white">
      <div className="w-full max-w-sm">

        <div className="mb-12 text-center">
          <p className="mb-5 text-[10px] uppercase tracking-[0.45em] text-white/30">
            Lighting Design System
          </p>

          <h1 className="font-serif text-5xl font-light tracking-[-0.04em]">
            Parol Editor
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
        >
          <div>
            <label className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-white/30">
              Batch
            </label>

            <input
              autoFocus
              value={batch}
              onChange={(event) =>
                setBatch(event.target.value)
              }
              placeholder="e.g. 2026"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white outline-none placeholder:text-white/20 focus:border-white/30"
            />
          </div>

          <div>
            <label className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-white/30">
              Section
            </label>

            <input
              value={section}
              onChange={(event) =>
                setSection(event.target.value)
              }
              placeholder="Enter your section"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white outline-none placeholder:text-white/20 focus:border-white/30"
            />
          </div>

          <div>
            <label className="mb-2 block text-[10px] uppercase tracking-[0.3em] text-white/30">
              Group Number
            </label>

            <input
              value={groupNumber}
              onChange={(event) =>
                setGroupNumber(event.target.value)
              }
              placeholder="Enter your group number"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white outline-none placeholder:text-white/20 focus:border-white/30"
            />
          </div>

          {lockedMessage && (
            <p
              role="alert"
              className="rounded-xl border border-[#ff3b41]/60 bg-[#ff3b41]/10 px-4 py-3 text-xs leading-relaxed text-[#ff8a8e]"
            >
              🔒 {lockedMessage}
            </p>
          )}

          <button
            type="submit"
            className="mt-4 w-full cursor-pointer rounded-xl bg-white px-4 py-3 text-black transition hover:bg-white/90"
          >
            Continue
          </button>
        </form>

        <button
          type="button"
          onClick={() => navigate("/developer")}
          className="mt-3 w-full cursor-pointer rounded-xl border border-white/15 px-4 py-3 text-sm text-white/60 transition hover:border-white/40 hover:text-white"
        >
          Developer Window
        </button>

      </div>
    </main>
  );
}

export default App;