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
  stable,
  workspaceKey,
  type NodeRow,
} from "../lib/cloudSync";
import { ensureSession } from "../lib/supabase";
import { mergeFrames } from "../utils/frameMerge";
import { updateLostPins } from "../utils/pinRemap";
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

const POLL_MS = 10_000;
const PUSH_DEBOUNCE_MS = 200;

type ProjectContextType = {
  syncStatus: SyncStatus;
  lastSavedAt: number | null;
  saveNow: () => Promise<boolean>;
  workspaces: Workspace[];
  getChildren: (parentId: string) => ProjectNode[];
  getNode: (id: string) => ProjectNode | undefined;
  addWorkspace: (name: string, type: WorkspaceType) => string;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => void;
  deleteNodes: (ids: string[]) => void;
  undoDelete: () => Promise<UndoResult>;
  lastDeletion: { label: string; at: number } | null;
  deletionCount: number;
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
  setNodeLostZonePins: (
    id: string,
    lostZonePins: Record<number, number> | undefined,
  ) => void;
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
  setNodeParolName: (id: string, parolName: string) => void;
  setNodeTiming: (
    id: string,
    timing: { timingMode?: TimingMode; bpmChanges?: BpmChange[] },
  ) => void;
  setNodesLocked: (ids: string[], locked: boolean) => void;
};

const ProjectContext = createContext<ProjectContextType | null>(null);

type DeletedBatch = {
  at: number;
  label: string;
  nodes: { node: ProjectNode; index: number }[];
  workspace?: { workspace: Workspace; index: number };
};

const MAX_UNDO = 10;

export type UndoResult =
  | { ok: true; label: string }
  | { ok: false; reason: "nothing" | "busy" | "images" };

function snapshotBranches(
  rootIds: Set<string>,
  nodes: Record<string, ProjectNode[]>,
) {
  const out: { node: ProjectNode; index: number }[] = [];
  const seen = new Set<string>();

  const visit = (node: ProjectNode, index: number) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    out.push({ node, index });
    (nodes[node.id] ?? []).forEach((child, i) => visit(child, i));
  };

  for (const list of Object.values(nodes)) {
    list.forEach((node, index) => {
      if (rootIds.has(node.id)) visit(node, index);
    });
  }
  return out;
}

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

function frameBases(
  nodes: Record<string, ProjectNode[]>,
): Map<string, Frame[]> {
  const out = new Map<string, Frame[]>();
  for (const list of Object.values(nodes)) {
    for (const node of list) {
      if (node.frames !== undefined) out.set(node.id, node.frames);
    }
  }
  return out;
}

type RemoteNodes = {
  baseFrames: Map<string, Frame[]>;
  oldKeys: Map<string, string>;
  rowById: Map<string, NodeRow>;
  remoteIds: Set<string>;
  force: Set<string>;
  imageUpdates: Map<string, string | null>;
};

