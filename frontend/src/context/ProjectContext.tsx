
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { workspaces as initialWorkspaces } from "../data/workspaces";
import {
  deleteImage,
  listImageStamps,
  loadAllImages,
  loadImage,
  saveImage,
} from "../lib/imageStore";
import {
  fetchAllNodeRows,
  fetchCloud,
  fetchNodesByIds,
  fetchStamps,
  fetchWorkspaces,
  nodeKey,
  pushNodes,
  pushWorkspaces,
  rowKey,
  rowToNode,
  workspaceKey,
  type NodeRow,
} from "../lib/cloudSync";
import { ensureSession } from "../lib/supabase";
import type {
  AudioAnalysis,
  BpmChange,
  Frame,
  NodeType,
  PinMapping,
  ProjectNode,
  TimingMode,
  TricolorGroup,
  Workspace,
  WorkspaceType,
  Zone,
} from "../types";

export type SyncStatus = "loading" | "synced" | "saving" | "error";

// How often each open screen checks whether another device changed anything.
const POLL_MS = 10_000;
// Wait this long after the last edit before saving (so typing isn't spammy).
const PUSH_DEBOUNCE_MS = 200;

type ProjectContextType = {
  syncStatus: SyncStatus;
  workspaces: Workspace[];
  getChildren: (parentId: string) => ProjectNode[];
  getNode: (id: string) => ProjectNode | undefined;
  addWorkspace: (name: string, type: WorkspaceType) => string;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => void;
  addNode: (
    parentId: string,
    name: string,
    type: NodeType,
    round?: number,
  ) => string;
  renameNode: (id: string, name: string) => void;
  deleteNode: (id: string) => void;
  setNodeImage: (id: string, imageDataUrl: string) => Promise<void>;
  removeNodeImage: (id: string) => void;
  setNodeZones: (
    id: string,
    zones: Zone[],
    imageWidth: number,
    imageHeight: number,
  ) => void;
  setNodePinMappings: (id: string, pinMappings: PinMapping[]) => void;
  setNodeTricolorGroups: (id: string, groups: TricolorGroup[]) => void;
  clearNodeZones: (id: string) => void;
  setNodeAudio: (
    id: string,
    audioFileName: string,
    audioAnalysis: AudioAnalysis,
  ) => void;
  setNodeAudioOriginal: (
    id: string,
    audioAnalysisOriginal: AudioAnalysis,
  ) => void;
  clearNodeAudio: (id: string) => void;
  setNodeFrames: (id: string, frames: Frame[]) => void;
  setNodeTiming: (
    id: string,
    timing: { timingMode?: TimingMode; bpmChanges?: BpmChange[] },
  ) => void;
  setNodesLocked: (ids: string[], locked: boolean) => void;
};

const ProjectContext = createContext<ProjectContextType | null>(null);

function deleteBranch(
  nodes: Record<string, ProjectNode[]>,
  parentId: string,
  removedIds: string[] = [],
) {
  const children = nodes[parentId] ?? [];

  delete nodes[parentId];

  for (const child of children) {
    removedIds.push(child.id);
    deleteBranch(nodes, child.id, removedIds);
  }

  return removedIds;
}

type RemoteNodes = {
  // fingerprints of what the server held when we last synced
  oldKeys: Map<string, string>;
  // rows that changed on the server since then
  rowById: Map<string, NodeRow>;
  // every node id that exists on the server right now
  remoteIds: Set<string>;
  // ids where the server's version must win even over local edits
  force: Set<string>;
  // drawings that were added/changed (url) or removed (null) elsewhere
  imageUpdates: Map<string, string | null>;
};

