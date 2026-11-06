// API tests: every room action, host accounts and the library, on (1) the memory store and (2) a stand-in for
// Supabase's REST API; plus the connection checker and the real route handlers.
/* eslint-disable @typescript-eslint/no-explicit-any */
import http from "node:http";
import { AddressInfo } from "node:net";
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { handleRoom } from "@/lib/server/rooms";
import { memoryStore, getStore, config, diagnose, type Store } from "@/lib/server/store";
import { signup, login, recover, currentHost, sessionCookie, COOKIE } from "@/lib/server/auth";
import { saveItem, listItems, getItem, deleteItem } from "@/lib/server/library";

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_PUBLISHABLE_KEY", "VERCEL"];
function withEnv(e: Record<string, string>) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, e);
  delete (globalThis as any).__omertaMemoryStore;
}
async function expectErr(p: Promise<unknown>, status: number) {
  try { await p; } catch (e: any) { expect(e.status, e.message).toBe(status); return e; }
  throw new Error(`expected an error with status ${status}`);
}

// ---- a minimal PostgREST stand-in: eq / is.null / lt / not.in filters, select, order, upsert-merge, PATCH representation, DELETE
function fakePostgrest() {
  const db: Record<string, any[]> = { rooms: [], seats: [], votes: [], night_actions: [], chat_messages: [], hosts: [], host_sessions: [], host_items: [] };
  const keys: Record<string, string[]> = { rooms: ["code"], seats: ["room_code", "seat_id"], votes: ["room_code", "seat_id", "vote_key"], night_actions: ["room_code", "night_key", "step_key"], chat_messages: ["id"], hosts: ["id"], host_sessions: ["token_hash"], host_items: ["id"] };
  let seq = 0;
  const unique: Record<string, string[]> = { hosts: ["username"] };
  const seen: string[] = []; let mode = "";
  const match = (row: any, filters: any[]) => filters.every(([col, op, val]) => op === "eq" ? String(row[col]) === val : op === "neq" ? String(row[col]) !== val : op === "is" ? (val === "null" ? row[col] == null : false) : op === "lt" ? String(row[col]) < val : op === "not.in" ? !val.includes(String(row[col])) : true);
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", c => (body += c)); req.on("end", () => {
      const send = (status: number, data: any) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(data === null ? "" : JSON.stringify(data)); };
      const u = new URL(req.url!, "http://x"); const table = u.pathname.replace("/rest/v1/", "");
      seen.push(`${req.method} ${req.url}`);
      if (mode === "missing") return send(404, { code: "PGRST205", message: "Could not find the table 'public.rooms' in the schema cache" });
      if (mode === "badkey") return send(401, { message: "Invalid API key" });
      if (mode === "paused") return send(540, { message: "Project is paused" });
      if (!req.headers.apikey) return send(401, { message: "no apikey" });
      if (!db[table]) return send(404, {});
      const filters: any[] = []; let order: string[] | null = null; let onConflict: string[] | null = null; let limit = 0;
      for (const [k, v] of u.searchParams) {
        if (k === "select") continue; if (k === "order") { order = v.split("."); continue; } if (k === "on_conflict") { onConflict = v.split(","); continue; }
        if (k === "limit") { limit = +v; continue; }
        if (v.startsWith("eq.")) filters.push([k, "eq", v.slice(3)]); else if (v.startsWith("neq.")) filters.push([k, "neq", v.slice(4)]); else if (v.startsWith("is.")) filters.push([k, "is", v.slice(3)]);
        else if (v.startsWith("lt.")) filters.push([k, "lt", v.slice(3)]);
        else if (v.startsWith("not.in.(")) filters.push([k, "not.in", v.slice(8, -1).split(",")]); else return send(400, { message: `bad filter ${k}=${v}` });
      }
      const prefer = String(req.headers.prefer || ""); const rows = db[table];
      if (req.method === "GET") {
        let out = rows.filter(r => match(r, filters));
        if (order) { const [col, dir] = order; out = out.slice().sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === "desc" ? -1 : 1)); }
        if (limit) out = out.slice(0, limit);
        return send(200, out);
      }
      if (req.method === "POST") {
        const items = [].concat(JSON.parse(body)); const k = onConflict || keys[table];
        for (const it of items as any[]) {
          const ex = rows.find(r => k.every(c => r[c] === it[c]));
          if (ex) { if (!prefer.includes("resolution=merge-duplicates")) return send(409, { message: "duplicate key" }); Object.assign(ex, it); continue; }
          if ((unique[table] || []).some(c => rows.some(r => r[c] === it[c]))) return send(409, { message: "duplicate key" });
          rows.push(Object.assign(table === "seats" ? { token_hash: null, claimed_at: null, seen_at: null } : {}, table === "chat_messages" ? { id: ++seq, created_at: new Date().toISOString() } : {}, it));
        }
        return send(prefer.includes("return=representation") ? 201 : 201, prefer.includes("return=representation") ? items : null);
      }
      if (req.method === "PATCH") { const p = JSON.parse(body); const hit = rows.filter(r => match(r, filters)); hit.forEach(r => Object.assign(r, p)); return send(200, prefer.includes("return=representation") ? hit : null); }
      if (req.method === "DELETE") {
        const del = rows.filter(r => match(r, filters)); db[table] = rows.filter(r => !del.includes(r));
        if (table === "rooms") for (const r of del) for (const t of ["seats", "votes", "night_actions", "chat_messages"]) db[t] = db[t].filter(s => s.room_code !== r.code);
        if (table === "hosts") for (const r of del) { db.host_sessions = db.host_sessions.filter(s => s.host_id !== r.id); db.host_items = db.host_items.filter(s => s.host_id !== r.id); }
        return send(204, null);
      }
      send(405, {});
    });
  });
  return new Promise<{ url: string; db: typeof db; seen: string[]; setMode: (m: string) => void; close: () => void }>(r =>
    server.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, db, seen, setMode: m => { mode = m; }, close: () => server.close() })));
}

