
import { supabase } from "./supabase";
import type { ProjectNode, Workspace } from "../types";

type NodeRow = {
  id: string;
  parent_id: string;
  type: string;
  name: string;
  locked: boolean;
  data: Record<string, unknown>;
};

function nodeToRow(node: ProjectNode): NodeRow {
  // imageDataUrl lives in Storage, never in the table.
  const { id, parentId, type, name, locked, imageDataUrl: _img, ...data } = node;
  return { id, parent_id: parentId, type, name, locked: locked ?? false, data };
}

function rowToNode(row: NodeRow): ProjectNode {
  return {
    ...(row.data as object),
    id: row.id,
    parentId: row.parent_id,
    type: row.type as ProjectNode["type"],
    name: row.name,
    locked: row.locked,
  } as ProjectNode;
}

export async function fetchCloud() {
  const [w, n] = await Promise.all([
    supabase.from("workspaces").select("id,name,type").order("created_at"),
    supabase.from("nodes").select("*").order("created_at"),
  ]);
  if (w.error) throw w.error;
  if (n.error) throw n.error;

  const nodes: Record<string, ProjectNode[]> = {};
  for (const row of n.data as NodeRow[]) {
    const node = rowToNode(row);
    (nodes[node.parentId] ??= []).push(node);
  }
  return { workspaces: w.data as Workspace[], nodes };
}

// Only sends what changed since the last successful sync, so one person's
// stale screen can never wipe rows another person created.
export async function pushNodeDiff(
  prev: Record<string, ProjectNode[]>,
  next: Record<string, ProjectNode[]>,
) {
  const flat = (m: Record<string, ProjectNode[]>) =>
    new Map(Object.values(m).flat().map((n) => [n.id, nodeToRow(n)]));
  const before = flat(prev);
  const after = flat(next);

  const upserts: NodeRow[] = [];
  for (const [id, row] of after) {
    const old = before.get(id);
    if (!old || JSON.stringify(old) !== JSON.stringify(row)) upserts.push(row);
  }
  const deletes = [...before.keys()].filter((id) => !after.has(id));

  if (deletes.length) {
    const { error } = await supabase.from("nodes").delete().in("id", deletes);
    if (error) throw error;
  }
  if (upserts.length) {
    const { error } = await supabase.from("nodes").upsert(upserts);
    if (error) throw error;
  }
}

export async function pushWorkspaceDiff(prev: Workspace[], next: Workspace[]) {
  const before = new Map(prev.map((w) => [w.id, JSON.stringify(w)]));
  const nextIds = new Set(next.map((w) => w.id));
  const upserts = next.filter((w) => before.get(w.id) !== JSON.stringify(w));
  const deletes = prev.filter((w) => !nextIds.has(w.id)).map((w) => w.id);

  if (deletes.length) {
    const { error } = await supabase.from("workspaces").delete().in("id", deletes);
    if (error) throw error;
  }
  if (upserts.length) {
    const { error } = await supabase.from("workspaces").upsert(upserts);
    if (error) throw error;
  }
}
