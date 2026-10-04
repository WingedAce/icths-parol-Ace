import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { workspaces as initialWorkspaces } from "../data/workspaces";
import { deleteImage, loadAllImages, saveImage } from "../lib/imageStore";
import type {
  AudioAnalysis,
  Frame,
  NodeType,
  PinMapping,
  ProjectNode,
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
  addNode: (parentId: string, name: string, type: NodeType) => string;
  renameNode: (id: string, name: string) => void;
  deleteNode: (id: string) => void;
  setNodeImage: (id: string, imageDataUrl: string) => void;
  setNodeZones: (
    id: string,
    zones: Zone[],
    imageWidth: number,
    imageHeight: number,
  ) => void;
  setNodePinMappings: (id: string, pinMappings: PinMapping[]) => void;
  clearNodeZones: (id: string) => void;
  setNodeAudio: (
    id: string,
    audioFileName: string,
    audioAnalysis: AudioAnalysis,
  ) => void;
  clearNodeAudio: (id: string) => void;
  setNodeFrames: (id: string, frames: Frame[]) => void;
};

const ProjectContext = createContext<ProjectContextType | null>(null);

const WORKSPACES_KEY = "parol-editor:workspaces";
const NODES_KEY = "parol-editor:nodes";

function loadWorkspaces(): Workspace[] {
  try {
    const raw = localStorage.getItem(WORKSPACES_KEY);
    if (!raw) return initialWorkspaces;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return initialWorkspaces;
  } catch {
    return initialWorkspaces;
  }
}

function loadNodes(): Record<string, ProjectNode[]> {
  try {
    const raw = localStorage.getItem(NODES_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
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

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] =
    useState<Workspace[]>(loadWorkspaces);

  const [nodesByParent, setNodesByParent] =
    useState<Record<string, ProjectNode[]>>(loadNodes);

  // Images live in IndexedDB now (see lib/imageStore.ts), not inline in this
  // state — load them once on mount and merge them back onto their nodes.
  // This runs after the initial (image-less) render, so a node's drawing
  // may pop in a moment after the rest of the page — expected, not a bug.
  useEffect(() => {
    let cancelled = false;

    loadAllImages()
      .then((images) => {
        if (cancelled || Object.keys(images).length === 0) return;

        setNodesByParent((previous) => {
          const next = { ...previous };

          for (const parentId of Object.keys(next)) {
            next[parentId] = next[parentId].map((node) =>
              images[node.id]
                ? { ...node, imageDataUrl: images[node.id] }
                : node,
            );
          }

          return next;
        });
      })
      .catch(() => {
        // No images saved yet, or IndexedDB unavailable — fine, just means
        // no drawings to restore.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(
      WORKSPACES_KEY,
      JSON.stringify(workspaces),
    );
  }, [workspaces]);

  useEffect(() => {
    // Strip imageDataUrl before persisting — it lives in IndexedDB (see
    // setNodeImage below), and leaving it here is exactly what blew past
    // localStorage's quota and crashed the app before.
    const stripped: Record<string, ProjectNode[]> = {};

    for (const parentId of Object.keys(nodesByParent)) {
      stripped[parentId] = nodesByParent[parentId].map(
        ({ imageDataUrl: _imageDataUrl, ...rest }) => rest,
      );
    }

    localStorage.setItem(
      NODES_KEY,
      JSON.stringify(stripped),
    );
  }, [nodesByParent]);

  function addWorkspace(
    name: string,
    type: WorkspaceType,
  ) {
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name,
      type,
    };

    setWorkspaces((previous) => [
      ...previous,
      workspace,
    ]);

    return workspace.id;
  }

  function renameWorkspace(id: string, name: string) {
    setWorkspaces((previous) =>
      previous.map((workspace) =>
        workspace.id === id
          ? { ...workspace, name }
          : workspace,
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
      deleteImage(id).catch(() => {});
      for (const removedId of removedIds) {
        deleteImage(removedId).catch(() => {});
      }

      return next;
    });
  }

  function addNode(
    parentId: string,
    name: string,
    type: NodeType,
  ) {
    const node: ProjectNode = {
      id: crypto.randomUUID(),
      name,
      type,
      parentId,
    };

    setNodesByParent((previous) => ({
      ...previous,
      [parentId]: [
        ...(previous[parentId] ?? []),
        node,
      ],
    }));

    return node.id;
  }

  function renameNode(id: string, name: string) {
    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) =>
          node.id === id
            ? { ...node, name }
            : node,
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
      deleteImage(id).catch(() => {});
      for (const removedId of removedIds) {
        deleteImage(removedId).catch(() => {});
      }

      return next;
    });
  }

  function setNodeImage(id: string, imageDataUrl: string) {
    setNodesByParent((previous) => {
      const next = { ...previous };

      for (const parentId of Object.keys(next)) {
        next[parentId] = next[parentId].map((node) =>
          node.id === id
            ? { ...node, imageDataUrl }
            : node,
        );
      }

      return next;
    });

    saveImage(id, imageDataUrl).catch((error) => {
      console.error("Failed to save drawing to IndexedDB:", error);
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
            ? { ...node, zones, imageWidth, imageHeight, pinMappings: [] }
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
          node.id === id
            ? { ...node, audioFileName, audioAnalysis }
            : node,
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
            ? { ...node, audioFileName: undefined, audioAnalysis: undefined }
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
        setNodeZones,
        setNodePinMappings,
        clearNodeZones,
        setNodeAudio,
        clearNodeAudio,
        setNodeFrames,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjects() {
  const context = useContext(ProjectContext);

  if (!context) {
    throw new Error(
      "useProjects must be used inside ProjectProvider",
    );
  }

  return context;
}