function roomSuite(label: string, makeStore: () => Store) {
  test(`${label}: rooms — create, sync, claim, view, vote, reset, close`, async () => {
    const store = makeStore();
    const call = (method: string, q: any, b?: any) => handleRoom(store, method, q || {}, b || {});
    const { code, hostSecret } = await call("POST", { action: "create" });
    expect(code).toMatch(/^[A-Z]{5}$/); expect(hostSecret.length).toBeGreaterThan(20);
    const seats = [{ id: "p1", name: "Priya" }, { id: "p2", name: "Rahul" }, { id: "p3", name: "Aman" }];
    const views = { p1: { card: { roleName: "Doctor" } }, p2: { card: { roleName: "Godfather" } }, p3: { card: { roleName: "Villager" } } };
    await call("POST", { action: "sync" }, { code, hostSecret, version: 5, seats, views, publicView: { phase: "setup", vote: null } });
    await expectErr(call("POST", { action: "sync" }, { code, hostSecret: "wrong", seats, views }), 403);
    const list = await call("GET", { action: "seats", code: code.toLowerCase() });
    expect(list.seats.map((s: any) => s.name).join()).toBe("Priya,Rahul,Aman");
    expect(JSON.stringify(list)).not.toContain("Godfather");
    const c1 = await call("POST", { action: "claim" }, { code, seatId: "p1" });
    await expectErr(call("POST", { action: "claim" }, { code, seatId: "p1" }), 409);
    const v1 = await call("GET", { action: "view", code, seat: "p1", token: c1.token, seen: "1" });
    expect(v1.view.card.roleName).toBe("Doctor"); expect(JSON.stringify(v1)).not.toContain("Godfather");
    await expectErr(call("GET", { action: "view", code, seat: "p2", token: c1.token }), 403);
    await expectErr(call("GET", { action: "view", code, seat: "p1", token: "nope" }), 403);
    let st = await call("POST", { action: "status" }, { code, hostSecret });
    expect(st.seats.find((s: any) => s.id === "p1")).toMatchObject({ claimed: true, seen: true });
    await expectErr(call("POST", { action: "vote" }, { code, seat: "p1", token: c1.token, voteKey: "D1R1", target: "p2" }), 409);
    await call("POST", { action: "sync" }, { code, hostSecret, version: 6, seats, views, publicView: { phase: "day", vote: { key: "D1R1", nominees: [{ id: "p2", name: "Rahul" }], allowSkip: true, eligible: ["p1", "p2"] } } });
    await call("POST", { action: "vote" }, { code, seat: "p1", token: c1.token, voteKey: "D1R1", target: "p2" });
    await expectErr(call("POST", { action: "vote" }, { code, seat: "p1", token: c1.token, voteKey: "D1R1", target: "p3" }), 400);
    expect((await call("GET", { action: "view", code, seat: "p1", token: c1.token })).myVote).toBe("p2");
    await call("POST", { action: "vote" }, { code, seat: "p1", token: c1.token, voteKey: "D1R1", target: "skip" });
    st = await call("POST", { action: "status" }, { code, hostSecret, voteKey: "D1R1" });
    expect(st.votes).toHaveLength(1); expect(st.votes[0]).toMatchObject({ target: "skip", seat: "p1" });
    const c3 = await call("POST", { action: "claim" }, { code, seatId: "p3" });
    await expectErr(call("POST", { action: "vote" }, { code, seat: "p3", token: c3.token, voteKey: "D1R1", target: "p2" }), 403);
    await call("POST", { action: "sync" }, { code, hostSecret, version: 7, seats: seats.slice(0, 2), views, publicView: { phase: "day" } });
    await expectErr(call("GET", { action: "view", code, seat: "p3", token: c3.token }), 404);
    await call("POST", { action: "resetSeat" }, { code, hostSecret, seatId: "p1" });
    await expectErr(call("GET", { action: "view", code, seat: "p1", token: c1.token }), 403);
    expect((await call("POST", { action: "claim" }, { code, seatId: "p1" })).token).toBeTruthy();
    expect((await call("POST", { action: "status" }, { code, hostSecret })).seats).toHaveLength(2);
    await call("POST", { action: "close" }, { code, hostSecret });
    await expectErr(call("GET", { action: "seats", code }), 404);
  });

  test(`${label}: rooms — night choices from phones and the faction chat`, async () => {
    const store = makeStore();
    const call = (method: string, q: any, b?: any) => handleRoom(store, method, q || {}, b || {});
    const { code, hostSecret } = await call("POST", { action: "create" });
    const seats = [{ id: "m1", name: "Rahul" }, { id: "m2", name: "Priya" }, { id: "d1", name: "Kabir" }, { id: "v1", name: "Isha" }];
    const tg = (ids: string[]) => ids.map(id => ({ id, name: id, ok: true, why: "" }));
    const faction = { key: "mafia", type: "faction", kind: "factionKill", verb: "Kill", carriers: [{ id: "m1", name: "Rahul" }, { id: "m2", name: "Priya" }], carrier: "m1", strong: {}, targets: tg(["d1", "v1"]).concat([{ id: "m1", name: "Rahul", ok: false, why: "Self" } as any]) };
    const chat = { channel: "g1:mafia", label: "The Mafia", open: true, members: [] };
    const doc = { key: "d1", type: "player", title: "Doctor", abilities: [{ id: "heal", verb: "Heal", kind: "heal", target: "any", ok: true, targets: tg(["m1", "m2", "d1", "v1"]) }] };
    const views = { m1: { night: { key: "g1:N1", steps: [faction] }, chat }, m2: { night: { key: "g1:N1", steps: [faction] }, chat }, d1: { night: { key: "g1:N1", steps: [doc] } }, v1: {} };
    await call("POST", { action: "sync" }, { code, hostSecret, version: 1, seats, views, publicView: { phase: "night" } });
    const t: Record<string, string> = {};
    for (const s of seats) t[s.id] = (await call("POST", { action: "claim" }, { code, seatId: s.id })).token;
    const act = (seat: string, b: any) => call("POST", { action: "act" }, Object.assign({ code, seat, token: t[seat], nightKey: "g1:N1" }, b));
    await expectErr(act("m1", { stepKey: "mafia", targets: ["d1"], opts: { carrier: "m1" }, nightKey: "g1:N0" }), 409);
    await expectErr(act("v1", { stepKey: "mafia", targets: ["d1"], opts: { carrier: "m1" } }), 409); // the villager has no night at all
    await expectErr(act("d1", { stepKey: "mafia", targets: ["v1"], opts: { carrier: "m1" } }), 403);
    await expectErr(act("m1", { stepKey: "mafia", targets: ["m1"], opts: { carrier: "m1" } }), 400);
    await expectErr(act("m1", { stepKey: "mafia", targets: ["d1"], opts: { carrier: "v1" } }), 400);
    await act("m1", { stepKey: "mafia", targets: ["d1"], opts: { carrier: "m1", strong: true } });
    await act("m2", { stepKey: "mafia", targets: ["v1"], opts: { carrier: "m2" } }); // a teammate changes the team's choice
    await expectErr(act("d1", { stepKey: "d1", ab: "heal", targets: ["d1", "v1"] }), 400);
    await act("d1", { stepKey: "d1", ab: "heal", targets: ["v1"] });
    let st = await call("POST", { action: "status" }, { code, hostSecret, nightKey: "g1:N1" });
    expect(st.night).toHaveLength(2);
    expect(st.night.find((r: any) => r.step === "mafia")).toMatchObject({ seat: "m2", ab: "factionKill", targets: ["v1"], opts: { carrier: "m2", strong: false } });
    const vm1 = await call("GET", { action: "view", code, seat: "m1", token: t.m1 });
    expect(vm1.sent.mafia).toMatchObject({ targets: ["v1"], mine: false });
    const vd = await call("GET", { action: "view", code, seat: "d1", token: t.d1 });
    expect(Object.keys(vd.sent)).toEqual(["d1"]); expect(vd.chat).toBeNull();
    // chat: only the faction, only while open
    await expectErr(call("POST", { action: "chat" }, { code, seat: "v1", token: t.v1, body: "hi" }), 403);
    await expectErr(call("POST", { action: "chat" }, { code, seat: "m1", token: t.m1, body: "   " }), 400);
    await expectErr(call("POST", { action: "chat" }, { code, seat: "m1", token: t.m1, body: "x".repeat(281) }), 400);
    const sent = await call("POST", { action: "chat" }, { code, seat: "m1", token: t.m1, body: "  Kabir   is the doc  " });
    expect(sent.chat).toHaveLength(1); expect(sent.chat[0]).toMatchObject({ name: "Rahul", body: "Kabir is the doc", mine: true });
    await call("POST", { action: "chat" }, { code, seat: "m2", token: t.m2, body: "agreed" });
    const vm2 = await call("GET", { action: "view", code, seat: "m2", token: t.m2 });
    expect(vm2.chat.map((m: any) => [m.name, m.mine])).toEqual([["Rahul", false], ["Priya", true]]);
    expect(JSON.stringify(await call("GET", { action: "view", code, seat: "v1", token: t.v1 }))).not.toContain("Kabir is the doc");
    st = await call("POST", { action: "status" }, { code, hostSecret, chat: true });
    expect(st.chat.map((m: any) => m.body)).toEqual(["Kabir is the doc", "agreed"]);
    await call("POST", { action: "sync" }, { code, hostSecret, version: 2, seats, views: { m1: { chat: Object.assign({}, chat, { open: false }) } }, publicView: { phase: "day" } });
    await expectErr(call("POST", { action: "chat" }, { code, seat: "m1", token: t.m1, body: "day talk" }), 409);
    await expectErr(act("m1", { stepKey: "mafia", targets: ["d1"], opts: { carrier: "m1" } }), 409);
    await call("POST", { action: "close" }, { code, hostSecret });
  });

  test(`${label}: host accounts — sign up, log in, lock out, recover, sessions`, async () => {
    const store = makeStore();
    const req = (token?: string) => new Request("https://omerta.test/api/auth", { headers: token ? { cookie: `${COOKIE}=${token}` } : {} });
    const a = await signup(store, { username: "Monarch", password: "correct horse" });
    expect(a.host).toMatchObject({ username: "monarch", displayName: "Monarch" });
    expect(a.recoveryCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await currentHost(store, req(a.token))).toMatchObject({ username: "monarch" });
    expect(await currentHost(store, req("forged"))).toBeNull();
    await expectErr(signup(store, { username: "MONARCH", password: "another one" }), 409);
    await expectErr(signup(store, { username: "x", password: "long enough" }), 400);
    await expectErr(signup(store, { username: "bad name!", password: "long enough" }), 400);
    await expectErr(signup(store, { username: "riya", password: "short" }), 400);
    const b = await login(store, { username: " monarch ", password: "correct horse" });
    expect(b.host.username).toBe("monarch");
    await expectErr(login(store, { username: "monarch", password: "wrong" }), 401);
    await expectErr(login(store, { username: "nobody", password: "whatever1" }), 401);
    for (let i = 0; i < 7; i++) await expectErr(login(store, { username: "monarch", password: "wrong" + i }), 401);
    const locked = await expectErr(login(store, { username: "monarch", password: "correct horse" }), 429);
    expect(locked.message).toMatch(/Try again in \d+ minute/);
    await store.updateHost(b.host.id, { locked_until: null }); // time passes
    expect((await login(store, { username: "monarch", password: "correct horse" })).host.username).toBe("monarch");
    await expectErr(recover(store, { username: "monarch", recoveryCode: "AAAA-BBBB-CCCC", password: "new password" }), 401);
    const r = await recover(store, { username: "monarch", recoveryCode: a.recoveryCode.toLowerCase().replace(/-/g, " "), password: "new password" });
    expect(r.recoveryCode).not.toBe(a.recoveryCode);
    expect(await currentHost(store, req(a.token))).toBeNull(); // recovery signs every other device out
    expect(await currentHost(store, req(r.token))).toMatchObject({ username: "monarch" });
    await expectErr(login(store, { username: "monarch", password: "correct horse" }), 401);
    expect((await login(store, { username: "monarch", password: "new password" })).host.username).toBe("monarch");
    await expectErr(recover(store, { username: "monarch", recoveryCode: a.recoveryCode, password: "third password" }), 401); // old code is spent
    const raw = JSON.stringify(await store.getHostByName("monarch"));
    expect(raw).not.toContain("new password"); expect(raw).not.toContain(r.recoveryCode);
  });

  test(`${label}: library — save, list, update, isolate hosts, delete, limits`, async () => {
    const store = makeStore();
    const { host: h1 } = await signup(store, { username: "host-one", password: "password1" });
    const { host: h2 } = await signup(store, { username: "host-two", password: "password2" });
    const setup = await saveItem(store, h1, { kind: "setup", name: "Friday 10", meta: { n: 10 }, data: { pool: { mafia: 2, villager: 8 } } });
    const group = await saveItem(store, h1, { kind: "group", name: "College", data: { players: ["Aman", "Riya"] } });
    expect((await listItems(store, h1)).map(i => i.name).sort()).toEqual(["College", "Friday 10"]);
    expect((await listItems(store, h1)).find(i => i.id === setup.id)?.data).toEqual({ pool: { mafia: 2, villager: 8 } }); // small items list with their data
    expect((await getItem(store, h1, setup.id)).data).toEqual({ pool: { mafia: 2, villager: 8 } });
    await saveItem(store, h1, { id: setup.id, kind: "setup", name: "Friday 12", data: { pool: { mafia: 3, villager: 9 } } });
    expect((await getItem(store, h1, setup.id)).name).toBe("Friday 12");
    expect(await listItems(store, h2)).toEqual([]);
    await expectErr(getItem(store, h2, setup.id), 404);
    await expectErr(saveItem(store, h2, { id: setup.id, kind: "setup", name: "Stolen", data: {} }), 409); // cannot overwrite another host's item
    expect((await getItem(store, h1, setup.id)).name).toBe("Friday 12");
    await deleteItem(store, h2, group.id); // someone else's id: nothing happens
    expect(await listItems(store, h1)).toHaveLength(2);
    await deleteItem(store, h1, group.id);
    expect((await listItems(store, h1)).map(i => i.name)).toEqual(["Friday 12"]);
    await expectErr(saveItem(store, h1, { kind: "photo", name: "x", data: {} }), 400);
    await expectErr(saveItem(store, h1, { kind: "setup", name: "  ", data: {} }), 400);
    await expectErr(saveItem(store, h1, { kind: "group", name: "Huge", data: { s: "x".repeat(40_000) } }), 413);
    const game = await saveItem(store, h1, { kind: "game", name: "Night 2 · 10 players", meta: { phase: "night", night: 2 }, data: { v: 1, players: [] } });
    const listed = (await listItems(store, h1)).find(i => i.id === game.id);
    expect(listed?.meta).toEqual({ phase: "night", night: 2 });
    expect(listed?.data).toBeUndefined(); // games load on demand
    expect((await getItem(store, h1, game.id)).data).toEqual({ v: 1, players: [] });
  });
}

