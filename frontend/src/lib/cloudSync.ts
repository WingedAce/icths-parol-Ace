import { supabase } from "./supabase";
import type { ProjectNode, Workspace } from "../types";

export type NodeRow = {
  id: string;
  parent_id: string;
  type: string;
  name: string;
  locked: boolean;
  data: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

const FULL_PAGE = 100; // rows with big zone/audio data are heavy — keep pages small
const STAMP_PAGE = 1000;
const IN_CHUNK = 40;
const UPSERT_CHUNK = 20;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// JSON with sorted keys, so two copies of the same data always compare equal
// (Postgres hands JSON keys back in a different order than we wrote them).
export function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
}

export function nodeToRow(node: ProjectNode): NodeRow {
  // imageDataUrl lives in Storage, never in the table.
  const { id, parentId, type, name, locked, imageDataUrl: _img, ...data } = node;
  return { id, parent_id: parentId, type, name, locked: locked ?? false, data };
}

export function rowToNode(row: NodeRow): ProjectNode {
  return {
    ...(row.data as object),
    id: row.id,
    parentId: row.parent_id,
    type: row.type as ProjectNode["type"],
    name: row.name,
    locked: row.locked,
  } as ProjectNode;
}

// A "fingerprint" of what the server holds for a node. Cached per node object:
// edits always create a new object, so untouched nodes cost nothing to re-check.
const keyCache = new WeakMap<object, string>();

export function nodeKey(node: ProjectNode): string {
  const cached = keyCache.get(node);
  if (cached !== undefined) return cached;
  const { parent_id, type, name, locked, data } = nodeToRow(node);
  const key = stable({ parent_id, type, name, locked, data });
  keyCache.set(node, key);
  return key;
}

export function rowKey(row: NodeRow): string {
  return stable({
    parent_id: row.parent_id,
    type: row.type,
    name: row.name,
    locked: row.locked,
    data: row.data,
  });
}

export function workspaceKey(workspace: Workspace): string {
  return stable(workspace);
}

function isMissingColumn(error: { code?: string; message?: string }) {
  return error.code === "42703" || /updated_at/i.test(error.message ?? "");
}

export async function fetchWorkspaces(): Promise<Workspace[]> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("id,name,type")
    .order("created_at");
  if (error) throw error;
  return data as Workspace[];
}

export async function fetchAllNodeRows(): Promise<NodeRow[]> {
  const rows: NodeRow[] = [];
  for (let from = 0; ; from += FULL_PAGE) {
    const { data, error } = await supabase
      .from("nodes")
      .select("*")
      .order("created_at")
      .order("id")
      .range(from, from + FULL_PAGE - 1);
    if (error) throw error;
    rows.push(...(data as NodeRow[]));
    if (data.length < FULL_PAGE) break;
  }
  return rows;
}

export async function fetchNodesByIds(ids: string[]): Promise<NodeRow[]> {
  const rows: NodeRow[] = [];
  for (const part of chunk(ids, IN_CHUNK)) {
    const { data, error } = await supabase
      .from("nodes")
      .select("*")
      .in("id", part);
    if (error) throw error;
    rows.push(...(data as NodeRow[]));
  }
  return rows;
}

// "id -> last changed" for every node: tiny, so devices can ask often.
// Returns null if the updated_at column hasn't been added to the database yet.
export async function fetchStamps(): Promise<Map<string, string> | null> {
  const stamps = new Map<string, string>();
  for (let from = 0; ; from += STAMP_PAGE) {
    const { data, error } = await supabase
      .from("nodes")
      .select("id,updated_at")
      .order("id")
      .range(from, from + STAMP_PAGE - 1);
    if (error) {
      if (isMissingColumn(error)) return null;
      throw error;
    }
    for (const row of data as { id: string; updated_at: string }[]) {
      stamps.set(row.id, row.updated_at);
    }
    if (data.length < STAMP_PAGE) break;
  }
  return stamps;
}

