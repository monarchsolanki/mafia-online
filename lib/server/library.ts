// A host's saved library: role setups, player groups, custom roles and games, kept in their account.
import crypto from "node:crypto";
import { fail } from "./http";
import type { Store } from "./store";
import type { Host } from "./auth";

export const KINDS = ["setup", "group", "role", "game"] as const;
export type Kind = (typeof KINDS)[number];
const LIMITS: Record<Kind, { count: number; bytes: number }> = {
  setup: { count: 200, bytes: 64_000 },
  group: { count: 100, bytes: 32_000 },
  role: { count: 100, bytes: 32_000 },
  game: { count: 60, bytes: 1_500_000 },
};
const META_BYTES = 4_000;
const size = (o: unknown) => Buffer.byteLength(JSON.stringify(o ?? null));
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export interface ItemSummary { id: string; kind: Kind; name: string; meta: Record<string, unknown>; createdAt: string; updatedAt: string; data?: unknown }
const summary = (r: Record<string, unknown>): ItemSummary => ({ id: String(r.id), kind: r.kind as Kind, name: String(r.name), meta: (r.meta as Record<string, unknown>) || {}, createdAt: String(r.created_at), updatedAt: String(r.updated_at) });

/** Setups, groups and custom roles come with their (small) data; games come as summaries and load on demand. */
export async function listItems(store: Store, host: Host): Promise<ItemSummary[]> {
  const [all, small] = await Promise.all([store.listItems(host.id), store.listSmallItems(host.id)]);
  const data = new Map(small.map(r => [String(r.id), r.data]));
  return all.map(r => { const s = summary(r); if (s.kind !== "game" && data.has(s.id)) s.data = data.get(s.id); return s; });
}

export async function getItem(store: Store, host: Host, id: unknown) {
  if (!isUuid(id)) fail(400, "Pick an item.");
  const row = await store.getItem(host.id, id as string);
  if (!row) fail(404, "That item isn't in your library any more.");
  return Object.assign(summary(row!), { data: row!.data });
}

export async function saveItem(store: Store, host: Host, body: Record<string, unknown>): Promise<ItemSummary> {
  const kind = body.kind as Kind;
  if (!KINDS.includes(kind)) fail(400, "Unknown kind of item.");
  const id = isUuid(body.id) ? body.id : crypto.randomUUID();
  const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!name) fail(400, "Give it a name.");
  const meta = body.meta && typeof body.meta === "object" ? body.meta as Record<string, unknown> : {};
  if (size(meta) > META_BYTES) fail(413, "Item details are too large.");
  const data = body.data ?? {};
  if (size(data) > LIMITS[kind].bytes) fail(413, kind === "game" ? "This game is too large to save to your account. Export a save file instead." : "That item is too large to save.");
  const now = new Date().toISOString();
  if (await store.updateItem(host.id, id, { name, meta, data, updated_at: now })) {
    return { id, kind, name, meta, createdAt: now, updatedAt: now };
  }
  if ((await store.countItems(host.id, kind)) >= LIMITS[kind].count) fail(409, `Your library holds up to ${LIMITS[kind].count} of these. Delete some first.`);
  if (!(await store.insertItem({ id, host_id: host.id, kind, name, meta, data, created_at: now, updated_at: now }))) fail(409, "That item id is already in use. Try saving again.");
  return { id, kind, name, meta, createdAt: now, updatedAt: now };
}

export async function deleteItem(store: Store, host: Host, id: unknown): Promise<void> {
  if (!isUuid(id)) fail(400, "Pick an item.");
  await store.deleteItem(host.id, id as string);
}
