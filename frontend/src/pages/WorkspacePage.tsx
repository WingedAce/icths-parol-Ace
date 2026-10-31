import { useEffect, useRef, useState } from "react";

import { useNavigate, useParams } from "react-router";

import { useProjects } from "../context/ProjectContext";

import parolIcon from "../assets/parol-icon.png";

import ZoneMapper from "../components/ZoneMapper";
import ConfirmDialog from "../components/ConfirmDialog.tsx";

import PinSetup from "../components/PinSetup";

import AudioUploader from "../components/AudioUploader";

import SequenceEditor from "../components/SequenceEditor";

import SaveButton from "../components/SaveButton";

import KeyframeGallery from "../components/KeyframeGallery";
import PinRemapNotice from "../components/PinRemapNotice";
import { analogPinSet } from "../utils/pins";
import {
  applyPinRemaps,
  pendingPinRemaps,
  settleLostPins,
  updateLostPins,
} from "../utils/pinRemap";

import CodeGenerator from "../components/CodeGenerator";

import TrialWorkspace from "../components/TrialWorkspace";
import type { DesignPiece, RoundPiece } from "../components/TrialWorkspace";

import { remapFramesToBeats } from "../utils/audioTiming";
import { displayName, originalNameIfRenamed } from "../utils/parolName";

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

// Which round and tab a group was on, kept in this browser so a reload or a
// return visit lands exactly where the user left off (instead of Round 1 /
// Zone Map, which looked like Round 2 progress had been lost).
const uiKey = (workspaceId: string | undefined, path: string) =>
  `parol-ui:${workspaceId ?? ""}:${path}`;

function readUi(key: string): { round: Round; tab: GroupTab; trial: boolean } {
  const fallback: { round: Round; tab: GroupTab; trial: boolean } = {
    round: 1,
    tab: "zones",
    trial: false,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as {
      round?: unknown;
      tab?: unknown;
      trial?: unknown;
    } | null;
    const round: Round =
      saved?.round === 2 || saved?.round === 3 ? saved.round : 1;
    const tab = GROUP_TABS.some((t) => t.id === saved?.tab)
      ? (saved?.tab as GroupTab)
      : fallback.tab;
    return { round, tab, trial: saved?.trial === true };
  } catch {
    return fallback;
  }
}

function writeUi(
  key: string,
  patch: { round?: Round; tab?: GroupTab; trial?: boolean },
) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...readUi(key), ...patch }));
  } catch {
    // storage blocked: the page just won't remember
  }
}

