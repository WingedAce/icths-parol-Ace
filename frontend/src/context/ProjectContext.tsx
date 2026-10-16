
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { workspaces as initialWorkspaces } from "../data/workspaces";
import { deleteImage, loadAllImages, saveImage } from "../lib/imageStore";
import {
  fetchCloud,
  pushNodeDiff,
  pushWorkspaceDiff,
} from "../lib/cloudSync";
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

type ProjectContextType = {
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
  setNodeImage: (id: string, imageDataUrl: string) => void;
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

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] =
    useState<Workspace[]>(initialWorkspaces);

  const [nodesByParent, setNodesByParent] =
    useState<Record<string, ProjectNode[]>>({});

  const [cloudLoaded, setCloudLoaded] = useState(false);

  const syncedNodes = useRef<Record<string, ProjectNode[]>>({});
  const syncedWorkspaces = useRef<Workspace[]>([]);

 
  // Load cloud data and drawings before enabling writes.
  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        const { workspaces: w, nodes } = await fetchCloud();

        let restoredNodes = nodes;

        try {
          const images = await loadAllImages();

          restoredNodes = Object.fromEntries(
            Object.entries(nodes).map(([parentId, parentNodes]) => [
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

        if (cancelled) return;

        syncedWorkspaces.current = w;
        syncedNodes.current = nodes;

        setWorkspaces(w.length > 0 ? w : initialWorkspaces);
        setNodesByParent(restoredNodes);
        setCloudLoaded(true);
      } catch (error) {
        console.error("Could not load from Supabase:", error);
      }
    }

    void loadInitialData();

    return () => {
      cancelled = true;
    };
  }, []);

  // Sync only changed workspaces to Supabase.
  useEffect(() => {
    if (!cloudLoaded) return;

    const timer = setTimeout(() => {
      pushWorkspaceDiff(syncedWorkspaces.current, workspaces)
        .then(() => {
          syncedWorkspaces.current = workspaces;
        })
        .catch(console.error);
    }, 800);

    return () => clearTimeout(timer);
  }, [workspaces, cloudLoaded]);

  // Sync only changed nodes to Supabase.
  useEffect(() => {
    if (!cloudLoaded) return;

    const timer = setTimeout(() => {
      pushNodeDiff(syncedNodes.current, nodesByParent)
        .then(() => {
          syncedNodes.current = nodesByParent;
        })
        .catch(console.error);
    }, 800);

    return () => clearTimeout(timer);
  }, [nodesByParent, cloudLoaded]);

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
