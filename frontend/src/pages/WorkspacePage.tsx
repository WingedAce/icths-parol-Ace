import { useEffect, useRef, useState } from "react";

import { useNavigate, useParams } from "react-router";

import { useProjects } from "../context/ProjectContext";

import parolIcon from "../assets/parol-icon.png";

import ZoneMapper from "../components/ZoneMapper";
import ConfirmDialog from "../components/ConfirmDialog.tsx";

import PinSetup from "../components/PinSetup";

import AudioUploader from "../components/AudioUploader";

import SequenceEditor from "../components/SequenceEditor";
import GroupPresence from "../components/GroupPresence";

import Brand from "../components/Brand";
import WinterBackdrop from "../components/WinterBackdrop";
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
import SpecialRoundPanel from "../components/SpecialRoundPanel";
import PracticeHome from "../components/PracticeHome";
import Logbook, { LogbookReplaceDialog } from "../components/Logbook";
import {
  LOGBOOK_MAX,
  copyAudioToLogbook,
  makeLogbookEntry,
  removeLogbookAudio,
} from "../lib/logbook";
import {
  TimedCountdown,
  TimedPaused,
  TimedSidebar,
} from "../components/TimedMode";
import { useTimedSession, TIMED_MINUTES } from "../lib/timedSession";
import type { TimedMinutes } from "../lib/timedSession";
import type { PracticeMode } from "../components/PracticeHome";
import { useSpecialRound } from "../lib/useSpecialRound";
import { SPECIAL_SONG_ID } from "../lib/specialRound";
import { toClip } from "../utils/keyframeClipboard";
import type { DesignPiece, RoundPiece } from "../components/TrialWorkspace";

import { remapFramesToBeats } from "../utils/audioTiming";
import { displayName, originalNameIfRenamed } from "../utils/parolName";

import type { AudioAnalysis, Frame, SavedTransition } from "../types";

