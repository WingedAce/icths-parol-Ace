import { useRef, useState } from "react";

import { useNavigate, useParams } from "react-router";

import { useProjects } from "../context/ProjectContext";

import parolIcon from "../assets/parol-icon.png";

import ZoneMapper from "../components/ZoneMapper";
import ConfirmDialog from "../components/ConfirmDialog.tsx";

import PinSetup from "../components/PinSetup";

import AudioUploader from "../components/AudioUploader";

import SequenceEditor from "../components/SequenceEditor";

import KeyframeGallery from "../components/KeyframeGallery";

import CodeGenerator from "../components/CodeGenerator";

import { remapFramesToBeats } from "../utils/audioTiming";

import type { AudioAnalysis } from "../types";

import type {
  NodeType,
  PinMapping,
  ProjectNode,
  Workspace,
  Zone,
} from "../types";

type GroupTab = "zones" | "pins" | "song" | "preview" | "gallery" | "code";
type Round = 1 | 2 | 3;

const ROUNDS: Round[] = [1, 2, 3];

// Zone Map and Pins are set up once (Round 1) and shared by every round, so
// only Round 1 shows them. Every round has its own song, keyframes and code.
const GROUP_TABS: { id: GroupTab; label: string; round1Only?: boolean }[] = [
  { id: "zones", label: "Zone Map", round1Only: true },
  { id: "pins", label: "Pins", round1Only: true },
  { id: "song", label: "Song" },
  { id: "preview", label: "Preview" },
  { id: "gallery", label: "Gallery" },
  { id: "code", label: "Code" },
];

