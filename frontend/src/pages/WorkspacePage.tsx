import { useRef, useState } from "react";

import { useNavigate, useParams } from "react-router";

import { useProjects } from "../context/ProjectContext";

import parolIcon from "../assets/parol-icon.png";

import ZoneMapper from "../components/ZoneMapper";

import PinSetup from "../components/PinSetup";

import AudioUploader from "../components/AudioUploader";

import SequenceEditor from "../components/SequenceEditor";

import KeyframeGallery from "../components/KeyframeGallery";

import CodeGenerator from "../components/CodeGenerator";

import type { AudioAnalysis } from "../types";

import type {
  NodeType,
  PinMapping,
  ProjectNode,
  Workspace,
  Zone,
} from "../types";

const typeLabels: Record<NodeType, string> = {
  section: "Class Section",
  parol: "Parol",
  group: "Group",
  animation: "Animation",
};

function WorkspacePage() {
  const { workspaceId, "*": nestedPath } = useParams();

  const navigate = useNavigate();

  const {
    workspaces,
    getChildren,
    addNode,
    renameNode,
    deleteNode,
    renameWorkspace,
    deleteWorkspace,
    setNodeImage,
    setNodeZones,
    setNodePinMappings,
    setNodeTricolorGroups,
    clearNodeZones,
    setNodeAudio,
    clearNodeAudio,
    setNodeFrames,
  } = useProjects();

  const workspace: Workspace | undefined = workspaces.find(
    (item) => item.id === workspaceId,
  );

  const pathIds = (nestedPath ?? "")
    .split("/")
    .filter((id) => id.length > 0);

  const [isNewOpen, setIsNewOpen] = useState(false);

  const [newName, setNewName] = useState("");

  const [isDragging, setIsDragging] = useState(false);

  const [groupTab, setGroupTab] = useState<
    "zones" | "pins" | "song" | "preview" | "gallery" | "code"
  >("zones");

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!workspace) {
    return (
      <main className="min-h-screen bg-[#050505] p-10 text-white">
        Workspace not found.
      </main>
    );
  }

  const currentWorkspace = workspace;

  // Find every node in the current path.
  const nodeChain: ProjectNode[] = [];

  let parentId = currentWorkspace.id;

  for (const id of pathIds) {
    const node = getChildren(parentId).find(
      (item) => item.id === id,
    );

    if (!node) {
      return (
        <main className="min-h-screen bg-[#050505] p-10 text-white">
          Page not found.
        </main>
      );
    }

    nodeChain.push(node);
    parentId = node.id;
  }

  const currentNode =
    nodeChain[nodeChain.length - 1];

  // A Group's single "Song" slot.
  const animationChild =
    currentNode?.type === "group"
      ? getChildren(currentNode.id).find(
          (item) => item.type === "animation",
        )
      : undefined;

  function openSongTab() {
    if (!currentNode || currentNode.type !== "group") return;

    if (!animationChild) {
      addNode(currentNode.id, "Song", "animation");
    }

    setGroupTab("song");
  }

  function openPreviewTab() {
    if (!currentNode || currentNode.type !== "group") return;

    if (!animationChild) {
      addNode(currentNode.id, "Song", "animation");
    }

    setGroupTab("preview");
  }

  function openGalleryTab() {
    if (!currentNode || currentNode.type !== "group") return;

    if (!animationChild) {
      addNode(currentNode.id, "Song", "animation");
    }

    setGroupTab("gallery");
  }

  // Decide what the user is allowed to create here.
  let childType: NodeType | null = null;

  if (!currentNode) {
    childType =
      currentWorkspace.type === "batch"
        ? "section"
        : "parol";
  } else if (
    currentNode.type === "section" ||
    currentNode.type === "parol"
  ) {
    childType = "group";
  } else if (currentNode.type === "group") {
    childType = "animation";
  }

  const currentItems = childType
    ? getChildren(parentId)
    : [];

  const title =
    currentNode?.name ?? currentWorkspace.name;

  function openNode(id: string) {
    const nextPath = [...pathIds, id].join("/");

    navigate(
      `/workspace/${currentWorkspace.id}/${nextPath}`,
    );
  }

  function createItem() {
    const name = newName.trim();

    if (!name || !childType) {
      return;
    }

    addNode(parentId, name, childType);

    setNewName("");
    setIsNewOpen(false);
  }

  function handleRenameNode(
    id: string,
    currentName: string,
  ) {
    const name = window.prompt(
      "Rename:",
      currentName,
    );

    if (name?.trim()) {
      renameNode(id, name.trim());
    }
  }

  function handleDeleteNode(
    id: string,
    name: string,
  ) {
    const confirmed = window.confirm(
      `Delete "${name}" and everything inside it?`,
    );

    if (confirmed) {
      deleteNode(id);
    }
  }

  function handleRenameWorkspace() {
    const name = window.prompt(
      "Rename workspace:",
      currentWorkspace.name,
    );

    if (name?.trim()) {
      renameWorkspace(
        currentWorkspace.id,
        name.trim(),
      );
    }
  }

  function handleDeleteWorkspace() {
    const confirmed = window.confirm(
      `Delete "${currentWorkspace.name}" and everything inside it?`,
    );

    if (confirmed) {
      deleteWorkspace(currentWorkspace.id);
      navigate("/");
    }
  }

  function handleFile(
    file: File | null | undefined,
  ) {
    if (!file || !currentNode) return;

    if (file.type !== "image/png") {
      window.alert(
        "Please upload a PNG file, not JPG/JPEG.\n\n" +
          "JPEG compression blurs and adds noise around thin lines, which " +
          "breaks or merges zones during detection. PNG is lossless, so " +
          "your exact drawing comes through pixel-for-pixel.",
      );

      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        setNodeImage(
          currentNode.id,
          reader.result,
        );
      }
    };

    reader.readAsDataURL(file);
  }

  return (
    <main className="min-h-screen bg-[#050505] px-6 py-10 text-white md:px-12 lg:px-20">
      <div className="mx-auto max-w-7xl">
        <button
          onClick={() => navigate(-1)}
          className="mb-8 cursor-pointer text-xs uppercase tracking-[0.3em] text-white/30 transition hover:text-white"
        >
          ← Back
        </button>

        <div className="text-[10px] uppercase tracking-[0.35em] text-white/30">
          Parol Editor / {currentWorkspace.name}

          {nodeChain.map((node) => (
            <span key={node.id}>
              {" / "}
              {node.name}
            </span>
          ))}
        </div>

        <div className="mt-5 flex items-end justify-between">
          <h1 className="font-serif text-6xl font-light">
            {title}
          </h1>

          <div className="flex gap-2">
            {!currentNode && (
              <>
                <button
                  onClick={handleRenameWorkspace}
                  className="cursor-pointer rounded-full border border-white/10 px-4 py-2 text-xs text-white/40 transition hover:border-white/25 hover:text-white"
                >
                  Rename
                </button>

                <button
                  onClick={handleDeleteWorkspace}
                  className="cursor-pointer rounded-full border border-white/10 px-4 py-2 text-xs text-white/40 transition hover:border-white/25 hover:text-white"
                >
                  Delete
                </button>
              </>
            )}

            {childType && currentNode?.type !== "group" && (
              <span className="px-2 py-2 text-xs text-white/20">
                {currentItems.length}{" "}
                {typeLabels[childType].toLowerCase()}
                {currentItems.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        <div className="mt-10 h-px w-full bg-white/10" />

        {currentNode?.type === "group" ? (
          <section className="mt-12">
            <div className="mb-10 flex gap-2">
              <button
                onClick={() => setGroupTab("zones")}
                className={`cursor-pointer rounded-full border px-5 py-2 text-xs uppercase tracking-[0.2em] transition ${
                  groupTab === "zones"
                    ? "border-white/40 bg-white/[0.08] text-white"
                    : "border-white/10 text-white/40 hover:border-white/25 hover:text-white"
                }`}
              >
                Zone Map
              </button>

              <button
                onClick={() => setGroupTab("pins")}
                className={`cursor-pointer rounded-full border px-5 py-2 text-xs uppercase tracking-[0.2em] transition ${
                  groupTab === "pins"
                    ? "border-white/40 bg-white/[0.08] text-white"
                    : "border-white/10 text-white/40 hover:border-white/25 hover:text-white"
                }`}
              >
                Pins
              </button>

              <button
                onClick={openSongTab}
                className={`cursor-pointer rounded-full border px-5 py-2 text-xs uppercase tracking-[0.2em] transition ${
                  groupTab === "song"
                    ? "border-white/40 bg-white/[0.08] text-white"
                    : "border-white/10 text-white/40 hover:border-white/25 hover:text-white"
                }`}
              >
                Song
              </button>

              <button
                onClick={openPreviewTab}
                className={`cursor-pointer rounded-full border px-5 py-2 text-xs uppercase tracking-[0.2em] transition ${
                  groupTab === "preview"
                    ? "border-white/40 bg-white/[0.08] text-white"
                    : "border-white/10 text-white/40 hover:border-white/25 hover:text-white"
                }`}
              >
                Preview
              </button>

              <button
                onClick={openGalleryTab}
                className={`cursor-pointer rounded-full border px-5 py-2 text-xs uppercase tracking-[0.2em] transition ${
                  groupTab === "gallery"
                    ? "border-white/40 bg-white/[0.08] text-white"
                    : "border-white/10 text-white/40 hover:border-white/25 hover:text-white"
                }`}
              >
                Gallery
              </button>

              <button
                onClick={() => setGroupTab("code")}
                className={`cursor-pointer rounded-full border px-5 py-2 text-xs uppercase tracking-[0.2em] transition ${
                  groupTab === "code"
                    ? "border-white/40 bg-white/[0.08] text-white"
                    : "border-white/10 text-white/40 hover:border-white/25 hover:text-white"
                }`}
              >
                Code
              </button>
            </div>

            {groupTab === "zones" && (
              <>
                {!currentNode.imageDataUrl ? (
                  <div
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() =>
                      setIsDragging(false)
                    }
                    onDrop={(event) => {
                      event.preventDefault();
                      setIsDragging(false);
                      handleFile(
                        event.dataTransfer.files?.[0],
                      );
                    }}
                    className={`mx-auto flex max-w-xl flex-col items-center justify-center rounded-3xl border-2 border-dashed px-10 py-16 text-center transition ${
                      isDragging
                        ? "border-white/40 bg-white/[0.05]"
                        : "border-white/15 bg-white/[0.02]"
                    }`}
                  >
                    <img
                      src={parolIcon}
                      alt=""
                      className="mb-6 h-20 w-20 object-contain opacity-90"
                    />

                    <p className="text-white/70">
                      Drop your image here, or{" "}
                      <button
                        onClick={() =>
                          fileInputRef.current?.click()
                        }
                        className="cursor-pointer text-white underline underline-offset-2 hover:text-white/80"
                      >
                        browse
                      </button>
                    </p>

                    <p className="mt-2 text-xs text-white/25">
                      PNG only — export at your drawing's original resolution,
                      don't upscale it
                    </p>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png"
                      className="hidden"
                      onChange={(event) =>
                        handleFile(
                          event.target.files?.[0],
                        )
                      }
                    />
                  </div>
                ) : (
                  <ZoneMapper
                    node={currentNode}
                    onZonesReady={(
                      zones: Zone[],
                      imageWidth: number,
                      imageHeight: number,
                    ) =>
                      setNodeZones(
                        currentNode.id,
                        zones,
                        imageWidth,
                        imageHeight,
                      )
                    }
                    onPinMappingsChange={(
                      pinMappings: PinMapping[],
                    ) =>
                      setNodePinMappings(
                        currentNode.id,
                        pinMappings,
                      )
                    }
                    onTricolorGroupsChange={(groups) =>
                      setNodeTricolorGroups(currentNode.id, groups)
                    }
                    onClearZones={() =>
                      clearNodeZones(currentNode.id)
                    }
                  />
                )}
              </>
            )}

            {groupTab === "pins" && (
              <PinSetup
                node={currentNode}
                onPinMappingsChange={(pinMappings: PinMapping[]) =>
                  setNodePinMappings(currentNode.id, pinMappings)
                }
                onGoToZoneMap={() => setGroupTab("zones")}
              />
            )}

            {groupTab === "song" && animationChild && (
              <AudioUploader
                node={animationChild}
                onAnalyzed={(
                  fileName: string,
                  analysis: AudioAnalysis,
                ) =>
                  setNodeAudio(
                    animationChild.id,
                    fileName,
                    analysis,
                  )
                }
                onClear={() =>
                  clearNodeAudio(animationChild.id)
                }
              />
            )}

            {groupTab === "preview" && animationChild && (
              <div className="mx-auto max-w-3xl">
                <SequenceEditor
                  groupNode={currentNode}
                  animationNode={animationChild}
                  onFramesChange={(frames) =>
                    setNodeFrames(
                      animationChild.id,
                      frames,
                    )
                  }
                />
              </div>
            )}

            {groupTab === "gallery" && animationChild && (
              <div className="mx-auto max-w-5xl">
                <KeyframeGallery
                  groupNode={currentNode}
                  animationNode={animationChild}
                  onFramesChange={(frames) =>
                    setNodeFrames(
                      animationChild.id,
                      frames,
                    )
                  }
                />
              </div>
            )}

            {groupTab === "code" && animationChild && (
              <CodeGenerator
                pinMappings={
                  currentNode.pinMappings ?? []
                }
                audioAnalysis={
                  animationChild.audioAnalysis
                }
                songName={animationChild.name}
              />
            )}
          </section>
        ) : currentNode?.type === "animation" ? (
          <section className="mt-12">
            <p className="text-[10px] uppercase tracking-[0.3em] text-white/30">
              Animation Editor
            </p>

            <h2 className="mt-3 font-serif text-4xl font-light">
              {currentNode.name}
            </h2>

            <div className="mt-8">
              <AudioUploader
                node={currentNode}
                onAnalyzed={(
                  fileName: string,
                  analysis: AudioAnalysis,
                ) =>
                  setNodeAudio(
                    currentNode.id,
                    fileName,
                    analysis,
                  )
                }
                onClear={() =>
                  clearNodeAudio(currentNode.id)
                }
              />
            </div>

            <p className="mt-8 text-white/25">
              Tapping zones on/off per song section will be built next.
            </p>
          </section>
        ) : (
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {currentItems.map((item) => (
              <div
                key={item.id}
                className="group relative aspect-[4/3]"
              >
                <button
                  onClick={() => openNode(item.id)}
                  className="absolute inset-0 w-full cursor-pointer rounded-2xl border border-white/10 bg-white/[0.03] p-7 text-left transition duration-500 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.06]"
                >
                  <div className="flex h-full flex-col justify-end">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-white/30">
                      {typeLabels[item.type]}
                    </p>

                    <h2 className="mt-2 font-serif text-3xl font-light">
                      {item.name}
                    </h2>
                  </div>
                </button>

                <div className="absolute right-4 top-4 flex gap-2 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={() =>
                      handleRenameNode(
                        item.id,
                        item.name,
                      )
                    }
                    className="cursor-pointer rounded-full bg-black/70 px-3 py-2 text-xs text-white/50 backdrop-blur hover:text-white"
                  >
                    Rename
                  </button>

                  <button
                    onClick={() =>
                      handleDeleteNode(
                        item.id,
                        item.name,
                      )
                    }
                    className="cursor-pointer rounded-full bg-black/70 px-3 py-2 text-xs text-white/50 backdrop-blur hover:text-white"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}

            {childType && (
              <button
                onClick={() => setIsNewOpen(true)}
                className="aspect-[4/3] w-full cursor-pointer rounded-2xl border border-dashed border-white/10 bg-white/[0.015] transition duration-500 hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.04]"
              >
                <span className="flex h-full flex-col items-center justify-center">
                  <span className="text-5xl font-light text-white/30">
                    +
                  </span>

                  <span className="mt-3 text-[10px] uppercase tracking-[0.3em] text-white/30">
                    New
                  </span>
                </span>
              </button>
            )}
          </div>
        )}

        {isNewOpen && childType && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b0b0b] p-8">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-3xl">
                  New {typeLabels[childType]}
                </h2>

                <button
                  onClick={() => {
                    setIsNewOpen(false);
                    setNewName("");
                  }}
                  className="cursor-pointer text-white/40 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <input
                autoFocus
                value={newName}
                onChange={(event) =>
                  setNewName(event.target.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    createItem();
                  }
                }}
                placeholder={`Enter ${typeLabels[
                  childType
                ].toLowerCase()} name`}
                className="mt-8 w-full rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-white outline-none placeholder:text-white/20 focus:border-white/30"
              />

              <button
                onClick={createItem}
                className="mt-4 w-full cursor-pointer rounded-lg bg-white px-4 py-3 text-black transition hover:bg-white/90"
              >
                Create
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default WorkspacePage;
