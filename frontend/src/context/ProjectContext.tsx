
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
import { localGet, localSet } from "../lib/localDraft";
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
  // When the cloud last confirmed a save on this screen (null until the first
  // save of this visit).
  lastSavedAt: number | null;
  // Saves everything right now instead of waiting for the short delay.
  // Resolves true when the cloud has it all, false when it could not be
  // saved (the work is still kept in this browser and retried).
  saveNow: () => Promise<boolean>;
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

// ---- Local safety copy ----
// Everything the user did but the cloud has not confirmed yet is also kept in
// this browser (see lib/localDraft.ts). On the next start, anything the cloud
// never received is put back, so a dropped connection or a closed tab never
// loses work.
const DRAFT_KEY = "draft-v1";

type Draft = {
  savedAt: number;
  // Nodes edited here and not yet saved to the cloud (drawing left out: it
  // lives in Storage).
  nodes: ProjectNode[];
  // What the cloud held for each of them when the edit started (null = it
  // was created here and never reached the cloud).
  base: Record<string, string | null>;
  workspaces: Workspace[];
  workspaceBase: Record<string, string | null>;
};

// Puts unsaved work from the safety copy back on top of what the cloud sent.
async function applyDraft(
  cloud: Awaited<ReturnType<typeof fetchCloud>>,
  nodes: Record<string, ProjectNode[]>,
  workspaces: Workspace[],
): Promise<{ nodes: Record<string, ProjectNode[]>; workspaces: Workspace[] }> {
  const draft = await localGet<Draft>(DRAFT_KEY);
  if (!draft) return { nodes, workspaces };

  const nextNodes: Record<string, ProjectNode[]> = {};
  for (const [parentId, list] of Object.entries(nodes)) {
    nextNodes[parentId] = [...list];
  }

  for (const local of draft.nodes ?? []) {
    const cloudKey = cloud.keys.get(local.id);
    if (cloudKey === nodeKey(local)) continue; // the cloud already has it

    const baseKey = draft.base?.[local.id] ?? null;
    let restore: boolean;
    if (cloudKey === undefined) {
      // Not in the cloud: new here (keep it), or deleted on another device.
      restore = baseKey === null;
    } else if (cloudKey === baseKey) {
      restore = true; // nobody else touched it, so our edit goes on top
    } else {
      // Changed here AND somewhere else: the newer one wins.
      const stamp = cloud.stamps.get(local.id);
      restore = stamp ? Date.parse(stamp) < draft.savedAt : false;
    }
    if (!restore) continue;

    let existing: ProjectNode | undefined;
    for (const list of Object.values(nextNodes)) {
      const found = list.find((node) => node.id === local.id);
      if (found) existing = found;
    }
    const restored: ProjectNode = {
      ...local,
      imageDataUrl: existing?.imageDataUrl,
    };
    if (existing) {
      for (const [parentId, list] of Object.entries(nextNodes)) {
        nextNodes[parentId] = list.map((node) =>
          node.id === local.id ? restored : node,
        );
      }
    } else {
      (nextNodes[restored.parentId] ??= []).push(restored);
    }
  }

  const nextWorkspaces = [...workspaces];
  for (const local of draft.workspaces ?? []) {
    const theirs = nextWorkspaces.find((w) => w.id === local.id);
    const baseKey = draft.workspaceBase?.[local.id] ?? null;
    if (!theirs) {
      if (baseKey === null) nextWorkspaces.push(local);
    } else if (
      workspaceKey(theirs) !== workspaceKey(local) &&
      workspaceKey(theirs) === baseKey
    ) {
      nextWorkspaces[nextWorkspaces.indexOf(theirs)] = local;
    }
  }

  return { nodes: nextNodes, workspaces: nextWorkspaces };
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] =
    useState<Workspace[]>(initialWorkspaces);

  const [nodesByParent, setNodesByParent] =
    useState<Record<string, ProjectNode[]>>({});

  const [cloudLoaded, setCloudLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

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

  // Keeps a copy of every change the cloud has not confirmed yet in this
  // browser. Once the cloud has everything, the copy is empty.
  function writeDraft() {
    const synced = syncedNodeKeys.current;
    const dirtyNodes: ProjectNode[] = [];
    const base: Record<string, string | null> = {};
    for (const list of Object.values(nodesRef.current)) {
      for (const node of list) {
        if (synced.get(node.id) === nodeKey(node)) continue;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { imageDataUrl: _image, ...rest } = node;
        dirtyNodes.push(rest as ProjectNode);
        base[node.id] = synced.get(node.id) ?? null;
      }
    }

    const syncedWorkspaces = syncedWorkspaceKeys.current;
    const dirtyWorkspaces: Workspace[] = [];
    const workspaceBase: Record<string, string | null> = {};
    for (const workspace of workspacesRef.current) {
      if (syncedWorkspaces.get(workspace.id) === workspaceKey(workspace)) {
        continue;
      }
      dirtyWorkspaces.push(workspace);
      workspaceBase[workspace.id] = syncedWorkspaces.get(workspace.id) ?? null;
    }

    const draft: Draft = {
      savedAt: Date.now(),
      nodes: dirtyNodes,
      base,
      workspaces: dirtyWorkspaces,
      workspaceBase,
    };
    void localSet(DRAFT_KEY, draft);
  }

  // The "Save now" button: don't wait, save everything this second.
  async function saveNow(): Promise<boolean> {
    if (pushTimer.current) {
      clearTimeout(pushTimer.current);
      pushTimer.current = null;
      flags.current.scheduled = false;
    }
    writeDraft();
    const task = chain.current.then(pushTask).catch(() => {});
    chain.current = task;
    await task;
    return !flags.current.pushError;
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
      setLastSavedAt(Date.now());
      // The cloud has it now, so the local safety copy shrinks to whatever
      // was edited while this save was running (usually nothing).
      writeDraft();

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

          // Anything the cloud never received (closed tab, lost connection)
          // comes back from this browser's safety copy.
          let restoredWorkspaces = cloud.workspaces;
          try {
            const applied = await applyDraft(
              cloud,
              restoredNodes,
              cloud.workspaces,
            );
            restoredNodes = applied.nodes;
            restoredWorkspaces = applied.workspaces;
          } catch (error) {
            console.error("Could not restore the local safety copy:", error);
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
            restoredWorkspaces.length > 0 ? restoredWorkspaces : initialWorkspaces,
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

  // Keep the local safety copy up to date with every edit, almost at once
  // (much faster than the cloud save, so a closed tab loses nothing).
  useEffect(() => {
    if (!cloudLoaded) return;
    const timer = setTimeout(writeDraft, 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesByParent, workspaces, cloudLoaded]);

  // Closing the tab while a save is still running (or failing): ask first.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      const f = flags.current;
      if (f.scheduled || f.pushing > 0 || f.pushError) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
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
        writeDraft();
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
      writeDraft();
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
        lastSavedAt,
        saveNow,
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