describe("memory store", () => {
  roomSuite("memory", () => memoryStore());
});

describe("Supabase REST stand-in", () => {
  let fake: Awaited<ReturnType<typeof fakePostgrest>>;
  beforeAll(async () => { fake = await fakePostgrest(); withEnv({ SUPABASE_URL: fake.url, SUPABASE_SECRET_KEY: "sb_secret_test" }); });
  afterAll(() => { fake.close(); withEnv({}); });
  roomSuite("supabase-REST", () => getStore());
  test("REST: atomic claim, seat pruning and item ownership use the expected filters", () => {
    expect(fake.seen.some(s => /seats\?on_conflict=room_code,seat_id/.test(s))).toBe(true);
    expect(fake.seen.some(s => /token_hash=is\.null/.test(s))).toBe(true);
    expect(fake.seen.some(s => /seat_id=not\.in\.\(p1,p2\)/.test(s))).toBe(true);
    expect(fake.seen.some(s => /^PATCH \/rest\/v1\/host_items\?host_id=eq\.[0-9a-f-]+&id=eq\./.test(s))).toBe(true);
  });
  test("diagnose: healthy, missing tables, rejected key, paused, unreachable", async () => {
    let d = await diagnose();
    expect(d.ok).toBe(true); expect(d.steps.map(s => s.name)).toContain("Table “host_items”");
    expect(JSON.stringify(d)).not.toContain("sb_secret_test");
    fake.setMode("missing"); d = await diagnose();
    expect(d.ok).toBe(false); expect(d.steps.some(s => !s.ok && /schema\.sql/.test(s.fix))).toBe(true);
    fake.setMode("badkey"); d = await diagnose();
    expect(d.steps.some(s => !s.ok && /secret key/i.test(s.fix))).toBe(true);
    fake.setMode("paused"); d = await diagnose();
    expect(d.steps.some(s => !s.ok && /paused/.test(s.fix))).toBe(true);
    fake.setMode("");
  });
});