import type {
  LogbookEntry,
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
    setNodeExtras,
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
  const baseRound: Round =
    roundState.path === pathKey ? roundState.round : readUi(storeKey).round;
  // The Trial tab: a sandbox next to the three rounds (see TrialWorkspace).
  const [trialState, setTrialState] = useState<{ path: string; open: boolean }>(
    () => ({ path: pathKey, open: readUi(storeKey).trial }),
  );
  const trialTabOpen: boolean =
    trialState.path === pathKey ? trialState.open : readUi(storeKey).trial;
  // The Special Round tab, next to Trial. Not remembered between visits.
  const [specialState, setSpecialState] = useState<{ path: string; open: boolean }>(
    { path: pathKey, open: false },
  );
  const specialOpen: boolean =
    specialState.path === pathKey && specialState.open;
  const special = useSpecialRound();
  // The Special Round works like a round (Song, Preview, Gallery, Code) only
  // while a developer has it unlocked. Before that, only the locked screen
  // (countdown) or, once the countdown has ended, the "wait for the system
  // confirmation" screen is shown.
  const specialUsable = special.unlocked;
  const specialGate = specialOpen && !specialUsable;
  const specialPlaying = specialOpen && specialUsable;
  // The round being worked on. 4 = the Special Round (its own song slot,
  // keyframes and code; Zone Map and Pins are the group's shared ones).
  // The Practice tab (5) is a normal round-like slot of its own next to it.
  // Practice is its own workspace: it first shows the Timed mode / Free
  // practice cards ("choose"), and hides the Round 1-3, Trial and Special
  // Round tabs the whole time it is open. Not remembered between visits.
  const [practiceState, setPracticeState] = useState<{
    path: string;
    open: boolean;
    mode: PracticeMode;
  }>({ path: pathKey, open: false, mode: "choose" });
  const practiceOpen: boolean =
    practiceState.path === pathKey && practiceState.open;
  const practiceMode: PracticeMode = practiceOpen
    ? practiceState.mode
    : "choose";
  // Timed mode: its own song slot (round 6), a 10 second countdown after the
  // song is analyzed, then a 30 / 20 / 15 minute timer. See lib/timedSession.
  const timedActive: boolean = practiceOpen && practiceMode === "timed";
  const timed = useTimedSession(`parol-timed:${workspaceId ?? ""}:${pathKey}`);
  const [timedMinutes, setTimedMinutes] = useState<TimedMinutes>(TIMED_MINUTES[0]);
  const [timedConfirm, setTimedConfirm] = useState<"quit" | "restart" | null>(
    null,
  );
  const timedPaused = timedActive && timed.status === "paused";
  const timedCountdown = timedActive && timed.status === "countdown";
  const timedFinished = timedActive && timed.status === "finished";
  // While the countdown runs or after time is up, nothing may be edited.
  const timedFrozen = timedCountdown || timedFinished;
  // Once the timer is on (counting down, running or paused) the only ways out
  // are Pause -> Quit, so the Back button is hidden.
  const timerHoldsBack =
    timedActive &&
    (timed.status === "countdown" ||
      timed.status === "running" ||
      timed.status === "paused");
  // Free practice and a running Timed mode show the round-style steps (Song,
  // Preview, ...). The two cards and the paused screen show none of them.
  const practiceChoosing: boolean =
    practiceOpen &&
    (practiceMode === "choose" || practiceMode === "logbook" || timedPaused);
  // Saving a finished attempt to the logbook (asks which one to replace when
  // the logbook already holds three).
  const [logbookPicking, setLogbookPicking] = useState(false);
  const [logbookSaving, setLogbookSaving] = useState(false);
  // Transitions saved from a Timed mode / Logbook review, waiting for the
  // Practice slot to exist (see saveTransitionToLibrary).
  const [pendingTransitions, setPendingTransitions] = useState<SavedTransition[]>([]);
  const round: number = specialPlaying
    ? 4
    : practiceOpen
      ? practiceMode === "timed"
        ? 6
        : 5
      : baseRound;
  // Every round-only panel below is hidden while Trial, the Special Round's
  // gate screen, or Practice's start / Timed mode screen is shown.
  const trialOpen: boolean = trialTabOpen || specialGate || practiceChoosing;
  const setTrialOpen = (open: boolean) => {
    setTrialState({ path: pathKey, open });
    writeUi(storeKey, { trial: open });
    // choosing a round or Trial leaves the Special Round and Practice
    setSpecialState({ path: pathKey, open: false });
    setPracticeState({ path: pathKey, open: false, mode: "choose" });
  };
  const openSpecial = () => {
    setTrialState({ path: pathKey, open: false });
    writeUi(storeKey, { trial: false });
    setPracticeState({ path: pathKey, open: false, mode: "choose" });
    setSpecialState({ path: pathKey, open: true });
  };
  const openPractice = () => {
    setTrialState({ path: pathKey, open: false });
    writeUi(storeKey, { trial: false });
    setSpecialState({ path: pathKey, open: false });
    setPracticeState({ path: pathKey, open: true, mode: "choose" });
  };
  const setPracticeMode = (mode: PracticeMode) =>
    setPracticeState({ path: pathKey, open: true, mode });
  // Back: from a mode to the two cards, from the cards to the rounds.
  const practiceBack = () => {
    if (practiceMode === "choose") {
      setPracticeState({ path: pathKey, open: false, mode: "choose" });
    } else {
      setPracticeMode("choose");
    }
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
      <main className="min-h-screen bg-canvas p-10 text-fg">
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
        <main className="min-h-screen bg-canvas p-10 text-fg">
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
  const songSlot =
    currentNode?.type === "group"
      ? getChildren(currentNode.id).find(
          (item) =>
            item.type === "animation" && (item.round ?? 1) === round,
        )
      : undefined;
  // The group's Practice slot (round 5) holds its saved transitions, which
  // the Special Round can import.
  const practiceSlot =
    currentNode?.type === "group"
      ? getChildren(currentNode.id).find(
          (item) =>
            item.type === "animation" && (item.round ?? 1) === 5,
        )
      : undefined;
  // The group's Timed mode slot (round 6): the attempt in progress, and the
  // logbook of attempts kept from earlier ones.
  const timedSlot =
    currentNode?.type === "group"
      ? getChildren(currentNode.id).find(
          (item) =>
            item.type === "animation" && (item.round ?? 1) === 6,
        )
      : undefined;
  const logbookEntries: LogbookEntry[] = timedSlot?.logbook ?? [];

  // Transitions labelled while reviewing a Timed mode attempt or a Logbook
  // entry. They go into the group's transition library (on the Practice slot),
  // which is separate from the attempt, so they stay even if the attempt is
  // never saved or is deleted later. If the Practice slot doesn't exist yet it
  // is made first and the transitions wait here until it does.
  function saveTransitionToLibrary(name: string, picked: Frame[]) {
    setPendingTransitions((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        name,
        createdAt: Date.now(),
        frames: toClip(picked),
      },
    ]);
    ensureSongSlot(5);
  }

  // Keeps the finished attempt: a full copy of its song, keyframes and timing
  // (plus the song file), so it survives the Timed mode slot being cleared.
  async function saveAttemptToLogbook(replaceId?: string) {
    if (!timedSlot || logbookSaving) return;
    setLogbookSaving(true);
    setLogbookPicking(false);
    const entry = makeLogbookEntry(
      timedSlot,
      timed.session.status === "idle" ? timedMinutes : timed.session.minutes,
    );
    await copyAudioToLogbook(timedSlot.id, entry.id);
    const next = replaceId
      ? logbookEntries.map((e) => (e.id === replaceId ? entry : e))
      : [...logbookEntries, entry];
    setNodeExtras(timedSlot.id, { logbook: next });
    if (replaceId) removeLogbookAudio(replaceId);
    timed.markLogged();
    setLogbookSaving(false);
  }

  function deleteLogbookEntry(id: string) {
    if (!timedSlot) return;
    setNodeExtras(timedSlot.id, {
      logbook: logbookEntries.filter((e) => e.id !== id),
    });
    removeLogbookAudio(id);
  }
  // The Special Round's song is the ONE song the developer uploaded for every
  // group. It is laid over the group's own slot for display only (never saved
  // into the group), so the group keeps its own keyframes and nothing else.
  const animationChild =
    songSlot && round === 4
      ? {
          ...songSlot,
          audioFileName: special.song?.fileName,
          audioAnalysis: special.song?.analysis,
          audioAnalysisOriginal: special.song?.original,
        }
      : songSlot;

  // Makes the song slot of a round the first time it is needed.
  function ensureSongSlot(forRound: number) {
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
    <main className="winter-app isolate min-h-screen bg-canvas text-fg">
      <WinterBackdrop variant="quiet" lowQualityNoSnow />
      <header className="ws-header sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-6 md:px-12 lg:px-20">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              aria-label="Back"
              className="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-elevated hover:text-fg"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <Brand />
          </div>

          <div className="flex items-center gap-2">
            {currentNode?.type === "group" && (
              <GroupPresence groupId={currentNode.id} />
            )}
            <SaveButton />
            {!currentNode && (
              <>
                <button
                  onClick={handleRenameWorkspace}
                  className="rounded-full bg-elevated px-4 py-1.5 text-sm text-fg-soft transition hover:bg-line-strong hover:text-fg"
                >
                  Rename
                </button>

                <button
                  onClick={handleDeleteWorkspace}
                  className="rounded-full bg-elevated px-4 py-1.5 text-sm text-holly-soft transition hover:bg-line-strong"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 pb-28 pt-12 md:px-12 lg:px-20">
        <SongSlotGuard
          active={
            currentNode?.type === "group" &&
            needsSongSlot(groupTab) &&
            !practiceChoosing &&
            !animationChild &&
            !currentNode.locked
          }
          onEnsure={() => ensureSongSlot(round)}
        />
        <SongSlotGuard
          active={!!practiceSlot && pendingTransitions.length > 0}
          onEnsure={() => {
            if (!practiceSlot) return;
            const toAdd = pendingTransitions;
            setPendingTransitions([]);
            setNodeExtras(practiceSlot.id, {
              transitions: [...(practiceSlot.transitions ?? []), ...toAdd],
            });
          }}
        />
        {/* After "Remove Special Round song": this group's Special Round
            keyframes are cleared once, then it is marked as up to date. */}
        <SongSlotGuard
          active={
            specialPlaying &&
            !!songSlot &&
            special.loaded &&
            (songSlot.specialEpoch ?? 0) < special.epoch
          }
          onEnsure={() => {
            if (!songSlot) return;
            if ((songSlot.frames ?? []).length > 0) setNodeFrames(songSlot.id, []);
            setNodeExtras(songSlot.id, { specialEpoch: special.epoch });
          }}
        />

        <p className="text-sm text-fg-muted">
          {currentWorkspace.name}
          {nodeChain.map((node) => (
            <span key={node.id}>
              {" / "}
              {displayName(node)}
            </span>
          ))}
        </p>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">
              {title}
            </h1>
            {titleOriginal && (
              <p className="mt-3 text-sm text-fg-muted">{titleOriginal}</p>
            )}
          </div>

          {childType && currentNode?.type !== "group" && (
            <span className="pb-2 text-sm text-fg-muted">
              {currentItems.length} {typeLabels[childType].toLowerCase()}
              {currentItems.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>


        {nodeChain.some((node) => node.locked) ? (
          <section className="mx-auto mt-16 max-w-md rounded-xl border border-holly/60 bg-surface px-8 py-12 text-center">
            <p className="text-4xl">🔒</p>
            <h2 className="mt-4 font-semibold tracking-tight text-3xl">
              This design is locked
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-fg-muted">
              It can't be opened or changed right now. Ask your teacher to
              unlock it in the Developer Window.
            </p>
            <button
              onClick={() => navigate("/")}
              className="mt-8 cursor-pointer rounded-xl bg-fg px-6 py-3 text-sm text-canvas transition hover:bg-fg/90"
            >
              Back to start
            </button>
          </section>
        ) : currentNode?.type === "group" ? (
          <section className={`mt-12${specialPlaying ? " sr-scope" : ""}`}>
            <div className="mb-10">
              {/* Practice has its own header: just a way back. */}
              {practiceOpen && (
                <div className="mb-8 flex flex-wrap items-center gap-x-5 gap-y-3">
                  {!timerHoldsBack ? (
                  <button
                    type="button"
                    onClick={practiceBack}
                    className="cursor-pointer rounded-lg bg-surface px-4 py-2 text-sm font-medium text-fg-soft transition hover:bg-elevated hover:text-fg"
                  >
                    &larr; Back
                  </button>
                  ) : null}
                  <p className="text-sm font-medium text-fg">
                    Practice
                    {practiceMode === "timed" && " · Timed mode"}
                    {practiceMode === "free" && " · Free practice"}
                    {practiceMode === "logbook" && " · Logbook"}
                  </p>
                </div>
              )}

              {/* Round picker */}
              {!practiceOpen && (
              <div className="sr-picker mb-8 flex flex-col items-start gap-3">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <div
                  role="tablist"
                  aria-label="Round"
                  className="inline-flex rounded-lg bg-surface p-1"
                >
                  {ROUNDS.map((r) => (
                    <button
                      key={r}
                      role="tab"
                      aria-selected={!trialOpen && round === r}
                      onClick={() => selectRound(r)}
                      className={`rounded-md px-5 py-2 text-sm font-medium transition sm:px-8 ${
                        !trialOpen && round === r
                          ? "bg-elevated text-fg"
                          : "text-fg-muted hover:text-fg"
                      }`}
                    >
                      Round {r}
                    </button>
                  ))}

                  <span
                    aria-hidden="true"
                    className="mx-1 my-2 w-px bg-line"
                  />

                  <button
                    role="tab"
                    aria-selected={trialTabOpen}
                    onClick={() => setTrialOpen(true)}
                    className={`rounded-md px-5 py-2 text-sm font-medium transition sm:px-8 ${
                      trialTabOpen
                        ? "bg-pine text-fg"
                        : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    Trial
                  </button>
                </div>

                <button
                  type="button"
                  aria-pressed={specialOpen}
                  onClick={openSpecial}
                  className="sr-tab"
                >
                  Special Round
                </button>

                <div
                  role="tablist"
                  aria-label="Practice"
                  className="inline-flex rounded-lg bg-surface p-1"
                >
                  <button
                    role="tab"
                    aria-selected={practiceOpen}
                    onClick={openPractice}
                    className={`rounded-md px-5 py-2 text-sm font-medium transition sm:px-8 ${
                      practiceOpen
                        ? "bg-pine text-fg"
                        : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    Practice
                  </button>
                </div>
                </div>

                {!trialOpen && round > 1 && (
                  <p className="text-xs text-fg-muted">
                    Zone Map and Pins are set up once in Round 1 and shared by
                    every round. This round has its own song, keyframes and
                    code.
                  </p>
                )}
              </div>
              )}

              {/* Step tabs */}
              {!trialOpen && (
              <div
                role="tablist"
                aria-label="Steps"
                className="ws-tabs"
              >
                {GROUP_TABS.filter((tab) => round === 1 || !tab.round1Only).map(
                  (tab) => (
                    <button
                      key={tab.id}
                      role="tab"
                      aria-selected={groupTab === tab.id}
                      onClick={() => selectTab(tab.id)}
                      className="ws-tab"
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

            {timedCountdown && (
              <TimedCountdown secondsLeft={timed.countdownLeft} />
            )}

            {timedPaused && (
              <TimedPaused
                remainingMs={timed.remainingMs}
                onPlay={timed.play}
                onQuit={() => setTimedConfirm("quit")}
              />
            )}

            <div
              className={
                timedActive && !timedPaused
                  ? "flex flex-col gap-8 lg:flex-row lg:items-start"
                  : undefined
              }
            >
            {timedActive && !timedPaused && (
              <TimedSidebar
                status={timed.status}
                minutes={
                  timed.session.status === "idle"
                    ? timedMinutes
                    : timed.session.minutes
                }
                remainingMs={timed.remainingMs}
                onPickMinutes={setTimedMinutes}
                onPause={timed.pause}
                onNewSession={() => setTimedConfirm("restart")}
                logged={timed.logged}
                saving={logbookSaving}
                onSaveToLogbook={() =>
                  logbookEntries.length >= LOGBOOK_MAX
                    ? setLogbookPicking(true)
                    : void saveAttemptToLogbook()
                }
              />
            )}
            <div
              className={timedActive ? "min-w-0 flex-1" : undefined}
              inert={timedCountdown || undefined}
            >
            {specialOpen && (
              <SpecialRoundPanel
                clockOffset={special.clockOffset}
              />
            )}

            {practiceOpen && practiceMode === "choose" && (
              <PracticeHome onPick={setPracticeMode} />
            )}

            {practiceOpen && practiceMode === "logbook" && (
              <Logbook
                groupNode={currentNode}
                entries={logbookEntries}
                onDelete={deleteLogbookEntry}
                onSaveTransition={saveTransitionToLibrary}
                existingTransitionNames={[
                  ...(practiceSlot?.transitions ?? []).map((t) => t.name),
                  ...pendingTransitions.map((t) => t.name),
                ]}
              />
            )}

            {trialTabOpen && (
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
                    className={`mx-auto flex max-w-xl flex-col items-center justify-center rounded-xl border border-dashed px-10 py-16 text-center transition ${
                      isDragging
                        ? "bg-line-strong"
                        : "bg-elevated"
                    }`}
                  >
                    <img
                      src={parolIcon}
                      alt=""
                      className="mb-6 h-20 w-20 object-contain opacity-90"
                    />

                    <p className="text-fg-soft">
                      Drop your image here, or{" "}
                      <button
                        onClick={() =>
                          fileInputRef.current?.click()
                        }
                        className="cursor-pointer text-fg underline underline-offset-2 hover:text-fg"
                      >
                        browse
                      </button>
                    </p>

                    <p className="mt-2 text-xs text-fg-muted">
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
                      className="cursor-pointer rounded-full px-4 py-1.5 text-xs text-fg-soft transition hover:text-fg bg-elevated hover:bg-line-strong"
                    >
                      Upload another image
                    </button>
                    <button
                      onClick={handleRemoveImage}
                      className="cursor-pointer rounded-lg border border-holly/20 px-4 py-1.5 text-xs text-holly-soft transition hover:border-holly/40 hover:text-holly-soft"
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

            {!trialOpen && groupTab === "song" && animationChild && round === 4 && (
              <div className="sr-song-card">
                <p className="sr-kicker">Special Round song</p>
                {special.song ? (
                  <>
                    <p className="sr-song-name">{special.song.fileName || "Special Round song"}</p>
                    <p className="sr-wait-note">
                      This song is the same for every group and is set by your
                      teacher. Go to Preview to place your keyframes.
                    </p>
                    <button
                      type="button"
                      onClick={() => selectTab("preview")}
                      className="mt-5 cursor-pointer rounded-lg bg-fg px-5 py-2.5 text-sm text-canvas transition hover:bg-fg/90"
                    >
                      Go to Preview
                    </button>
                  </>
                ) : (
                  <p className="sr-wait-note">
                    The Special Round song hasn't been added yet. Wait for your
                    teacher, this page updates by itself.
                  </p>
                )}
              </div>
            )}

            {!trialOpen && groupTab === "song" && animationChild && round !== 4 && (
              <div inert={timedFinished || undefined}>
              <AudioUploader
                key={animationChild.id}
                node={animationChild}
                maxClipSeconds={round === 5 || round === 6 ? 60 : undefined}
                rollSongs={round === 5 || round === 6}
                onAnalyzed={(
                  fileName: string,
                  analysis: AudioAnalysis,
                  resetKeyframes: boolean,
                ) => {
                  setNodeAudio(
                    animationChild.id,
                    fileName,
                    analysis,
                  );
                  // Keyframes are only cleared when the student explicitly chose
                  // "Reset keyframes" in the Change Song dialog.
                  if (resetKeyframes) setNodeFrames(animationChild.id, []);
                  // Tempo changes belong to the old song's beats, so they start over.
                  setNodeTiming(animationChild.id, { bpmChanges: undefined });
                  // Timed mode: the song is analyzed, so the 10 second
                  // countdown (then the timer) starts now.
                  if (timedActive && timed.status === "idle") {
                    timed.start(timedMinutes);
                  }
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
              </div>
            )}

            {!trialOpen && groupTab === "preview" && animationChild && (
              <div className="mx-auto max-w-3xl">
                <SequenceEditor
                  key={`${animationChild.id}:${round === 4 ? special.songVersion ?? "" : ""}`}
                  audioSourceId={round === 4 ? SPECIAL_SONG_ID : undefined}
                  readOnly={timedFinished}
                  arrowKeys
                  groupNode={currentNode}
                  animationNode={animationChild}
                  onFramesChange={(frames) => {
                    if (!timedFrozen) setNodeFrames(animationChild.id, frames);
                  }}
                  onTimingChange={(timing) => {
                    if (!timedFrozen) setNodeTiming(animationChild.id, timing);
                  }}
                  onSaveTransition={
                    round === 6
                      ? timedFinished
                        ? saveTransitionToLibrary
                        : undefined
                      : round === 5
                      ? (name, picked) =>
                          setNodeExtras(animationChild.id, {
                            transitions: [
                              ...(animationChild.transitions ?? []),
                              {
                                id: crypto.randomUUID(),
                                name,
                                createdAt: Date.now(),
                                frames: toClip(picked),
                              },
                            ],
                          })
                      : undefined
                  }
                  existingTransitionNames={
                    round === 5
                      ? (animationChild.transitions ?? []).map((t) => t.name)
                      : round === 6
                        ? (practiceSlot?.transitions ?? []).map((t) => t.name)
                        : undefined
                  }
                  transitionLibrary={
                    round === 4 || round === 5 || round === 6
                      ? (practiceSlot?.transitions ?? [])
                      : undefined
                  }
                />
              </div>
            )}

            {!trialOpen && groupTab === "gallery" && animationChild && (
              <div className="mx-auto max-w-5xl" inert={timedFinished || undefined}>
                <KeyframeGallery
                  key={animationChild.id}
                  groupNode={currentNode}
                  animationNode={animationChild}
                  onFramesChange={(frames) => {
                    if (!timedFrozen) setNodeFrames(animationChild.id, frames);
                  }}
                  transitions={round === 5 ? animationChild.transitions : undefined}
                  onTransitionsChange={
                    round === 5
                      ? (next) =>
                          setNodeExtras(animationChild.id, { transitions: next })
                      : undefined
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
            </div>
            </div>

            {timedConfirm && (
              <ConfirmDialog
                title={
                  timedConfirm === "quit"
                    ? "Quit Timed mode?"
                    : "Start a new timed session?"
                }
                checkboxLabel="I understand"
                confirmLabel={timedConfirm === "quit" ? "Quit" : "Start over"}
                onCancel={() => setTimedConfirm(null)}
                onConfirm={() => {
                  // The session is over: its song and keyframes are thrown
                  // away so the next one starts clean.
                  if (songSlot) {
                    clearNodeAudio(songSlot.id);
                    setNodeFrames(songSlot.id, []);
                  }
                  timed.reset();
                  if (timedConfirm === "quit") setPracticeMode("choose");
                  setTimedConfirm(null);
                }}
              >
                <p>
                  This session's song and keyframes will be thrown away. This
                  can't be undone.
                </p>
                {timedFinished && !timed.logged && (
                  <p className="mt-3">
                    This attempt hasn't been saved to the logbook.
                  </p>
                )}
              </ConfirmDialog>
            )}

            {logbookPicking && (
              <LogbookReplaceDialog
                entries={logbookEntries}
                onPick={(id) => void saveAttemptToLogbook(id)}
                onCancel={() => setLogbookPicking(false)}
              />
            )}
          </section>
        ) : currentNode?.type === "animation" ? (
          <section className="mt-12">
            <p className="text-xs text-fg-muted">
              Animation Editor
            </p>

            <h2 className="mt-3 font-semibold tracking-tight text-4xl">
              {currentNode.name}
            </h2>

            <div className="mt-8">
              <AudioUploader
                node={currentNode}
                frameCount={(currentNode.frames ?? []).length}
                onAnalyzed={(
                  fileName: string,
                  analysis: AudioAnalysis,
                  resetKeyframes: boolean,
                ) => {
                  setNodeAudio(
                    currentNode.id,
                    fileName,
                    analysis,
                  );
                  if (resetKeyframes) setNodeFrames(currentNode.id, []);
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

            <p className="mt-8 text-fg-muted">
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
                  className={`absolute inset-0 w-full rounded-xl border p-7 text-left transition duration-200 ${
                    item.locked
                      ? "cursor-not-allowed border border-holly/60 bg-surface "
                      : "cursor-pointer bg-elevated hover:bg-elevated"
                  }`}
                >
                  <div className="flex h-full flex-col justify-end">
                    <p
                      className={`text-xs ${
                        item.locked ? "text-holly-soft" : "text-fg-muted"
                      }`}
                    >
                      {item.locked ? "🔒 Locked · " : ""}
                      {typeLabels[item.type]}
                    </p>

                    <h2 className="mt-2 font-semibold tracking-tight text-3xl">
                      {displayName(item)}
                    </h2>
                    {originalNameIfRenamed(item) && (
                      <p className="mt-1 text-xs text-fg-muted">
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
                    className="cursor-pointer rounded-lg bg-canvas/90 px-3 py-2 text-xs text-fg-muted hover:text-fg"
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
                    className="cursor-pointer rounded-lg bg-canvas/90 px-3 py-2 text-xs text-fg-muted hover:text-fg"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}

            {childType && (
              <button
                onClick={() => setIsNewOpen(true)}
                className="aspect-[4/3] w-full cursor-pointer rounded-xl border border-dashed border-line bg-surface transition duration-200 hover:border-line-strong hover:bg-elevated"
              >
                <span className="flex h-full flex-col items-center justify-center">
                  <span className="text-5xl font-light text-fg-muted">
                    +
                  </span>

                  <span className="mt-3 text-xs text-fg-muted">
                    New
                  </span>
                </span>
              </button>
            )}
          </div>
        )}

        {isNewOpen && childType && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-xl bg-surface p-8">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold tracking-tight text-3xl">
                  New {typeLabels[childType]}
                </h2>

                <button
                  onClick={() => {
                    setIsNewOpen(false);
                    setNewName("");
                  }}
                  className="cursor-pointer text-fg-muted hover:text-fg"
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
                className="mt-8 w-full rounded-lg border px-4 py-3 text-fg outline-none placeholder:text-fg-muted focus:border-line-hover border-transparent bg-elevated"
              />

              <button
                onClick={createItem}
                className="mt-4 w-full cursor-pointer rounded-lg bg-fg px-4 py-3 text-canvas transition hover:bg-fg/90"
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