function mergeRemoteNodes(
  prev: Record<string, ProjectNode[]>,
  ctx: RemoteNodes,
): Record<string, ProjectNode[]> {
  const { oldKeys, rowById, remoteIds, force, imageUpdates, baseFrames } = ctx;

  let changed = false;
  const kept: ProjectNode[] = [];
  const seen = new Set<string>();

  for (const list of Object.values(prev)) {
    for (const node of list) {
      seen.add(node.id);

      const dirty = !force.has(node.id) && oldKeys.get(node.id) !== nodeKey(node);
      let out = node;

      if (!remoteIds.has(node.id)) {
        if (oldKeys.has(node.id) && !dirty) {
          changed = true;
          continue;
        }
      } else {
        const row = rowById.get(node.id);
        if (row && !dirty && rowKey(row) !== nodeKey(node)) {
          out = { ...rowToNode(row), imageDataUrl: node.imageDataUrl };
          changed = true;
        } else if (
          row &&
          dirty &&
          node.frames !== undefined &&
          rowKey(row) !== oldKeys.get(node.id)
        ) {
          const merged = mergeFrames(
            baseFrames.get(node.id) ?? [],
            node.frames,
            rowToNode(row).frames ?? [],
          );
          if (stable(merged) !== stable(node.frames)) {
            out = { ...node, frames: merged };
            changed = true;
          }
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
        changed = true;
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

const DRAFT_KEY = "draft-v1";

type Draft = {
  savedAt: number;
  nodes: ProjectNode[];
  base: Record<string, string | null>;
  workspaces: Workspace[];
  workspaceBase: Record<string, string | null>;
};

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
    if (cloudKey === nodeKey(local)) continue;

    const baseKey = draft.base?.[local.id] ?? null;
    let restore: boolean;
    if (cloudKey === undefined) {
      restore = baseKey === null;
    } else if (cloudKey === baseKey) {
      restore = true;
    } else {
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

  const [deletions, setDeletions] = useState<DeletedBatch[]>([]);
  const deletionsRef = useRef<DeletedBatch[]>([]);
  const undoing = useRef(false);

  const nodesRef = useRef(nodesByParent);
  const workspacesRef = useRef(workspaces);
  const commitWaiters = useRef<Array<() => void>>([]);

  const syncedNodeKeys = useRef(new Map<string, string>());
  const syncedFrames = useRef(new Map<string, Frame[]>());
  const nodeStamps = useRef(new Map<string, string>());
  const syncedWorkspaceKeys = useRef(new Map<string, string>());
  const imageStamps = useRef(new Map<string, string>());
  const stampsSupported = useRef(true);

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
      const oldFrames = syncedFrames.current;
      const ctx: RemoteNodes = {
        baseFrames: oldFrames,
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

      const nextKeys = new Map(oldKeys);
      for (const id of [...nextKeys.keys()]) {
        if (!remoteIds.has(id)) nextKeys.delete(id);
      }
      for (const row of rows) nextKeys.set(row.id, rowKey(row));
      syncedNodeKeys.current = nextKeys;
      const nextFrames = new Map(oldFrames);
      for (const id of [...nextFrames.keys()]) {
        if (!remoteIds.has(id)) nextFrames.delete(id);
      }
      for (const row of rows) {
        const frames = rowToNode(row).frames;
        if (frames) nextFrames.set(row.id, frames);
        else nextFrames.delete(row.id);
      }
      syncedFrames.current = nextFrames;
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

  async function mergeBeforePush() {
    const synced = syncedNodeKeys.current;
    const ids: string[] = [];
    for (const list of Object.values(nodesRef.current)) {
      for (const node of list) {
        if (
          node.frames !== undefined &&
          synced.has(node.id) &&
          synced.get(node.id) !== nodeKey(node)
        ) {
          ids.push(node.id);
        }
      }
    }
    if (ids.length === 0) return;

    const rows = await fetchNodesByIds(ids);
    const oldFrames = syncedFrames.current;
    const theirs = new Map<string, Frame[]>();
    const keys = new Map(synced);
    const bases = new Map(oldFrames);
    for (const row of rows) {
      if (rowKey(row) === synced.get(row.id)) continue;
      const frames = rowToNode(row).frames ?? [];
      theirs.set(row.id, frames);
      keys.set(row.id, rowKey(row));
      bases.set(row.id, frames);
      if (row.updated_at) nodeStamps.current.set(row.id, row.updated_at);
    }
    if (theirs.size === 0) return;

    const apply = (prev: Record<string, ProjectNode[]>) => {
      let changed = false;
      const next: Record<string, ProjectNode[]> = {};
      for (const [parentId, list] of Object.entries(prev)) {
        next[parentId] = list.map((node) => {
          const remote = theirs.get(node.id);
          if (!remote || node.frames === undefined) return node;
          const merged = mergeFrames(
            oldFrames.get(node.id) ?? [],
            node.frames,
            remote,
          );
          if (stable(merged) === stable(node.frames)) return node;
          changed = true;
          return { ...node, frames: merged };
        });
      }
      return changed ? next : prev;
    };

    nodesRef.current = apply(nodesRef.current);
    setNodesByParent(apply);
    syncedNodeKeys.current = keys;
    syncedFrames.current = bases;
  }

  async function pushTask() {
    flags.current.pushing += 1;
    refreshStatus();

    try {
      await mergeBeforePush();

      syncedWorkspaceKeys.current = await pushWorkspaces(
        syncedWorkspaceKeys.current,
        workspacesRef.current,
      );

      const snapshot = nodesRef.current;
      const result = await pushNodes(
        syncedNodeKeys.current,
        snapshot,
        stampsSupported.current,
      );

      const pushedFrames = new Map(syncedFrames.current);
      for (const list of Object.values(snapshot)) {
        for (const node of list) {
          if (result.keys.has(node.id) && node.frames !== undefined) {
            pushedFrames.set(node.id, node.frames);
          }
        }
      }
      for (const id of result.deleted) pushedFrames.delete(id);
      syncedFrames.current = pushedFrames;

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
      writeDraft();

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

  function flushPush() {
    if (!pushTimer.current) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = null;
    flags.current.scheduled = false;
    enqueue(pushTask);
  }

  useEffect(() => {
    nodesRef.current = nodesByParent;
    workspacesRef.current = workspaces;
    const waiters = commitWaiters.current;
    commitWaiters.current = [];
    waiters.forEach((resolve) => resolve());
  }, [nodesByParent, workspaces]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      for (let attempt = 0; !cancelled; attempt++) {
        try {
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
            console.error("Could not load drawings from Supabase:", error);
          }

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
          syncedFrames.current = frameBases(cloud.nodes);
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

  useEffect(() => {
    if (!cloudLoaded) return;
    const timer = setTimeout(writeDraft, 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesByParent, workspaces, cloudLoaded]);

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

  function setDeletionStack(next: DeletedBatch[]) {
    deletionsRef.current = next;
    setDeletions(next);
  }

  function rememberDeletion(batch: DeletedBatch) {
    setDeletionStack([...deletionsRef.current, batch].slice(-MAX_UNDO));
  }

  function deleteWorkspace(id: string) {
    const workspace = workspacesRef.current.find((w) => w.id === id);
    const roots = new Set((nodesRef.current[id] ?? []).map((n) => n.id));
    const removed = snapshotBranches(roots, nodesRef.current);

    if (workspace) {
      rememberDeletion({
        at: Date.now(),
        label: `the "${workspace.name}" workspace`,
        nodes: removed,
        workspace: {
          workspace,
          index: workspacesRef.current.indexOf(workspace),
        },
      });
    }

    setWorkspaces((previous) =>
      previous.filter((workspace) => workspace.id !== id),
    );

    setNodesByParent((previous) => {
      const next = { ...previous };
      deleteBranch(next, id);
      return next;
    });

    deleteImage(id).catch(() => { });
    for (const { node } of removed) {
      deleteImage(node.id).catch(() => { });
    }
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

  function deleteNodes(ids: string[]) {
    const roots = new Set(ids);
    const removed = snapshotBranches(roots, nodesRef.current);
    if (removed.length === 0) return;

    const rootNodes = removed.filter((r) => roots.has(r.node.id));
    const designs = removed.filter((r) => r.node.type === "group").length;
    const label =
      designs > 0
        ? `${designs} ${designs === 1 ? "design" : "designs"}`
        : rootNodes.length === 1
          ? `"${rootNodes[0].node.name}"`
          : `${rootNodes.length} items`;

    rememberDeletion({ at: Date.now(), label, nodes: removed });

    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].filter((node) => !roots.has(node.id));
      }
      for (const id of roots) deleteBranch(next, id);

      return next;
    });

    for (const { node } of removed) {
      deleteImage(node.id).catch(() => { });
    }
  }

  function deleteNode(id: string) {
    deleteNodes([id]);
  }

  async function undoDelete(): Promise<UndoResult> {
    if (undoing.current) return { ok: false, reason: "busy" };
    const batch = deletionsRef.current[deletionsRef.current.length - 1];
    if (!batch) return { ok: false, reason: "nothing" };

    undoing.current = true;
    try {
      const withImages = batch.nodes.filter((r) => r.node.imageDataUrl);
      try {
        await Promise.all(
          withImages.map((r) =>
            saveImage(r.node.id, r.node.imageDataUrl as string),
          ),
        );
      } catch (error) {
        console.error("Could not restore drawings:", error);
        return { ok: false, reason: "images" };
      }

      try {
        const stamps = await listImageStamps();
        for (const r of withImages) {
          const stamp = stamps.get(r.node.id);
          if (stamp) imageStamps.current.set(r.node.id, stamp);
        }
      } catch {
      }

      setDeletionStack(deletionsRef.current.filter((b) => b !== batch));

      if (batch.workspace) {
        const { workspace, index } = batch.workspace;
        setWorkspaces((previous) =>
          previous.some((w) => w.id === workspace.id)
            ? previous
            : [
              ...previous.slice(0, index),
              workspace,
              ...previous.slice(index),
            ],
        );
      }

      setNodesByParent((previous) => {
        const next = { ...previous };
        const ordered = [...batch.nodes].sort((a, b) => a.index - b.index);

        for (const { node, index } of ordered) {
          const list = next[node.parentId] ?? [];
          if (list.some((item) => item.id === node.id)) continue;
          if (
            node.type === "animation" &&
            list.some(
              (item) =>
                item.type === "animation" &&
                (item.round ?? 1) === (node.round ?? 1),
            )
          ) {
            continue;
          }
          const copy = [...list];
          copy.splice(Math.min(index, copy.length), 0, node);
          next[node.parentId] = copy;
        }

        return next;
      });

      return { ok: true, label: batch.label };
    } finally {
      undoing.current = false;
    }
  }


  async function setNodeImage(id: string, imageDataUrl: string) {
    await saveImage(id, imageDataUrl);

    try {
      const stamp = (await listImageStamps()).get(id);
      if (stamp) imageStamps.current.set(id, stamp);
    } catch {
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
              lostZonePins: undefined,
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
              lostZonePins: undefined,
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
              lostZonePins: undefined,
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
          node.id === id
            ? {
              ...node,
              pinMappings,
              lostZonePins: updateLostPins(
                node.pinMappings ?? [],
                pinMappings,
                node.lostZonePins,
              ),
            }
            : node,
        );
      }

      return next;
    });
  }

  function setNodeLostZonePins(
    id: string,
    lostZonePins: Record<number, number> | undefined,
  ) {
    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) =>
          node.id === id ? { ...node, lostZonePins } : node,
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
              lostZonePins: undefined,
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

  function setNodeParolName(id: string, parolName: string) {
    const clean = parolName.trim();
    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) => {
          if (node.id !== id) return node;
          if (clean) return { ...node, parolName: clean };
          const { parolName: _removed, ...rest } = node;
          return rest;
        });
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
        deleteNodes,
        undoDelete,
        lastDeletion:
          deletions.length > 0
            ? {
              label: deletions[deletions.length - 1].label,
              at: deletions[deletions.length - 1].at,
            }
            : null,
        deletionCount: deletions.length,
        addNode,
        renameNode,
        deleteNode,
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
        setNodeParolName,
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