export async function fetchCloud() {
  const workspaces = await fetchWorkspaces();
  const rows = await fetchAllNodeRows();

  const nodes: Record<string, ProjectNode[]> = {};
  const keys = new Map<string, string>();
  const stamps = new Map<string, string>();
  for (const row of rows) {
    const node = rowToNode(row);
    (nodes[node.parentId] ??= []).push(node);
    keys.set(row.id, rowKey(row));
    if (row.updated_at) stamps.set(row.id, row.updated_at);
  }

  // If the table has rows but none carry updated_at, the SQL hasn't been run.
  const stampsSupported = rows.length === 0 ? (await fetchStamps()) !== null : stamps.size > 0;

  return { workspaces, nodes, keys, stamps, stampsSupported };
}

export type NodePushResult = {
  keys: Map<string, string>; // what we just wrote: id -> fingerprint
  stamps: Map<string, string>; // id -> new updated_at (when supported)
  deleted: string[];
  rejected: string[]; // the server refused these (e.g. an admin locked them)
};

// Only sends what changed compared with what the server is known to hold, so
// one person's stale screen can never wipe rows another person created.
export async function pushNodes(
  synced: Map<string, string>,
  next: Record<string, ProjectNode[]>,
  withStamps: boolean,
): Promise<NodePushResult> {
  const present = new Set<string>();
  const upserts: { row: NodeRow; key: string }[] = [];

  for (const list of Object.values(next)) {
    for (const node of list) {
      present.add(node.id);
      const key = nodeKey(node);
      if (synced.get(node.id) !== key) upserts.push({ row: nodeToRow(node), key });
    }
  }
  const deletes = [...synced.keys()].filter((id) => !present.has(id));

  const result: NodePushResult = {
    keys: new Map(),
    stamps: new Map(),
    deleted: [],
    rejected: [],
  };

  for (const part of chunk(deletes, IN_CHUNK)) {
    const { error } = await supabase.from("nodes").delete().in("id", part);
    if (error) throw error;
    result.deleted.push(...part);
  }

  async function upsertGroup(group: { row: NodeRow; key: string }[]) {
    const rows = group.map((g) => g.row);
    let error: { code?: string; message?: string } | null;
    let returned: { id: string; updated_at: string }[] | null = null;

    if (withStamps) {
      const res = await supabase.from("nodes").upsert(rows).select("id,updated_at");
      error = res.error;
      returned = res.data as { id: string; updated_at: string }[] | null;
    } else {
      const res = await supabase.from("nodes").upsert(rows);
      error = res.error;
    }

    if (!error) {
      for (const g of group) result.keys.set(g.row.id, g.key);
      for (const r of returned ?? []) result.stamps.set(r.id, r.updated_at);
      return;
    }

    // One refused row (row-level security) must not block everybody else's
    // saves, so retry the group one row at a time.
    if (error.code === "42501" && group.length > 1) {
      for (const single of group) await upsertGroup([single]);
      return;
    }
    if (error.code === "42501") {
      result.rejected.push(group[0].row.id);
      return;
    }
    throw error;
  }

  for (const part of chunk(upserts, UPSERT_CHUNK)) await upsertGroup(part);

  return result;
}

export async function pushWorkspaces(
  synced: Map<string, string>,
  next: Workspace[],
): Promise<Map<string, string>> {
  const keys = new Map(synced);
  const nextIds = new Set(next.map((w) => w.id));

  const upserts = next.filter((w) => synced.get(w.id) !== workspaceKey(w));
  const deletes = [...synced.keys()].filter((id) => !nextIds.has(id));

  if (deletes.length) {
    const { error } = await supabase.from("workspaces").delete().in("id", deletes);
    if (error) throw error;
    for (const id of deletes) keys.delete(id);
  }
  if (upserts.length) {
    const { error } = await supabase.from("workspaces").upsert(upserts);
    if (error) throw error;
    for (const w of upserts) keys.set(w.id, workspaceKey(w));
  }
  return keys;
}