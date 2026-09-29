import { useState } from "react";
import { useNavigate } from "react-router";

import { useProjects } from "./context/ProjectContext";

function App() {
  const navigate = useNavigate();

  const { workspaces, addWorkspace, getChildren, addNode } =
    useProjects();

  const [batch, setBatch] = useState("");
  const [section, setSection] = useState("");
  const [groupNumber, setGroupNumber] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const batchName = batch.trim();
    const sectionName = section.trim();
    const groupNumberValue = groupNumber.trim();

    if (!batchName || !sectionName || !groupNumberValue) {
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

    const groupNodeId =
      groupNode?.id ??
      addNode(sectionNodeId, groupLabel, "group");

    navigate(
      `/workspace/${workspaceId}/${sectionNodeId}/${groupNodeId}`,
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

          <button
            type="submit"
            className="mt-4 w-full cursor-pointer rounded-xl bg-white px-4 py-3 text-black transition hover:bg-white/90"
          >
            Continue
          </button>
        </form>

      </div>
    </main>
  );
}

export default App;