describe("configuration and connection checker", () => {
  afterAll(() => withEnv({}));
  test("pasted values are cleaned up", () => {
    withEnv({ SUPABASE_URL: '  "abcd1234.supabase.co/rest/v1/" ', SUPABASE_SECRET_KEY: ' "sb_secret_abc"\n' });
    expect(config()).toMatchObject({ url: "https://abcd1234.supabase.co", secretKey: "sb_secret_abc" });
  });
  test("every misconfiguration explains itself", async () => {
    withEnv({ VERCEL: "1" });
    expect(() => getStore()).toThrow(/SUPABASE_URL and SUPABASE_SECRET_KEY/);
    withEnv({ VERCEL: "1", SUPABASE_URL: "https://abcd1234.supabase.co" });
    expect(() => getStore()).toThrow(/SUPABASE_SECRET_KEY is missing/);
    withEnv({ VERCEL: "1", SUPABASE_URL: "https://abcd1234.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_ab••" });
    expect(() => getStore()).toThrow(/character a key cannot have/);
    withEnv({ SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_SECRET_KEY: "sb_secret_test" });
    expect((await diagnose()).steps.some(s => !s.ok && /reach|connect/i.test(s.fix))).toBe(true);
    withEnv({ SUPABASE_URL: "https://abcd1234.supabase.co", SUPABASE_SECRET_KEY: "sb_publishable_abc" });
    expect((await diagnose()).steps.some(s => !s.ok && /publishable/.test(s.fix))).toBe(true);
    withEnv({ VERCEL: "1" });
    expect((await diagnose()).steps.some(s => /Environment Variables/.test(s.fix))).toBe(true);
    withEnv({});
    expect(await diagnose()).toMatchObject({ ok: true, storage: "memory" });
  });
});