// Folds what OTHER devices changed into this device's screen, without ever
// overwriting something this device has edited but not finished saving yet.
function mergeRemoteNodes(
  prev: Record<string, ProjectNode[]>,
  ctx: RemoteNodes,
): Record<string, ProjectNode[]> {
  const { oldKeys, rowById, remoteIds, force, imageUpdates } = ctx;

  let changed = false;
  const kept: ProjectNode[] = [];
  const seen = new Set<string>();

  for (const list of Object.values(prev)) {
    for (const node of list) {
      seen.add(node.id);

      // "Dirty" = edited here and not saved yet. Those edits win.
      const dirty = !force.has(node.id) && oldKeys.get(node.id) !== nodeKey(node);
      let out = node;

      if (!remoteIds.has(node.id)) {
        // Deleted on another device (only if we had it synced and left it alone).
        if (oldKeys.has(node.id) && !dirty) {
          changed = true;
          continue;
        }
      } else {
        const row = rowById.get(node.id);
        if (row && !dirty && rowKey(row) !== nodeKey(node)) {
          out = { ...rowToNode(row), imageDataUrl: node.imageDataUrl };
          changed = true;
        }
      }

      if (imageUpdates.has(node.id)) {
        const url = imageUpdates.get(node.id) ?? undefined;
        if (url !== out.imageDataUrl) {
          out = { ...out, imageDataUrl: url };
          changed = true;
        }
      }

      kept.push(out);
    }
  }

  // Brand-new nodes created on another device. (A node we already knew about
  // but no longer have was deleted HERE and is still waiting to be saved —
  // don't bring it back.)
  const additions = [...rowById.values()]
    .filter((row) => !seen.has(row.id) && !oldKeys.has(row.id))
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));

  for (const row of additions) {
    kept.push({
      ...rowToNode(row),
      imageDataUrl: imageUpdates.get(row.id) ?? undefined,
    });
    changed = true;
  }

  if (!changed) return prev;

  const next: Record<string, ProjectNode[]> = {};
  for (const node of kept) (next[node.parentId] ??= []).push(node);
  return next;
}