// Makes the song slot of the round that is open if it is missing (for
// example after coming back to Round 2 on another device).
function SongSlotGuard({
  active,
  onEnsure,
}: {
  active: boolean;
  onEnsure: () => void;
}) {
  useEffect(() => {
    if (active) onEnsure();
  });
  return null;
}

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
    setNodeLostZonePins,
    setNodeTricolorGroups,
    clearNodeZones,
    setNodeAudio,
    setNodeAudioOriginal,
    clearNodeAudio,
    setNodeFrames,
    setNodeTiming,
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

  // The chosen round and tab belong to the group they were picked in, and
  // are remembered in this browser (see readUi above).
  const pathKey = nestedPath ?? "";
  const storeKey = uiKey(workspaceId, pathKey);

  const [tabState, setTabState] = useState<{ path: string; tab: GroupTab }>(
    () => ({ path: pathKey, tab: readUi(storeKey).tab }),
  );
  const [roundState, setRoundState] = useState<{ path: string; round: Round }>(
    () => ({ path: pathKey, round: readUi(storeKey).round }),
  );
  const round: Round =
    roundState.path === pathKey ? roundState.round : readUi(storeKey).round;
  // The Trial tab: a sandbox next to the three rounds (see TrialWorkspace).
  const [trialState, setTrialState] = useState<{ path: string; open: boolean }>(
    () => ({ path: pathKey, open: readUi(storeKey).trial }),
  );
  const trialOpen: boolean =
    trialState.path === pathKey ? trialState.open : readUi(storeKey).trial;
  const setTrialOpen = (open: boolean) => {
    setTrialState({ path: pathKey, open });
    writeUi(storeKey, { trial: open });
  };
  const storedTab: GroupTab =
    tabState.path === pathKey ? tabState.tab : readUi(storeKey).tab;
  // Rounds 2 and 3 have no Zone Map / Pins tab.
  const groupTab: GroupTab =
    round > 1 && !needsSongSlot(storedTab) ? "song" : storedTab;
  const setGroupTab = (tab: GroupTab) => {
    setTabState({ path: pathKey, tab });
    writeUi(storeKey, { tab });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Hidden input for "Replace image" (the drop area above only exists while
  // there is no image yet).
  const replaceInputRef = useRef<HTMLInputElement>(null);
  // Bumped on every replace/remove so the Zone Map starts fresh instead of
  // keeping selections from the old drawing.
  const [imageVersion, setImageVersion] = useState(0);
  const [discardDialog, setDiscardDialog] = useState<{
  action: "replace" | "remove" | "rescan";
  onConfirm: () => void;
} | null>(null);

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

    setRoundState({ path: pathKey, round: next });
    writeUi(storeKey, { round: next });
    setGroupTab(nextTab);
    setTrialOpen(false);
  }

  // The real song slot of every round, for the Trial tab.
  const songNodes: Partial<Record<Round, ProjectNode>> = {};
  if (currentNode?.type === "group") {
    for (const r of ROUNDS) {
      songNodes[r] = getChildren(currentNode.id).find(
        (item) => item.type === "animation" && (item.round ?? 1) === r,
      );
    }
  }

  // Writes the trial's pieces into the real project. Only reached after the
  // "are you sure" popup in the Trial tab.
  function applyTrial(args: {
    round: Round;
    design: DesignPiece | null;
    roundPiece: RoundPiece | null;
  }) {
    if (!currentNode) return;

    if (args.design) {
      const { zones, imageWidth, imageHeight, pinMappings, tricolorGroups } =
        args.design;
      if (zones) {
        // setNodeZones empties the pins, so the pins go in right after it.
        const sameZones =
          (currentNode.zones ?? []).length === zones.length &&
          zones.every((z, i) => {
            const old = (currentNode.zones ?? [])[i];
            return old.id === z.id && old.cx === z.cx && old.cy === z.cy;
          });
        setNodeZones(currentNode.id, zones, imageWidth ?? 1, imageHeight ?? 1);
        setNodePinMappings(currentNode.id, pinMappings);
        setNodeTricolorGroups(currentNode.id, tricolorGroups);
        // Same zones with different pins: the keyframes of the real rounds
        // still point at the old pins, so remember what moved and offer to
        // turn the new pins on (see PinRemapNotice).
        if (sameZones) {
          setNodeLostZonePins(
            currentNode.id,
            updateLostPins(
              currentNode.pinMappings ?? [],
              pinMappings,
              currentNode.lostZonePins,
            ),
          );
        }
      } else {
        clearNodeZones(currentNode.id);
      }
    }

    const song = songNodes[args.round];
    if (args.roundPiece && song) {
      setNodeFrames(song.id, args.roundPiece.frames);
      setNodeTiming(song.id, {
        timingMode: args.roundPiece.timingMode,
        bpmChanges: args.roundPiece.bpmChanges,
      });
    }
  }

  // Zones that were given new pins since the keyframes were made: the
  // keyframes still point at the old pins, so offer to turn the new ones on.
  const remapSummary =
    currentNode?.type === "group"
      ? pendingPinRemaps(
          currentNode.pinMappings ?? [],
          currentNode.lostZonePins,
          ROUNDS.map((r) => songNodes[r]?.frames ?? []),
        )
      : null;

  function applyPinRemap() {
    if (!currentNode || !remapSummary) return;
    const mappings = currentNode.pinMappings ?? [];
    const analog = analogPinSet(currentNode);
    ROUNDS.forEach((r, i) => {
      const song = songNodes[r];
      if (!song || remapSummary.keyframesPerList[i] === 0) return;
      setNodeFrames(
        song.id,
        applyPinRemaps(song.frames ?? [], mappings, currentNode.lostZonePins, analog),
      );
    });
    setNodeLostZonePins(
      currentNode.id,
      settleLostPins(currentNode.lostZonePins, mappings),
    );
  }

  function keepKeyframes() {
    if (!currentNode) return;
    setNodeLostZonePins(
      currentNode.id,
      settleLostPins(currentNode.lostZonePins, currentNode.pinMappings ?? []),
    );
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

  const title = currentNode
    ? displayName(currentNode)
    : currentWorkspace.name;
  // "Group 3", shown small under a renamed parol's title.
  const titleOriginal = currentNode ? originalNameIfRenamed(currentNode) : null;

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

  // True if this node, or anything inside it, is a locked design.
  function containsLocked(node: ProjectNode): boolean {
    if (node.locked) return true;
    return getChildren(node.id).some(containsLocked);
  }

  function handleDeleteNode(
    id: string,
    name: string,
  ) {
    const target = currentItems.find((item) => item.id === id);

    if (target && containsLocked(target)) {
      window.alert(
        `"${name}" has a locked design inside it, so it can't be deleted. Unlock it in the Developer Window first.`,
      );
      return;
    }

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
    if (getChildren(currentWorkspace.id).some(containsLocked)) {
      window.alert(
        `"${currentWorkspace.name}" has a locked design inside it, so it can't be deleted. Unlock it in the Developer Window first.`,
      );
      return;
    }

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

 
async function handleFile(
  file: File | null | undefined,
) {
  if (!file || !currentNode) return;

  if (file.type !== "image/png") {
    window.alert(
      "Please upload a PNG file, not JPG/JPEG.\n\n" +
        "JPEG compression can blur thin lines and interfere " +
        "with zone detection. PNG preserves the drawing.",
    );
    return;
  }

  const reader = new FileReader();

  reader.onload = async () => {
    if (typeof reader.result !== "string") return;

    try {
      await setNodeImage(currentNode.id, reader.result);
    } catch (error) {
      console.error(
        "Failed to save drawing to Supabase Storage:",
        error,
      );

      window.alert(
        "The drawing could not be saved. Please check your connection and try again.",
      );
    }
  };

  reader.onerror = () => {
    console.error("Failed to read the uploaded drawing.");
    window.alert("Could not read the PNG file. Please try again.");
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

        <SongSlotGuard
          active={
            currentNode?.type === "group" &&
            needsSongSlot(groupTab) &&
            !animationChild &&
            !currentNode.locked
          }
          onEnsure={() => ensureSongSlot(round)}
        />

        <div className="text-[10px] uppercase tracking-[0.35em] text-white/30">
          Parol Editor / {currentWorkspace.name}

          {nodeChain.map((node) => (
            <span key={node.id}>
              {" / "}
              {displayName(node)}
            </span>
          ))}
        </div>

        <div className="mt-5 flex items-end justify-between">
          <div>
            <h1 className="font-serif text-6xl font-light">
              {title}
            </h1>
            {titleOriginal && (
              <p className="mt-2 text-[11px] uppercase tracking-[0.3em] text-white/30">
                {titleOriginal}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <SaveButton />
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

        {nodeChain.some((node) => node.locked) ? (
          <section className="mx-auto mt-16 max-w-md rounded-3xl border-2 border-[#ff3b41] bg-[#ff3b41]/[0.06] px-8 py-12 text-center shadow-[0_0_30px_rgba(255,59,65,0.25)]">
            <p className="text-4xl">🔒</p>
            <h2 className="mt-4 font-serif text-3xl font-light">
              This design is locked
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/50">
              It can't be opened or changed right now. Ask your teacher to
              unlock it in the Developer Window.
            </p>
            <button
              onClick={() => navigate("/")}
              className="mt-8 cursor-pointer rounded-xl bg-white px-6 py-3 text-sm text-black transition hover:bg-white/90"
            >
              Back to start
            </button>
          </section>
        ) : currentNode?.type === "group" ? (
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
                      aria-selected={!trialOpen && round === r}
                      onClick={() => selectRound(r)}
                      className={`cursor-pointer rounded-xl px-6 py-2.5 font-serif text-sm tracking-wide transition sm:px-9 ${
                        !trialOpen && round === r
                          ? "bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.15)]"
                          : "text-white/50 hover:bg-white/[0.06] hover:text-white"
                      }`}
                    >
                      Round {r}
                    </button>
                  ))}

                  <span
                    aria-hidden="true"
                    className="mx-1 my-2 w-px bg-white/10"
                  />

                  <button
                    role="tab"
                    aria-selected={trialOpen}
                    onClick={() => setTrialOpen(true)}
                    className={`cursor-pointer rounded-xl px-6 py-2.5 font-serif text-sm tracking-wide transition sm:px-9 ${
                      trialOpen
                        ? "bg-amber-100 text-black shadow-[0_0_20px_rgba(253,230,138,0.25)]"
                        : "text-amber-100/60 hover:bg-white/[0.06] hover:text-amber-100"
                    }`}
                  >
                    Trial
                  </button>
                </div>

                {!trialOpen && round > 1 && (
                  <p className="text-xs text-white/30">
                    Zone Map and Pins are set up once in Round 1 and shared by
                    every round. This round has its own song, keyframes and
                    code.
                  </p>
                )}
              </div>

              {/* Step tabs */}
              {!trialOpen && (
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
              )}
            </div>

            {!trialOpen && remapSummary && (
              <PinRemapNotice
                summary={remapSummary}
                rounds={ROUNDS}
                onApply={applyPinRemap}
                onKeep={keepKeyframes}
              />
            )}

            {trialOpen && (
              <TrialWorkspace
                groupNode={currentNode}
                songNodes={songNodes}
                onApply={applyTrial}
              />
            )}

            {!trialOpen && round === 1 && groupTab === "zones" && (
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

            {!trialOpen && round === 1 && groupTab === "pins" && (
              <PinSetup
                node={currentNode}
                onPinMappingsChange={(pinMappings: PinMapping[]) =>
                  setNodePinMappings(currentNode.id, pinMappings)
                }
                onGoToZoneMap={() => setGroupTab("zones")}
              />
            )}

            {!trialOpen && groupTab === "song" && animationChild && (
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
                  // A new song starts with no keyframes and no tempo changes.
                  setNodeFrames(animationChild.id, []);
                  setNodeTiming(animationChild.id, { bpmChanges: undefined });
                }}
                onFreshAnalysis={(analysis: AudioAnalysis) =>
                  setNodeAudioOriginal(animationChild.id, analysis)
                }
                onTempoChange={(analysis: AudioAnalysis) => {
                  setNodeAudio(
                    animationChild.id,
                    animationChild.audioFileName ?? "",
                    analysis,
                  );
                  // The base beats were redone, so any BPM change points on the
                  // timeline are cleared (the Song tab asked first).
                  setNodeTiming(animationChild.id, { bpmChanges: undefined });
                  // Beat timing: the keyframes follow the beats. Manual
                  // timing: they stay exactly where they are.
                  if ((animationChild.timingMode ?? "beat") !== "manual") {
                    setNodeFrames(
                      animationChild.id,
                      remapFramesToBeats(
                        animationChild.frames ?? [],
                        analysis.beatTimes,
                      ),
                    );
                  }
                }}
                onClear={() => {
                  clearNodeAudio(animationChild.id);
                  setNodeFrames(animationChild.id, []);
                }}
                frameCount={(animationChild.frames ?? []).length}
                bpmChangeCount={(animationChild.bpmChanges ?? []).length}
                onResetKeyframes={() =>
                  setNodeFrames(animationChild.id, [])
                }
              />
            )}

            {!trialOpen && groupTab === "preview" && animationChild && (
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
                  onTimingChange={(timing) =>
                    setNodeTiming(animationChild.id, timing)
                  }
                />
              </div>
            )}

            {!trialOpen && groupTab === "gallery" && animationChild && (
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

            {!trialOpen && groupTab === "code" && animationChild && (
              <CodeGenerator
                key={animationChild.id}
                round={round}
                pinMappings={
                  currentNode.pinMappings ?? []
                }
                tricolorGroups={
                  currentNode.tricolorGroups ?? []
                }
                zones={currentNode.zones ?? []}
                frames={animationChild.frames ?? []}
                audioAnalysis={
                  animationChild.audioAnalysis
                }
                bpmChanges={animationChild.bpmChanges}
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
                  setNodeTiming(currentNode.id, { bpmChanges: undefined });
                }}
                onFreshAnalysis={(analysis: AudioAnalysis) =>
                  setNodeAudioOriginal(currentNode.id, analysis)
                }
                onTempoChange={(analysis: AudioAnalysis) => {
                  setNodeAudio(
                    currentNode.id,
                    currentNode.audioFileName ?? "",
                    analysis,
                  );
                  setNodeTiming(currentNode.id, { bpmChanges: undefined });
                  if ((currentNode.timingMode ?? "beat") !== "manual") {
                    setNodeFrames(
                      currentNode.id,
                      remapFramesToBeats(
                        currentNode.frames ?? [],
                        analysis.beatTimes,
                      ),
                    );
                  }
                }}
                bpmChangeCount={(currentNode.bpmChanges ?? []).length}
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
                  onClick={() => {
                    if (item.locked) {
                      window.alert(
                        `"${item.name}" is locked. Ask your teacher to unlock it.`,
                      );
                      return;
                    }
                    openNode(item.id);
                  }}
                  className={`absolute inset-0 w-full rounded-2xl border p-7 text-left transition duration-500 ${
                    item.locked
                      ? "cursor-not-allowed border-2 border-[#ff3b41] bg-[#ff3b41]/[0.05] shadow-[0_0_18px_rgba(255,59,65,0.3)]"
                      : "cursor-pointer border-white/10 bg-white/[0.03] hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.06]"
                  }`}
                >
                  <div className="flex h-full flex-col justify-end">
                    <p
                      className={`text-[10px] uppercase tracking-[0.3em] ${
                        item.locked ? "text-[#ff8a8e]" : "text-white/30"
                      }`}
                    >
                      {item.locked ? "🔒 Locked · " : ""}
                      {typeLabels[item.type]}
                    </p>

                    <h2 className="mt-2 font-serif text-3xl font-light">
                      {displayName(item)}
                    </h2>
                    {originalNameIfRenamed(item) && (
                      <p className="mt-1 text-[11px] uppercase tracking-[0.25em] text-white/30">
                        {originalNameIfRenamed(item)}
                      </p>
                    )}
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