const needsSongSlot = (tab: GroupTab) => tab !== "zones" && tab !== "pins";

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
    removeNodeImage,
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

  const [groupTab, setGroupTab] = useState<GroupTab>("zones");

  // The chosen round belongs to the group it was picked in: opening another
  // group starts on Round 1 again.
  const [roundState, setRoundState] = useState<{ path: string; round: Round }>(
    { path: nestedPath ?? "", round: 1 },
  );
  const round: Round =
    roundState.path === (nestedPath ?? "") ? roundState.round : 1;

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Hidden input for "Replace image" (the drop area above only exists while
  // there is no image yet).
  const replaceInputRef = useRef<HTMLInputElement>(null);
  // Bumped on every replace/remove so the Zone Map starts fresh instead of
  // keeping selections from the old drawing.
  const [imageVersion, setImageVersion] = useState(0);

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

  // The group's song slot for the chosen round. Old projects have one slot
  // with no round saved; that one is Round 1.
  const animationChild =
    currentNode?.type === "group"
      ? getChildren(currentNode.id).find(
          (item) =>
            item.type === "animation" && (item.round ?? 1) === round,
        )
      : undefined;

  // Makes the song slot of a round the first time it is needed.
  function ensureSongSlot(forRound: Round) {
    if (!currentNode || currentNode.type !== "group") return;

    const exists = getChildren(currentNode.id).some(
      (item) =>
        item.type === "animation" && (item.round ?? 1) === forRound,
    );

    if (!exists) {
      addNode(currentNode.id, "Song", "animation", forRound);
    }
  }

  function selectTab(tab: GroupTab) {
    if (needsSongSlot(tab)) ensureSongSlot(round);
    setGroupTab(tab);
  }

  function selectRound(next: Round) {
    // Rounds 2 and 3 have no Zone Map / Pins, so start them on Song.
    const nextTab: GroupTab =
      next > 1 && !needsSongSlot(groupTab) ? "song" : groupTab;

    if (needsSongSlot(nextTab)) ensureSongSlot(next);

    setRoundState({ path: nestedPath ?? "", round: next });
    setGroupTab(nextTab);
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

  // Zones, pin assignments and tricolor merges are made from the drawing, so
  // replacing, removing or re-scanning it throws them away. The design is
  // shared by all three rounds, so ask first (in the popup, and say so) if
  // there is any. With nothing to lose it just goes ahead.
  const [discardDialog, setDiscardDialog] = useState<{
    action: "replace" | "remove" | "rescan";
    onConfirm: () => void;
  } | null>(null);

  function askBeforeDiscarding(
    action: "replace" | "remove" | "rescan",
    onConfirm: () => void,
  ) {
    const hasWork =
      (currentNode?.zones?.length ?? 0) > 0 ||
      (currentNode?.pinMappings?.length ?? 0) > 0;

    if (!hasWork) {
      onConfirm();
      return;
    }

    setDiscardDialog({ action, onConfirm });
  }

  function handleReplaceFile(file: File | null | undefined) {
    if (!file) return;
    // Check the type first so a wrong file doesn't ask for confirmation.
    if (file.type !== "image/png") {
      handleFile(file);
      return;
    }
    askBeforeDiscarding("replace", () => {
      setImageVersion((v) => v + 1);
      handleFile(file);
    });
  }

  function handleRemoveImage() {
    if (!currentNode) return;
    const id = currentNode.id;
    askBeforeDiscarding("remove", () => {
      setImageVersion((v) => v + 1);
      removeNodeImage(id);
    });
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
            <div className="mb-10">
              {/* Round picker */}
              <div className="mb-8 flex flex-col items-start gap-3">
                <div
                  role="tablist"
                  aria-label="Round"
                  className="inline-flex rounded-2xl border border-white/10 bg-white/[0.03] p-1"
                >
                  {ROUNDS.map((r) => (
                    <button
                      key={r}
                      role="tab"
                      aria-selected={round === r}
                      onClick={() => selectRound(r)}
                      className={`cursor-pointer rounded-xl px-6 py-2.5 font-serif text-sm tracking-wide transition sm:px-9 ${
                        round === r
                          ? "bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.15)]"
                          : "text-white/50 hover:bg-white/[0.06] hover:text-white"
                      }`}
                    >
                      Round {r}
                    </button>
                  ))}
                </div>

                {round > 1 && (
                  <p className="text-xs text-white/30">
                    Zone Map and Pins are set up once in Round 1 and shared by
                    every round. This round has its own song, keyframes and
                    code.
                  </p>
                )}
              </div>

              {/* Step tabs */}
              <div
                role="tablist"
                aria-label="Steps"
                className="flex gap-1 overflow-x-auto border-b border-white/10 sm:overflow-visible"
              >
                {GROUP_TABS.filter((tab) => round === 1 || !tab.round1Only).map(
                  (tab) => (
                    <button
                      key={tab.id}
                      role="tab"
                      aria-selected={groupTab === tab.id}
                      onClick={() => selectTab(tab.id)}
                      className={`relative -mb-px shrink-0 cursor-pointer whitespace-nowrap rounded-t-xl border border-b-0 px-5 py-3 text-xs uppercase tracking-[0.2em] transition sm:px-7 ${
                        groupTab === tab.id
                          ? "border-white/20 bg-gradient-to-b from-white/[0.09] to-[#050505] text-white shadow-[inset_0_2px_0_0_rgba(253,230,138,0.8)]"
                          : "border-transparent text-white/40 hover:bg-white/[0.04] hover:text-white"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ),
                )}
              </div>
            </div>

            {round === 1 && groupTab === "zones" && (
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
                        className="mx-1 cursor-pointer rounded-full border border-white/25 px-3 py-1 text-xs uppercase tracking-[0.15em] text-white transition hover:border-white/50 hover:bg-white/10"
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
                  <>
                  <div className="mx-auto mb-6 flex max-w-6xl flex-wrap items-center justify-end gap-2">
                    <button
                      onClick={() => replaceInputRef.current?.click()}
                      className="cursor-pointer rounded-full border border-white/10 px-4 py-1.5 text-[11px] uppercase tracking-wider text-white/60 transition hover:border-white/25 hover:text-white"
                    >
                      Upload another image
                    </button>
                    <button
                      onClick={handleRemoveImage}
                      className="cursor-pointer rounded-full border border-red-400/20 px-4 py-1.5 text-[11px] uppercase tracking-wider text-red-300/70 transition hover:border-red-400/40 hover:text-red-300"
                    >
                      Remove image
                    </button>
                    <input
                      ref={replaceInputRef}
                      type="file"
                      accept="image/png"
                      className="hidden"
                      onChange={(event) => {
                        handleReplaceFile(event.target.files?.[0]);
                        // So picking the same file again still fires onChange.
                        event.target.value = "";
                      }}
                    />
                  </div>
                  <ZoneMapper
                    key={imageVersion}
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
                    onClearZones={() => {
                      const id = currentNode.id;
                      askBeforeDiscarding("rescan", () => clearNodeZones(id));
                    }}
                  />
                  </>
                )}
              </>
            )}

            {round === 1 && groupTab === "pins" && (
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
                key={animationChild.id}
                node={animationChild}
                onAnalyzed={(
                  fileName: string,
                  analysis: AudioAnalysis,
                ) => {
                  setNodeAudio(
                    animationChild.id,
                    fileName,
                    analysis,
                  );
                  // A new song starts with no keyframes.
                  setNodeFrames(animationChild.id, []);
                }}
                onTempoChange={(analysis: AudioAnalysis) => {
                  setNodeAudio(
                    animationChild.id,
                    animationChild.audioFileName ?? "",
                    analysis,
                  );
                  // The beats moved, so the keyframes follow them.
                  setNodeFrames(
                    animationChild.id,
                    remapFramesToBeats(
                      animationChild.frames ?? [],
                      analysis.beatTimes,
                    ),
                  );
                }}
                onClear={() => {
                  clearNodeAudio(animationChild.id);
                  setNodeFrames(animationChild.id, []);
                }}
                frameCount={(animationChild.frames ?? []).length}
                onResetKeyframes={() =>
                  setNodeFrames(animationChild.id, [])
                }
              />
            )}

            {groupTab === "preview" && animationChild && (
              <div className="mx-auto max-w-3xl">
                <SequenceEditor
                  key={animationChild.id}
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
                  key={animationChild.id}
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
                key={animationChild.id}
                round={round}
                pinMappings={
                  currentNode.pinMappings ?? []
                }
                tricolorGroups={
                  currentNode.tricolorGroups ?? []
                }
                frames={animationChild.frames ?? []}
                audioAnalysis={
                  animationChild.audioAnalysis
                }
                songName={animationChild.audioFileName ?? animationChild.name}
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
                ) => {
                  setNodeAudio(
                    currentNode.id,
                    fileName,
                    analysis,
                  );
                  setNodeFrames(currentNode.id, []);
                }}
                onTempoChange={(analysis: AudioAnalysis) => {
                  setNodeAudio(
                    currentNode.id,
                    currentNode.audioFileName ?? "",
                    analysis,
                  );
                  setNodeFrames(
                    currentNode.id,
                    remapFramesToBeats(
                      currentNode.frames ?? [],
                      analysis.beatTimes,
                    ),
                  );
                }}
                onClear={() => {
                  clearNodeAudio(currentNode.id);
                  setNodeFrames(currentNode.id, []);
                }}
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

        {discardDialog && (
          <ConfirmDialog
            title={
              discardDialog.action === "replace"
                ? "Replace image?"
                : discardDialog.action === "remove"
                  ? "Remove image?"
                  : "Re-scan drawing?"
            }
            checkboxLabel="I understand this affects all three rounds"
            onCancel={() => setDiscardDialog(null)}
            onConfirm={() => {
              const { onConfirm } = discardDialog;
              setDiscardDialog(null);
              onConfirm();
            }}
          >
            <p>
              {discardDialog.action === "replace"
                ? "Replacing the image"
                : discardDialog.action === "remove"
                  ? "Removing the image"
                  : "Re-scanning the drawing"}{" "}
              will delete its detected zones, pin assignments and tricolor
              merges.
            </p>
            <p>
              This design is shared by all three rounds, so Round 1, Round 2
              and Round 3 are all affected.
            </p>
            <p>
              The song and keyframes of each round are kept, but the keyframes
              may point to pins that no longer exist. Set up the pins again,
              then check the keyframes in every round.
            </p>
          </ConfirmDialog>
        )}
      </div>
    </main>
  );
}

export default WorkspacePage;