describe("route handlers", () => {
  afterAll(() => withEnv({}));
  test("auth and library routes: cookie session, same-origin check, readable errors", async () => {
    withEnv({});
    const auth = await import("@/app/api/auth/route");
    const lib = await import("@/app/api/library/route");
    const room = await import("@/app/api/room/route");
    const post = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(url, { method: "POST", headers: Object.assign({ "content-type": "application/json", origin: "http://localhost" }, headers), body: JSON.stringify(body) });
    let r = await auth.POST(post("http://localhost/api/auth", { action: "signup", username: "Isha", password: "hunter22!" }));
    expect(r.status).toBe(201);
    const set = r.headers.get("set-cookie") || "";
    expect(set).toMatch(/HttpOnly/); expect(set).toMatch(/SameSite=Lax/); expect(set).not.toMatch(/Secure/); // plain http in development
    const body = await r.json(); expect(body.recoveryCode).toBeTruthy(); expect(JSON.stringify(body)).not.toContain("pass_hash");
    const cookie = set.split(";")[0];
    r = await auth.GET(new Request("http://localhost/api/auth", { headers: { cookie } }));
    expect((await r.json()).host.username).toBe("isha");
    r = await lib.POST(post("http://localhost/api/library", { kind: "group", name: "Flatmates", data: { players: ["A", "B"] } }, { cookie }));
    expect(r.status).toBe(200);
    r = await lib.GET(new Request("http://localhost/api/library", { headers: { cookie } }));
    expect((await r.json()).items.map((i: any) => i.name)).toEqual(["Flatmates"]);
    r = await lib.GET(new Request("http://localhost/api/library"));
    expect(r.status).toBe(401); expect((await r.json()).error).toMatch(/Sign in/);
    r = await lib.POST(post("http://localhost/api/library", { kind: "group", name: "X", data: {} }, { cookie, origin: "https://evil.example" }));
    expect(r.status).toBe(403);
    // behind a proxy or `next start`, req.url can name another host than the one the browser used
    r = await lib.POST(post("http://localhost:3100/api/library", { kind: "group", name: "Proxy", data: {} }, { cookie, origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100" }));
    expect(r.status).toBe(200);
    r = await lib.POST(post("http://localhost/api/library", { kind: "group", name: "Fwd", data: {} }, { cookie, origin: "https://omerta.vercel.app", "x-forwarded-host": "omerta.vercel.app" }));
    expect(r.status).toBe(200);
    r = await lib.POST(post("http://localhost/api/library", { kind: "group", name: "X", data: {} }, { cookie, origin: "https://evil.example", "x-forwarded-host": "omerta.vercel.app" }));
    expect(r.status).toBe(403);
    r = await auth.POST(new Request("http://localhost/api/auth", { method: "POST", headers: { "content-type": "text/plain", cookie }, body: JSON.stringify({ action: "logout" }) }));
    expect(r.status).toBe(415);
    r = await auth.POST(post("http://localhost/api/auth", { action: "logout" }, { cookie }));
    expect(r.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    r = await auth.GET(new Request("http://localhost/api/auth", { headers: { cookie } }));
    expect((await r.json()).host).toBeNull();
    expect(sessionCookie("t", new Request("https://x.vercel.app/"))).toMatch(/Secure/);
    r = await room.GET(new Request("http://localhost/api/room?action=config"));
    expect(await r.json()).toMatchObject({ storage: "memory" });
    withEnv({ VERCEL: "1", SUPABASE_URL: "https://abcd1234.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_ab•" });
    r = await room.POST(post("http://localhost/api/room?action=create", {}));
    expect(r.status).toBe(503); expect((await r.json()).error).toMatch(/character a key cannot have/);
    r = await room.GET(new Request("http://localhost/api/room?action=diagnose"));
    expect(r.status).toBe(200); expect((await r.json()).ok).toBe(false);
  });
});
