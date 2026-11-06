// Storage for Omertà: online rooms, host accounts, their sessions and their saved library.
// Production: Supabase Postgres through its REST API, using the SECRET (server-only) key.
// Local development: an in-memory store (never used on Vercel, where memory is not shared).
import { HttpError } from "./http";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

// Values pasted into Vercel often carry stray quotes, spaces or a trailing line break. Clean them before use.
function clean(v: unknown): string {
  let t = String(v == null ? "" : v).trim();
  const quoted = t.match(/^(["'`])([\s\S]*)\1$/);
  if (quoted) t = quoted[2].trim();
  return t;
}
function env(...names: string[]): string { for (const n of names) { const v = clean(process.env[n]); if (v) return v; } return ""; }

// Accept "abcd.supabase.co", "https://abcd.supabase.co/" and "https://abcd.supabase.co/rest/v1" alike.
function normalizeUrl(raw: string): string {
  let u = clean(raw);
  if (!u) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = "https://" + u;
  return u.replace(/\/+$/, "").replace(/\/rest\/v1$/i, "").replace(/\/+$/, "");
}
function urlProblem(url: string): string {
  try { const u = new URL(url); if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("protocol"); return ""; }
  catch { return "SUPABASE_URL is not a valid web address. Copy the Project URL from Supabase (it looks like https://abcd1234.supabase.co) into Vercel → Settings → Environment Variables, then redeploy."; }
}
// Real keys are plain visible ASCII. A masked key copied from the dashboard contains "•", which breaks every request.
function keyProblem(key: string, name: string): string {
  if (/[^\x21-\x7e]/.test(key)) return `${name} contains a character a key cannot have (such as •, a space or a line break). Reveal the full key in Supabase, copy it again into Vercel → Settings → Environment Variables, then redeploy.`;
  return "";
}
function jwtRole(key: string): string {
  try { const p = key.split(".")[1]; return JSON.parse(Buffer.from(p, "base64url").toString("utf8")).role || ""; } catch { return ""; }
}

export function config() {
  const publishableKey = env("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  return {
    url: normalizeUrl(env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")),
    secretKey: env("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    publishableKey: keyProblem(publishableKey, "") ? "" : publishableKey, // a broken key only costs live updates; phones then poll
  };
}

function netError(e: any, host: string): HttpError {
  const code = (e && e.cause && e.cause.code) || (e && e.code) || "";
  const name = (e && e.name) || "Error";
  if (name === "TimeoutError" || name === "AbortError") return new HttpError(504, `Supabase (${host}) did not answer in time. If the project was paused, open the Supabase dashboard and restore it, then try again.`);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new HttpError(502, `Cannot find a Supabase project at ${host}. Check SUPABASE_URL in Vercel, or the project may be paused or deleted — restore it in the Supabase dashboard.`);
  if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) return new HttpError(502, `Cannot connect to Supabase at ${host} (${code}). Try again in a moment.`);
  return new HttpError(502, `Could not reach Supabase at ${host} (${name}${code ? " " + code : ""}). Check SUPABASE_URL in Vercel.`);
}
function dbError(status: number, text: string): HttpError {
  let j: any = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
  const code = j && j.code, msg = (j && (j.message || j.msg || j.error_description || j.error)) || "";
  let say: string;
  if (status === 401 || /invalid api key|invalid jwt/i.test(msg)) say = "Supabase rejected the secret key. Copy it again (Supabase → Project Settings → API Keys) into SUPABASE_SECRET_KEY in Vercel, then redeploy.";
  else if (code === "42P01" || code === "PGRST205" || (status === 404 && /relation|table/i.test(msg))) say = "The database tables are missing. In Supabase open SQL Editor, paste everything from supabase/schema.sql and run it.";
  else if (code === "42501" || status === 403) say = "Supabase denied access to the tables. Run supabase/schema.sql again (it grants the server key access) and make sure SUPABASE_SECRET_KEY is the secret key, not the publishable one.";
  else if (status === 540 || /paused/i.test(text)) say = "The Supabase project is paused. Open the Supabase dashboard and restore it, then try again.";
  else if (status >= 500) say = `Supabase is having trouble right now (error ${status}). Try again in a moment.`;
  else say = `Database error ${status}: ${String(msg || text).slice(0, 200)}`;
  return new HttpError(502, say, { dbStatus: status, dbCode: code });
}

export interface Store {
  kind: "supabase" | "memory";
  // rooms
  getRoom(code: string): Promise<Row | null>;
  insertRoom(room: Row): Promise<boolean>;
  updateRoom(code: string, patch: Row): Promise<void>;
  deleteRoom(code: string): Promise<void>;
  pruneRooms(beforeIso: string): Promise<void>;
  listSeats(code: string): Promise<Row[]>;
  getSeat(code: string, id: string): Promise<Row | null>;
  upsertSeats(code: string, rows: Row[]): Promise<void>;
  deleteSeatsExcept(code: string, keep: string[]): Promise<void>;
  claimSeat(code: string, id: string, tokenHash: string): Promise<boolean>;
  patchSeat(code: string, id: string, patch: Row): Promise<void>;
  listVotes(code: string, key: string): Promise<Row[]>;
  getVote(code: string, id: string, key: string): Promise<Row | null>;
  upsertVote(code: string, id: string, key: string, target: string | null): Promise<void>;
  // night choices sent from phones (one row per role step per night) and the silent faction chat
  listNightActions(code: string, nightKey: string): Promise<Row[]>;
  upsertNightAction(code: string, row: Row): Promise<void>;
  listChat(code: string, channel: string | null, limit: number): Promise<Row[]>;
  insertChat(code: string, row: Row): Promise<void>;
  // host accounts
  getHostByName(username: string): Promise<Row | null>;
  getHostById(id: string): Promise<Row | null>;
  insertHost(row: Row): Promise<boolean>;
  updateHost(id: string, patch: Row): Promise<void>;
  insertSession(row: Row): Promise<void>;
  getSession(tokenHash: string): Promise<Row | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteSessionsFor(hostId: string): Promise<void>;
  // the host's library: saved setups, groups, custom roles and games
  listItems(hostId: string): Promise<Row[]>;
  listSmallItems(hostId: string): Promise<Row[]>;
  getItem(hostId: string, id: string): Promise<Row | null>;
  updateItem(hostId: string, id: string, patch: Row): Promise<boolean>;
  insertItem(row: Row): Promise<boolean>;
  deleteItem(hostId: string, id: string): Promise<void>;
  countItems(hostId: string, kind: string): Promise<number>;
}

const TIMEOUT_MS = 8000;
const ITEM_LIST = "id,kind,name,meta,created_at,updated_at";

function supabaseStore({ url, secretKey }: { url: string; secretKey: string }): Store {
  const base = url + "/rest/v1/"; const host = new URL(url).host;
  // New-style keys (sb_secret_...) go in the apikey header only; legacy JWT keys also as a Bearer token.
  const headers = (extra?: Record<string, string>) => Object.assign({ apikey: secretKey, "Content-Type": "application/json" },
    secretKey.startsWith("sb_") ? {} : { Authorization: "Bearer " + secretKey }, extra || {});
  async function req(method: string, path: string, body?: unknown, prefer?: string): Promise<any> {
    let res: Response, text: string;
    try {
      res = await fetch(base + path, { method, headers: headers(prefer ? { Prefer: prefer } : undefined), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
      text = await res.text();
    } catch (e) { throw netError(e, host); }
    if (!res.ok) throw dbError(res.status, text);
    if (!text) return null;
    try { return JSON.parse(text); } catch { throw new HttpError(502, `Supabase at ${host} sent an unexpected reply. Check that SUPABASE_URL is the Project URL (https://abcd1234.supabase.co).`); }
  }
  const q = encodeURIComponent;
  const first = (r: any) => (Array.isArray(r) && r[0]) || null;
  return {
    kind: "supabase",
    async getRoom(code) { return first(await req("GET", `rooms?code=eq.${q(code)}&select=*`)); },
    async insertRoom(room) {
      try { await req("POST", "rooms", room, "return=minimal"); return true; }
      catch (e: any) { if (e.dbStatus === 409) return false; throw e; }
    },
    async updateRoom(code, patch) { await req("PATCH", `rooms?code=eq.${q(code)}`, patch, "return=minimal"); },
    async deleteRoom(code) { await req("DELETE", `rooms?code=eq.${q(code)}`, undefined, "return=minimal"); },
    async pruneRooms(beforeIso) { await req("DELETE", `rooms?updated_at=lt.${q(beforeIso)}`, undefined, "return=minimal"); },
    async listSeats(code) { return req("GET", `seats?room_code=eq.${q(code)}&select=seat_id,ord,name,token_hash,claimed_at,seen_at&order=ord.asc`); },
    async getSeat(code, id) { return first(await req("GET", `seats?room_code=eq.${q(code)}&seat_id=eq.${q(id)}&select=*`)); },
    async upsertSeats(code, rows) {
      if (!rows.length) return;
      await req("POST", "seats?on_conflict=room_code,seat_id", rows.map(r => ({ room_code: code, seat_id: r.seat_id, ord: r.ord, name: r.name, view: r.view })), "resolution=merge-duplicates,return=minimal");
    },
    async deleteSeatsExcept(code, keep) {
      const filter = keep.length ? `&seat_id=not.in.(${keep.map(q).join(",")})` : "";
      await req("DELETE", `seats?room_code=eq.${q(code)}${filter}`, undefined, "return=minimal");
    },
    async claimSeat(code, id, tokenHash) {
      const rows = await req("PATCH", `seats?room_code=eq.${q(code)}&seat_id=eq.${q(id)}&token_hash=is.null`, { token_hash: tokenHash, claimed_at: new Date().toISOString() }, "return=representation");
      return Array.isArray(rows) && rows.length === 1;
    },
    async patchSeat(code, id, patch) { await req("PATCH", `seats?room_code=eq.${q(code)}&seat_id=eq.${q(id)}`, patch, "return=minimal"); },
    async listVotes(code, key) { return req("GET", `votes?room_code=eq.${q(code)}&vote_key=eq.${q(key)}&select=seat_id,target,updated_at`); },
    async getVote(code, id, key) { return first(await req("GET", `votes?room_code=eq.${q(code)}&seat_id=eq.${q(id)}&vote_key=eq.${q(key)}&select=target`)); },
    async upsertVote(code, id, key, target) {
      await req("POST", "votes?on_conflict=room_code,seat_id,vote_key", [{ room_code: code, seat_id: id, vote_key: key, target, updated_at: new Date().toISOString() }], "resolution=merge-duplicates,return=minimal");
    },
    async listNightActions(code, nightKey) { return req("GET", `night_actions?room_code=eq.${q(code)}&night_key=eq.${q(nightKey)}&select=step_key,seat_id,ab,targets,opts,updated_at`); },
    async upsertNightAction(code, row) {
      await req("POST", "night_actions?on_conflict=room_code,night_key,step_key", [{ room_code: code, night_key: row.night_key, step_key: row.step_key, seat_id: row.seat_id, ab: row.ab, targets: row.targets, opts: row.opts, updated_at: new Date().toISOString() }], "resolution=merge-duplicates,return=minimal");
    },
    async listChat(code, channel, limit) {
      const rows = await req("GET", `chat_messages?room_code=eq.${q(code)}${channel ? `&channel=eq.${q(channel)}` : ""}&select=id,channel,seat_id,name,body,created_at&order=id.desc&limit=${limit}`);
      return Array.isArray(rows) ? rows.reverse() : [];
    },
    async insertChat(code, row) { await req("POST", "chat_messages", { room_code: code, channel: row.channel, seat_id: row.seat_id, name: row.name, body: row.body }, "return=minimal"); },
    async getHostByName(username) { return first(await req("GET", `hosts?username=eq.${q(username)}&select=*`)); },
    async getHostById(id) { return first(await req("GET", `hosts?id=eq.${q(id)}&select=*`)); },
    async insertHost(row) {
      try { await req("POST", "hosts", row, "return=minimal"); return true; }
      catch (e: any) { if (e.dbStatus === 409) return false; throw e; }
    },
    async updateHost(id, patch) { await req("PATCH", `hosts?id=eq.${q(id)}`, patch, "return=minimal"); },
    async insertSession(row) { await req("POST", "host_sessions", row, "return=minimal"); },
    async getSession(tokenHash) { return first(await req("GET", `host_sessions?token_hash=eq.${q(tokenHash)}&select=*`)); },
    async deleteSession(tokenHash) { await req("DELETE", `host_sessions?token_hash=eq.${q(tokenHash)}`, undefined, "return=minimal"); },
    async deleteSessionsFor(hostId) { await req("DELETE", `host_sessions?host_id=eq.${q(hostId)}`, undefined, "return=minimal"); },
    async listItems(hostId) { return req("GET", `host_items?host_id=eq.${q(hostId)}&select=${ITEM_LIST}&order=updated_at.desc`); },
    async listSmallItems(hostId) { return req("GET", `host_items?host_id=eq.${q(hostId)}&kind=neq.game&select=${ITEM_LIST},data&order=updated_at.desc`); },
    async getItem(hostId, id) { return first(await req("GET", `host_items?host_id=eq.${q(hostId)}&id=eq.${q(id)}&select=*`)); },
    async updateItem(hostId, id, patch) {
      const rows = await req("PATCH", `host_items?host_id=eq.${q(hostId)}&id=eq.${q(id)}`, patch, "return=representation");
      return Array.isArray(rows) && rows.length === 1;
    },
    async insertItem(row) {
      try { await req("POST", "host_items", row, "return=minimal"); return true; }
      catch (e: any) { if (e.dbStatus === 409) return false; throw e; }
    },
    async deleteItem(hostId, id) { await req("DELETE", `host_items?host_id=eq.${q(hostId)}&id=eq.${q(id)}`, undefined, "return=minimal"); },
    async countItems(hostId, kind) { const r = await req("GET", `host_items?host_id=eq.${q(hostId)}&kind=eq.${q(kind)}&select=id`); return Array.isArray(r) ? r.length : 0; },
  };
}

export function memoryStore(): Store {
  const rooms = new Map<string, Row>(), seats = new Map<string, Map<string, Row>>(), votes = new Map<string, Map<string, Row>>();
  const nightActs = new Map<string, Map<string, Row>>(), chats = new Map<string, Row[]>(); let chatSeq = 0;
  const hosts = new Map<string, Row>(), sessions = new Map<string, Row>(), items = new Map<string, Row>();
  const clone = <T,>(o: T): T => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const seatsOf = (code: string) => { if (!seats.has(code)) seats.set(code, new Map()); return seats.get(code)!; };
  const votesOf = (code: string) => { if (!votes.has(code)) votes.set(code, new Map()); return votes.get(code)!; };
  const now = () => new Date().toISOString();
  const store: Store = {
    kind: "memory",
    async getRoom(code) { return clone(rooms.get(code)) || null; },
    async insertRoom(room) { if (rooms.has(room.code)) return false; rooms.set(room.code, Object.assign({ updated_at: now() }, clone(room))); return true; },
    async updateRoom(code, patch) { const r = rooms.get(code); if (r) Object.assign(r, clone(patch)); },
    async deleteRoom(code) { rooms.delete(code); seats.delete(code); votes.delete(code); nightActs.delete(code); chats.delete(code); },
    async pruneRooms(beforeIso) { for (const [c, r] of rooms) if ((r.updated_at || "") < beforeIso) await store.deleteRoom(c); },
    async listSeats(code) { return [...seatsOf(code).values()].sort((a, b) => a.ord - b.ord).map(s => clone({ seat_id: s.seat_id, ord: s.ord, name: s.name, token_hash: s.token_hash, claimed_at: s.claimed_at, seen_at: s.seen_at })); },
    async getSeat(code, id) { return clone(seatsOf(code).get(id)) || null; },
    async upsertSeats(code, rows) { const m = seatsOf(code); for (const r of rows) { const cur = m.get(r.seat_id) || { seat_id: r.seat_id, token_hash: null, claimed_at: null, seen_at: null }; Object.assign(cur, clone({ ord: r.ord, name: r.name, view: r.view })); m.set(r.seat_id, cur); } },
    async deleteSeatsExcept(code, keep) { const m = seatsOf(code); for (const id of [...m.keys()]) if (!keep.includes(id)) m.delete(id); },
    async claimSeat(code, id, tokenHash) { const s = seatsOf(code).get(id); if (!s || s.token_hash) return false; s.token_hash = tokenHash; s.claimed_at = now(); return true; },
    async patchSeat(code, id, patch) { const s = seatsOf(code).get(id); if (s) Object.assign(s, clone(patch)); },
    async listVotes(code, key) { return [...votesOf(code).values()].filter(v => v.vote_key === key).map(v => clone({ seat_id: v.seat_id, target: v.target, updated_at: v.updated_at })); },
    async getVote(code, id, key) { const v = votesOf(code).get(id + "|" + key); return v ? { target: v.target } : null; },
    async upsertVote(code, id, key, target) { votesOf(code).set(id + "|" + key, { seat_id: id, vote_key: key, target, updated_at: now() }); },
    async listNightActions(code, nightKey) { return [...(nightActs.get(code) || new Map()).values()].filter(r => r.night_key === nightKey).map(r => clone({ step_key: r.step_key, seat_id: r.seat_id, ab: r.ab, targets: r.targets, opts: r.opts, updated_at: r.updated_at })); },
    async upsertNightAction(code, row) {
      if (!nightActs.has(code)) nightActs.set(code, new Map());
      nightActs.get(code)!.set(row.night_key + "|" + row.step_key, clone({ night_key: row.night_key, step_key: row.step_key, seat_id: row.seat_id, ab: row.ab, targets: row.targets, opts: row.opts, updated_at: now() }));
    },
    async listChat(code, channel, limit) { return (chats.get(code) || []).filter(m => !channel || m.channel === channel).slice(-limit).map(clone); },
    async insertChat(code, row) { if (!chats.has(code)) chats.set(code, []); chats.get(code)!.push({ id: ++chatSeq, channel: row.channel, seat_id: row.seat_id, name: row.name, body: row.body, created_at: now() }); },
    async getHostByName(username) { for (const h of hosts.values()) if (h.username === username) return clone(h); return null; },
    async getHostById(id) { return clone(hosts.get(id)) || null; },
    async insertHost(row) { for (const h of hosts.values()) if (h.username === row.username) return false; if (hosts.has(row.id)) return false; hosts.set(row.id, Object.assign({ created_at: now(), failed_logins: 0, locked_until: null }, clone(row))); return true; },
    async updateHost(id, patch) { const h = hosts.get(id); if (h) Object.assign(h, clone(patch)); },
    async insertSession(row) { sessions.set(row.token_hash, Object.assign({ created_at: now() }, clone(row))); },
    async getSession(tokenHash) { return clone(sessions.get(tokenHash)) || null; },
    async deleteSession(tokenHash) { sessions.delete(tokenHash); },
    async deleteSessionsFor(hostId) { for (const [k, v] of sessions) if (v.host_id === hostId) sessions.delete(k); },
    async listItems(hostId) {
      return [...items.values()].filter(i => i.host_id === hostId).sort((a, b) => (b.updated_at > a.updated_at ? 1 : b.updated_at < a.updated_at ? -1 : 0))
        .map(i => clone({ id: i.id, kind: i.kind, name: i.name, meta: i.meta, created_at: i.created_at, updated_at: i.updated_at }));
    },
    async listSmallItems(hostId) {
      return [...items.values()].filter(i => i.host_id === hostId && i.kind !== "game").sort((a, b) => (b.updated_at > a.updated_at ? 1 : b.updated_at < a.updated_at ? -1 : 0))
        .map(i => clone({ id: i.id, kind: i.kind, name: i.name, meta: i.meta, created_at: i.created_at, updated_at: i.updated_at, data: i.data }));
    },
    async getItem(hostId, id) { const i = items.get(id); return i && i.host_id === hostId ? clone(i) : null; },
    async updateItem(hostId, id, patch) { const i = items.get(id); if (!i || i.host_id !== hostId) return false; Object.assign(i, clone(patch)); return true; },
    async insertItem(row) { if (items.has(row.id)) return false; items.set(row.id, Object.assign({ created_at: now(), updated_at: now() }, clone(row))); return true; },
    async deleteItem(hostId, id) { const i = items.get(id); if (i && i.host_id === hostId) items.delete(id); },
    async countItems(hostId, kind) { let n = 0; for (const i of items.values()) if (i.host_id === hostId && i.kind === kind) n++; return n; },
  };
  return store;
}

// One memory store per server process, shared by every route, so local development behaves like one database.
const g = globalThis as unknown as { __omertaMemoryStore?: Store };
export function getStore(): Store {
  const c = config();
  if (c.url || c.secretKey) {
    if (!c.url) throw new HttpError(503, "SUPABASE_URL is missing. Add the Project URL in Vercel → Settings → Environment Variables, then redeploy.");
    if (!c.secretKey) throw new HttpError(503, "SUPABASE_SECRET_KEY is missing. Add the secret key in Vercel → Settings → Environment Variables, then redeploy.");
    const bad = urlProblem(c.url) || keyProblem(c.secretKey, "SUPABASE_SECRET_KEY");
    if (bad) throw new HttpError(503, bad);
    return supabaseStore(c);
  }
  if (process.env.VERCEL) throw new HttpError(503, "Online play is not set up yet: add SUPABASE_URL and SUPABASE_SECRET_KEY in Vercel → Settings → Environment Variables, then redeploy.");
  return g.__omertaMemoryStore || (g.__omertaMemoryStore = memoryStore());
}

export interface DiagnoseStep { name: string; ok: boolean; detail: string; fix: string }
// Walks through everything online play and host accounts depend on and says which part is wrong. Never reveals a secret.
export async function diagnose(): Promise<{ ok: boolean; storage: string; steps: DiagnoseStep[] }> {
  const steps: DiagnoseStep[] = [];
  const add = (name: string, ok: boolean, detail: string, fix?: string) => steps.push({ name, ok, detail, fix: ok ? "" : fix || "" });
  const done = (storage: string) => ({ ok: steps.every(s => s.ok), storage, steps });
  const rawUrl = env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"), key = env("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  if (!rawUrl && !key) {
    if (!process.env.VERCEL) { add("Storage", true, "Local in-memory storage (development server). Nothing to set up."); return done("memory"); }
    add("Settings", false, "SUPABASE_URL and SUPABASE_SECRET_KEY are not set on this deployment.", "In Vercel open your project → Settings → Environment Variables, add both (see the README), then redeploy.");
    return done("none");
  }
  const url = normalizeUrl(rawUrl);
  const urlBad = !rawUrl ? "SUPABASE_URL is not set." : urlProblem(url);
  add("Project URL", !urlBad, urlBad ? "Missing or not a valid web address." : new URL(url).host, urlBad || "");
  let keyBad = !key ? "SUPABASE_SECRET_KEY is not set." : keyProblem(key, "SUPABASE_SECRET_KEY");
  let kind = "";
  if (!keyBad) {
    if (key.startsWith("sb_secret_")) kind = "new-style secret key";
    else if (key.startsWith("sb_publishable_")) keyBad = "This is the publishable key. The server needs the secret key (starts with sb_secret_).";
    else if (key.split(".").length === 3) { const role = jwtRole(key); kind = "legacy " + (role || "JWT") + " key"; if (role && role !== "service_role") keyBad = `This is the ${role} key. The server needs the service_role (secret) key.`; }
  }
  add("Secret key", !keyBad, keyBad ? "Missing or the wrong kind of key." : kind || "present", keyBad || "");
  const pub = env("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  add("Live updates key", true, !pub ? "Not set — optional. Phones will check for changes every few seconds instead." : keyProblem(pub, "") ? "Looks malformed, so it is ignored — phones will check every few seconds instead." : "present");
  if (urlBad || keyBad) return done("supabase");
  const store = supabaseStore({ url, secretKey: key });
  const probes: [string, () => Promise<unknown>][] = [
    ["rooms", () => store.getRoom("AAAAA")], ["seats", () => store.getSeat("AAAAA", "x")], ["votes", () => store.getVote("AAAAA", "x", "x")],
    ["night_actions", () => store.listNightActions("AAAAA", "x")], ["chat_messages", () => store.listChat("AAAAA", "x", 1)],
    ["hosts", () => store.getHostByName("~")], ["host_sessions", () => store.getSession("~")], ["host_items", () => store.countItems("00000000-0000-0000-0000-000000000000", "setup")],
  ];
  for (const [table, probe] of probes) {
    try { await probe(); add(`Table “${table}”`, true, "reachable"); }
    catch (e: any) {
      add(`Table “${table}”`, false, String(e.message).split(". ")[0] + ".", e.message);
      if (!e.dbStatus) break; // network trouble: the other tables would fail the same way
    }
  }
  return done("supabase");
}