function mergeRemoteWorkspaces(
  prev: Workspace[],
  remote: Workspace[],
  oldKeys: Map<string, string>,
): Workspace[] {
  const remoteById = new Map(remote.map((w) => [w.id, w]));
  const out: Workspace[] = [];
  const seen = new Set<string>();
  let changed = false;

  for (const workspace of prev) {
    seen.add(workspace.id);
    const dirty = oldKeys.get(workspace.id) !== workspaceKey(workspace);
    const theirs = remoteById.get(workspace.id);

    if (!theirs) {
      if (oldKeys.has(workspace.id) && !dirty) {
        changed = true; // deleted on another device
        continue;
      }
      out.push(workspace);
    } else if (!dirty && workspaceKey(theirs) !== workspaceKey(workspace)) {
      out.push(theirs);
      changed = true;
    } else {
      out.push(workspace);
    }
  }

  for (const theirs of remote) {
    if (!seen.has(theirs.id) && !oldKeys.has(theirs.id)) {
      out.push(theirs);
      changed = true;
    }
  }

  return changed ? out : prev;
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] =
    useState<Workspace[]>(initialWorkspaces);

  const [nodesByParent, setNodesByParent] =
    useState<Record<string, ProjectNode[]>>({});

  const [cloudLoaded, setCloudLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");

  // Latest values, readable from timers and network callbacks.
  const nodesRef = useRef(nodesByParent);
  const workspacesRef = useRef(workspaces);
  const commitWaiters = useRef<Array<() => void>>([]);

  // What the server is known to hold, as fingerprints, so we only ever send or
  // receive the DIFFERENCES (and one stale screen can't wipe other people's work).
  const syncedNodeKeys = useRef(new Map<string, string>());
  const nodeStamps = useRef(new Map<string, string>());
  const syncedWorkspaceKeys = useRef(new Map<string, string>());
  const imageStamps = useRef(new Map<string, string>());
  const stampsSupported = useRef(true);

  // Saving and checking-for-updates never run at the same time.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(5000);
  const pullQueued = useRef(false);
  const flags = useRef({
    scheduled: false,
    pushing: 0,
    pushError: false,
    pullError: false,
  });

  // The helpers below only touch refs and state setters, so it never matters
  // which render's copy of them a timer happens to call.
  function refreshStatus() {
    const f = flags.current;
    setSyncStatus(
      f.pushError || f.pullError
        ? "error"
        : f.scheduled || f.pushing > 0
          ? "saving"
          : "synced",
    );
  }

  function enqueue(task: () => Promise<void>) {
    chain.current = chain.current.then(task).catch(() => {});
  }

  // Resolves once React has put the latest state on screen (and in nodesRef).
  function waitForCommit() {
    return new Promise<void>((resolve) => {
      commitWaiters.current.push(resolve);
      setTimeout(resolve, 400);
    });
  }

  async function pullTask(force?: Set<string>) {
    try {
      const remoteWorkspaces = await fetchWorkspaces();

      let stamps: Map<string, string> | null = null;
      if (stampsSupported.current) {
        stamps = await fetchStamps();
        if (!stamps) stampsSupported.current = false;
      }

      let rows: NodeRow[];
      let remoteIds: Set<string>;
      if (stamps) {
        remoteIds = new Set(stamps.keys());
        const wanted = [...stamps]
          .filter(
            ([id, stamp]) =>
              nodeStamps.current.get(id) !== stamp || force?.has(id),
          )
          .map(([id]) => id);
        rows = await fetchNodesByIds(wanted);
      } else {
        const all = await fetchAllNodeRows();
        remoteIds = new Set(all.map((row) => row.id));
        rows = all.filter(
          (row) =>
            force?.has(row.id) ||
            syncedNodeKeys.current.get(row.id) !== rowKey(row),
        );
      }

      // Drawings live in Storage: pick up new/changed/removed ones too.
      const files = await listImageStamps();
      const imageUpdates = new Map<string, string | null>();
      const nextImageStamps = new Map(imageStamps.current);

      for (const [name, stamp] of files) {
        if (!remoteIds.has(name) || imageStamps.current.get(name) === stamp) {
          continue;
        }
        try {
          const url = await loadImage(name);
          if (url) {
            imageUpdates.set(name, url);
            nextImageStamps.set(name, stamp);
          }
        } catch (error) {
          console.error("Could not download drawing:", name, error);
        }
      }
      for (const name of [...nextImageStamps.keys()]) {
        if (!files.has(name)) {
          nextImageStamps.delete(name);
          imageUpdates.set(name, null);
        }
      }

      const oldKeys = syncedNodeKeys.current;
      const oldWorkspaceKeys = syncedWorkspaceKeys.current;
      const ctx: RemoteNodes = {
        oldKeys,
        rowById: new Map(rows.map((row) => [row.id, row])),
        remoteIds,
        force: force ?? new Set<string>(),
        imageUpdates,
      };

      const willChange =
        mergeRemoteNodes(nodesRef.current, ctx) !== nodesRef.current ||
        mergeRemoteWorkspaces(
          workspacesRef.current,
          remoteWorkspaces,
          oldWorkspaceKeys,
        ) !== workspacesRef.current;

      // Now we know what the server holds.
      const nextKeys = new Map(oldKeys);
      for (const id of [...nextKeys.keys()]) {
        if (!remoteIds.has(id)) nextKeys.delete(id);
      }
      for (const row of rows) nextKeys.set(row.id, rowKey(row));
      syncedNodeKeys.current = nextKeys;
      if (stamps) nodeStamps.current = new Map(stamps);
      imageStamps.current = nextImageStamps;
      syncedWorkspaceKeys.current = new Map(
        remoteWorkspaces.map((w) => [w.id, workspaceKey(w)]),
      );

      if (willChange) {
        setNodesByParent((prev) => mergeRemoteNodes(prev, ctx));
        setWorkspaces((prev) =>
          mergeRemoteWorkspaces(prev, remoteWorkspaces, oldWorkspaceKeys),
        );
        await waitForCommit();
      }

      flags.current.pullError = false;
    } catch (error) {
      console.error("Could not check for updates from Supabase:", error);
      flags.current.pullError = true;
    } finally {
      refreshStatus();
    }
  }

  function schedulePull() {
    if (pullQueued.current) return;
    pullQueued.current = true;
    enqueue(async () => {
      try {
        await pullTask();
      } finally {
        pullQueued.current = false;
      }
    });
  }

  async function pushTask() {
    flags.current.pushing += 1;
    refreshStatus();

    try {
      syncedWorkspaceKeys.current = await pushWorkspaces(
        syncedWorkspaceKeys.current,
        workspacesRef.current,
      );

      const result = await pushNodes(
        syncedNodeKeys.current,
        nodesRef.current,
        stampsSupported.current,
      );

      const keys = new Map(syncedNodeKeys.current);
      for (const [id, key] of result.keys) keys.set(id, key);
      for (const id of result.deleted) {
        keys.delete(id);
        nodeStamps.current.delete(id);
      }
      syncedNodeKeys.current = keys;
      for (const [id, stamp] of result.stamps) nodeStamps.current.set(id, stamp);

      flags.current.pushError = false;
      retryDelay.current = 5000;

      // The server refused these (an admin locked them): show the server's
      // version instead of leaving a change that can never be saved.
      if (result.rejected.length > 0) {
        const rejected = new Set(result.rejected);
        enqueue(() => pullTask(rejected));
      }
    } catch (error) {
      console.error("Could not save to Supabase:", error);
      flags.current.pushError = true;
      scheduleRetry();
    } finally {
      flags.current.pushing -= 1;
      refreshStatus();
    }
  }

  function scheduleRetry() {
    if (retryTimer.current) return;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      enqueue(pushTask);
    }, retryDelay.current);
    retryDelay.current = Math.min(retryDelay.current * 2, 60_000);
  }

  // Save right now instead of waiting for the usual short delay (used when
  // the page is about to be hidden — phones can freeze a page in the background).
  function flushPush() {
    if (!pushTimer.current) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = null;
    flags.current.scheduled = false;
    enqueue(pushTask);
  }

  // Keep the refs pointing at the latest screen state, and wake anyone
  // waiting for a render to land.
  useEffect(() => {
    nodesRef.current = nodesByParent;
    workspacesRef.current = workspaces;
    const waiters = commitWaiters.current;
    commitWaiters.current = [];
    waiters.forEach((resolve) => resolve());
  }, [nodesByParent, workspaces]);

  // Load cloud data and drawings before enabling writes.
  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      for (let attempt = 0; !cancelled; attempt++) {
        try {
          // No session = Supabase answers with EMPTY lists instead of an
          // error. Never treat that as "no data".
          if (!(await ensureSession())) {
            throw new Error("Could not start a session with Supabase");
          }

          const cloud = await fetchCloud();

          let restoredNodes = cloud.nodes;
          let loadedImageStamps = new Map<string, string>();

          try {
            const { images, stamps } = await loadAllImages();
            loadedImageStamps = stamps;

            restoredNodes = Object.fromEntries(
              Object.entries(cloud.nodes).map(([parentId, parentNodes]) => [
                parentId,
                parentNodes.map((node) =>
                  images[node.id]
                    ? { ...node, imageDataUrl: images[node.id] }
                    : node,
                ),
              ]),
            );
          } catch (error) {
            // The next update check will fetch the drawings again.
            console.error("Could not load drawings from Supabase:", error);
          }

          if (cancelled) return;

          syncedWorkspaceKeys.current = new Map(
            cloud.workspaces.map((w) => [w.id, workspaceKey(w)]),
          );
          syncedNodeKeys.current = cloud.keys;
          nodeStamps.current = cloud.stamps;
          imageStamps.current = loadedImageStamps;
          stampsSupported.current = cloud.stampsSupported;

          setWorkspaces(
            cloud.workspaces.length > 0 ? cloud.workspaces : initialWorkspaces,
          );
          setNodesByParent(restoredNodes);
          setCloudLoaded(true);

          flags.current.pullError = false;
          refreshStatus();
          return;
        } catch (error) {
          console.error("Could not load from Supabase:", error);
          if (cancelled) return;
          setSyncStatus("error");
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(15_000, 2_000 * (attempt + 1))),
          );
        }
      }
    }

    void loadInitialData();

    return () => {
      cancelled = true;
    };
  }, []);

  // Save changes shortly after the last edit.
  useEffect(() => {
    if (!cloudLoaded) return;

    if (pushTimer.current) clearTimeout(pushTimer.current);
    flags.current.scheduled = true;
    refreshStatus();

    pushTimer.current = setTimeout(() => {
      pushTimer.current = null;
      flags.current.scheduled = false;
      enqueue(pushTask);
    }, PUSH_DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesByParent, workspaces, cloudLoaded]);

  // Check for other devices' changes: on a timer while the page is open, and
  // right away when the page comes back into view or the network returns.
  useEffect(() => {
    if (!cloudLoaded) return;

    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible" && stampsSupported.current) {
        schedulePull();
      }
    }, POLL_MS);

    function onVisibility() {
      if (document.visibilityState === "visible") {
        if (flags.current.pushError) enqueue(pushTask);
        schedulePull();
      } else {
        flushPush();
      }
    }
    function onFocus() {
      schedulePull();
    }
    function onOnline() {
      enqueue(pushTask);
      schedulePull();
    }
    function onPageHide() {
      flushPush();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onPageHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudLoaded]);

  useEffect(() => {
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  function addWorkspace(name: string, type: WorkspaceType) {
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name,
      type,
    };

    setWorkspaces((previous) => [...previous, workspace]);

    return workspace.id;
  }

  function renameWorkspace(id: string, name: string) {
    setWorkspaces((previous) =>
      previous.map((workspace) =>
        workspace.id === id ? { ...workspace, name } : workspace,
      ),
    );
  }

  function deleteWorkspace(id: string) {
    setWorkspaces((previous) =>
      previous.filter((workspace) => workspace.id !== id),
    );

    setNodesByParent((previous) => {
      const next = { ...previous };

      const removedIds = deleteBranch(next, id);
      deleteImage(id).catch(() => { });

      for (const removedId of removedIds) {
        deleteImage(removedId).catch(() => { });
      }

      return next;
    });
  }

  function addNode(
    parentId: string,
    name: string,
    type: NodeType,
    round?: number,
  ) {
    const node: ProjectNode = {
      id: crypto.randomUUID(),
      name,
      type,
      parentId,
      ...(round ? { round } : {}),
    };

    setNodesByParent((previous) => {
      // A group has one song slot per round.
      if (
        type === "animation" &&
        (previous[parentId] ?? []).some(
          (item) =>
            item.type === "animation" &&
            (item.round ?? 1) === (round ?? 1),
        )
      ) {
        return previous;
      }

      return {
        ...previous,
        [parentId]: [...(previous[parentId] ?? []), node],
      };
    });

    return node.id;
  }

  function renameNode(id: string, name: string) {
    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) =>
          node.id === id ? { ...node, name } : node,
        );
      }

      return next;
    });
  }

  function deleteNode(id: string) {
    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].filter(
          (node) => node.id !== id,
        );
      }

      const removedIds = deleteBranch(next, id);
      deleteImage(id).catch(() => { });

      for (const removedId of removedIds) {
        deleteImage(removedId).catch(() => { });
      }

      return next;
    });
  }


  async function setNodeImage(id: string, imageDataUrl: string) {
    await saveImage(id, imageDataUrl);

    // Remember this drawing's stamp so our own update check doesn't
    // download the image we just uploaded.
    try {
      const stamp = (await listImageStamps()).get(id);
      if (stamp) imageStamps.current.set(id, stamp);
    } catch {
      // harmless: worst case the next check re-downloads it once
    }

    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) =>
          node.id === id
            ? {
              ...node,
              imageDataUrl,
              zones: undefined,
              imageWidth: undefined,
              imageHeight: undefined,
              pinMappings: [],
              tricolorGroups: [],
            }
            : node,
        );
      }

      return next;
    });
  }


  function removeNodeImage(id: string) {
    imageStamps.current.delete(id);

    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) =>
          node.id === id
            ? {
              ...node,
              imageDataUrl: undefined,
              zones: undefined,
              imageWidth: undefined,
              imageHeight: undefined,
              pinMappings: [],
              tricolorGroups: [],
            }
            : node,
        );
      }

      return next;
    });

    deleteImage(id).catch((error) => {
      console.error("Failed to delete drawing from Supabase Storage:", error);
    });
  }

  function setNodeZones(
    id: string,
    zones: Zone[],
    imageWidth: number,
    imageHeight: number,
  ) {
    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) =>
          node.id === id
            ? {
              ...node,
              zones,
              imageWidth,
              imageHeight,
              pinMappings: [],
              tricolorGroups: [],
            }
            : node,
        );
      }

      return next;
    });
  }

  function setNodePinMappings(id: string, pinMappings: PinMapping[]) {
    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) =>
          node.id === id ? { ...node, pinMappings } : node,
        );
      }

      return next;
    });
  }

  function setNodeTricolorGroups(
    id: string,
    tricolorGroups: TricolorGroup[],
  ) {
    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) =>
          node.id === id ? { ...node, tricolorGroups } : node,
        );
      }

      return next;
    });
  }

  function clearNodeZones(id: string) {
    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) =>
          node.id === id
            ? {
              ...node,
              zones: undefined,
              imageWidth: undefined,
              imageHeight: undefined,
              pinMappings: [],
              tricolorGroups: [],
            }
            : node,
        );
      }

      return next;
    });
  }

  function setNodeAudio(
    id: string,
    audioFileName: string,
    audioAnalysis: AudioAnalysis,
  ) {
    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) =>
          node.id === id ? { ...node, audioFileName, audioAnalysis } : node,
        );
      }

      return next;
    });
  }

  function setNodeAudioOriginal(
    id: string,
    audioAnalysisOriginal: AudioAnalysis,
  ) {
    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) =>
          node.id === id ? { ...node, audioAnalysisOriginal } : node,
        );
      }

      return next;
    });
  }

  function clearNodeAudio(id: string) {
    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) =>
          node.id === id
            ? {
              ...node,
              audioFileName: undefined,
              audioAnalysis: undefined,
              audioAnalysisOriginal: undefined,
              bpmChanges: undefined,
            }
            : node,
        );
      }

      return next;
    });
  }

  function setNodeFrames(id: string, frames: Frame[]) {
    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) =>
          node.id === id ? { ...node, frames } : node,
        );
      }

      return next;
    });
  }

  function setNodeTiming(
    id: string,
    timing: { timingMode?: TimingMode; bpmChanges?: BpmChange[] },
  ) {
    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) =>
          node.id === id ? { ...node, ...timing } : node,
        );
      }

      return next;
    });
  }

  function setNodesLocked(ids: string[], locked: boolean) {
    const idSet = new Set(ids);

    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) =>
          idSet.has(node.id) ? { ...node, locked } : node,
        );
      }

      return next;
    });
  }

  function getChildren(parentId: string) {
    return nodesByParent[parentId] ?? [];
  }

  function getNode(id: string) {
    for (const parentId of Object.keys(nodesByParent)) {
      const found = nodesByParent[parentId].find(
        (node) => node.id === id,
      );

      if (found) return found;
    }

    return undefined;
  }

  return (
    <ProjectContext.Provider
      value={{
        syncStatus,
        workspaces,
        getChildren,
        getNode,
        addWorkspace,
        renameWorkspace,
        deleteWorkspace,
        addNode,
        renameNode,
        deleteNode,
        setNodeImage,
        removeNodeImage,
        setNodeZones,
        setNodePinMappings,
        setNodeTricolorGroups,
        clearNodeZones,
        setNodeAudio,
        setNodeAudioOriginal,
        clearNodeAudio,
        setNodeFrames,
        setNodeTiming,
        setNodesLocked,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjects() {
  const context = useContext(ProjectContext);

  if (!context) {
    throw new Error("useProjects must be used inside ProjectProvider");
  }

  return context;
}
