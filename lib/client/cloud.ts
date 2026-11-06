"use client";
// The host's account: sign-in state, and the library (setups, groups, custom roles, games) kept in it.
// Signed out, everything works as before on this device. Signed in, the account is the source of truth and the
// device keeps a copy, so a closed browser or a different phone loses nothing.
import E from "@/lib/engine/engine";
import type { Game, Role } from "@/lib/engine/engine";
import { A, LS, emit, save, saveLibrary, toast, onSave, migrate, resetUi, top0, type Preset, type Group } from "./store";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Host { id: string; username: string; displayName: string }
export interface Item { id: string; kind: "setup" | "group" | "role" | "game"; name: string; meta: Record<string, any>; createdAt: string; updatedAt: string; data?: any }

const uuid = () => (crypto as Crypto & { randomUUID?: () => string }).randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16));

async function call(method: string, url: string, body?: unknown): Promise<any> {
  let r: Response;
  try { r = await fetch(url, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", credentials: "same-origin" }); }
  catch { throw Object.assign(new Error("No connection. Check the internet and try again."), { status: 0 }); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Something went wrong (HTTP ${r.status}).`), { status: r.status });
  return j;
}

function phaseLine(s: Game) {
  if (s.phase === "ended") return s.result ? `${s.result.factionName} ${s.result.faction === "draw" || s.result.faction.startsWith("solo:") ? "wins" : "win"}` : "Finished";
  if (s.phase === "day") return `Day ${s.day}`;
  if (s.phase === "dawn") return `Dawn ${s.night}`;
  if (s.phase === "night" || s.phase === "reveal-done") return `Night ${s.night}`;
  return "Setup";
}

export const Cloud = {
  status: "unknown" as "unknown" | "out" | "in" | "offline",
  host: null as Host | null,
  items: [] as Item[],
  busy: false,
  started: false,
  gameT: null as ReturnType<typeof setTimeout> | null,
  lastGameSig: "",

  async init() {
    if (this.started) return; this.started = true;
    onSave(() => this.scheduleGame());
    try { const j = await call("GET", "/api/auth"); this.host = j.host; this.status = j.host ? "in" : "out"; }
    catch (e: any) { this.status = e.status === 503 || e.status === 0 ? "offline" : "out"; emit(); return; }
    emit();
    if (this.host) await this.refresh(true);
  },

  /** Pulls the library down and makes it this device's copy. `merge` first uploads anything saved on this device only. */
  async refresh(merge = false) {
    if (!this.host) return;
    try {
      let j = await call("GET", "/api/library");
      this.items = j.items;
      if (merge && (await this.uploadLocal())) { j = await call("GET", "/api/library"); this.items = j.items; }
      this.adopt();
      emit();
    } catch (e: any) { if (e.status === 401) { this.signedOut(); return; } toast(e.message); }
  },

  /** Saves made on this device before signing in move into the account. */
  async uploadLocal(): Promise<boolean> {
    const have = new Set(this.items.map(i => i.id));
    let n = 0;
    for (const p of A.presets) if (!p.id || !have.has(p.id)) { await this.put("setup", p.id || uuid(), p.name, { n: p.n, style: p.style }, { pool: p.pool, style: p.style, n: p.n }); n++; }
    for (const g of A.groups) if (!g.id || !have.has(g.id)) { await this.put("group", g.id || uuid(), g.name, { players: g.players.length }, { players: g.players }); n++; }
    for (const r of A.customLib) if (!r.cloudId || !have.has(r.cloudId)) { await this.put("role", r.cloudId || uuid(), r.name, { team: r.team }, r); n++; }
    if (n) toast(`Moved ${n} saved item${n === 1 ? "" : "s"} from this device into your account`);
    return n > 0;
  },
  async put(kind: Item["kind"], id: string, name: string, meta: Record<string, any>, data: any): Promise<Item> {
    const j = await call("POST", "/api/library", { kind, id, name, meta, data });
    return j.item;
  },

  /** The account's items become this device's lists. */
  adopt() {
    const by = (k: string) => this.items.filter(i => i.kind === k && i.data);
    A.presets = by("setup").map(i => ({ id: i.id, name: i.name, n: i.data.n || E.poolList(i.data.pool || {}).length, pool: i.data.pool || {}, style: i.data.style || "balanced", updatedAt: i.updatedAt }));
    A.groups = by("group").map(i => ({ id: i.id, name: i.name, players: i.data.players || [], updatedAt: i.updatedAt }));
    A.customLib = by("role").map(i => Object.assign({}, i.data, { cloudId: i.id }));
    for (const r of A.customLib) A.s.customRoles[r.id] = r;
    saveLibrary();
  },

  games(): Item[] { return this.items.filter(i => i.kind === "game"); },

  /* ---------- account ---------- */
  async signup(username: string, password: string): Promise<string> {
    const j = await call("POST", "/api/auth", { action: "signup", username, password });
    this.host = j.host; this.status = "in"; emit();
    await this.refresh(true); this.scheduleGame(true);
    return j.recoveryCode;
  },
  async login(username: string, password: string) {
    const j = await call("POST", "/api/auth", { action: "login", username, password });
    this.host = j.host; this.status = "in"; emit();
    await this.refresh(true); this.scheduleGame(true);
    toast(`Signed in as ${j.host.displayName}`);
  },
  async recover(username: string, recoveryCode: string, password: string): Promise<string> {
    const j = await call("POST", "/api/auth", { action: "recover", username, recoveryCode, password });
    this.host = j.host; this.status = "in"; emit();
    await this.refresh(true);
    return j.recoveryCode;
  },
  async logout() {
    try { await call("POST", "/api/auth", { action: "logout" }); } catch { /* the cookie is cleared either way below */ }
    this.signedOut(); toast("Signed out. Your saves stay in your account.");
  },
  signedOut() {
    // the account's copies leave this device; anything never synced stays
    A.presets = A.presets.filter(p => !p.id || !this.items.some(i => i.id === p.id));
    A.groups = A.groups.filter(g => !g.id || !this.items.some(i => i.id === g.id));
    A.customLib = A.customLib.filter(r => !r.cloudId);
    saveLibrary();
    this.host = null; this.status = "out"; this.items = []; emit();
  },

  /* ---------- saving library items (account when signed in, this device otherwise) ---------- */
  async saveSetup(p: Preset) {
    const id = p.id || uuid(); const entry: Preset = Object.assign({}, p, { id });
    A.presets = [entry, ...A.presets.filter(x => x.id !== id)]; saveLibrary(); emit();
    if (!this.host) { toast("Setup saved on this device"); return; }
    try { const it = await this.put("setup", id, p.name, { n: p.n, style: p.style }, { pool: p.pool, style: p.style, n: p.n }); this.upsertItem(Object.assign(it, { data: { pool: p.pool, style: p.style, n: p.n } })); toast("Setup saved to your account"); }
    catch (e: any) { toast(e.message); }
  },
  async deleteSetup(i: number) { const p = A.presets[i]; A.presets.splice(i, 1); saveLibrary(); emit(); if (this.host && p && p.id) await this.remove(p.id); },
  async saveGroup(g: Group) {
    const id = g.id || uuid(); const entry: Group = Object.assign({}, g, { id });
    A.groups = [entry, ...A.groups.filter(x => x.id !== id)]; saveLibrary(); emit();
    if (!this.host) { toast("Group saved on this device"); return; }
    try { const it = await this.put("group", id, g.name, { players: g.players.length }, { players: g.players }); this.upsertItem(Object.assign(it, { data: { players: g.players } })); toast("Group saved to your account"); }
    catch (e: any) { toast(e.message); }
  },
  async deleteGroup(i: number) { const g = A.groups[i]; A.groups.splice(i, 1); saveLibrary(); emit(); if (this.host && g && g.id) await this.remove(g.id); },
  async saveRole(r: Role) {
    const cloudId = uuid(); const entry = Object.assign({}, r, { cloudId });
    A.customLib = A.customLib.filter(x => x.id !== r.id).concat([entry]); A.s.customRoles[r.id] = entry as Role; saveLibrary(); save();
    if (!this.host) return;
    try { const it = await this.put("role", cloudId, r.name, { team: r.team }, entry); this.upsertItem(Object.assign(it, { data: entry })); }
    catch (e: any) { toast(e.message); }
  },
  async deleteRole(roleId: string) {
    const r = A.customLib.find(x => x.id === roleId);
    A.customLib = A.customLib.filter(x => x.id !== roleId); saveLibrary(); emit();
    if (this.host && r && r.cloudId) await this.remove(r.cloudId);
  },
  async remove(id: string) {
    try { await call("DELETE", `/api/library?id=${encodeURIComponent(id)}`); this.items = this.items.filter(i => i.id !== id); emit(); }
    catch (e: any) { toast(e.message); }
  },
  upsertItem(it: Item) { this.items = [it].concat(this.items.filter(i => i.id !== it.id)); emit(); },

  /* ---------- games: every started game saves itself to the account ---------- */
  scheduleGame(now = false) {
    if (!this.host) return;
    const s = A.s; if (!s || s.phase === "setup" || !s.players.length) return;
    if (this.gameT) clearTimeout(this.gameT);
    this.gameT = setTimeout(() => this.saveGame(), now ? 50 : 2500);
  },
  async saveGame() {
    const s = A.s as Game & { cloudId?: string }; if (!this.host || !s || s.phase === "setup") return;
    if (!s.cloudId) { s.cloudId = uuid(); LS.set("omerta.game.v1", { s: A.s, hist: A.hist.slice(-25) }); }
    const sig = JSON.stringify(s); if (sig === this.lastGameSig) return;
    const names = s.players.map(p => p.name);
    const meta = { phase: s.phase, night: s.night, day: s.day, players: s.players.length, alive: s.players.filter(p => p.alive).length, names: names.slice(0, 5), line: phaseLine(s), faction: s.result ? s.result.faction : null };
    try {
      const it = await this.put("game", s.cloudId, `${s.players.length} players · ${phaseLine(s)}`, meta, s);
      this.lastGameSig = sig; this.upsertItem(it);
    } catch (e: any) { if (e.status === 401) this.signedOut(); /* otherwise retry on the next change */ }
  },
  async openGame(id: string) {
    try {
      const j = await call("GET", `/api/library?id=${encodeURIComponent(id)}`);
      const g = j.item.data; if (!g || g.v !== 1 || !Array.isArray(g.players)) { toast("That saved game can't be opened."); return; }
      A.s = g; A.hist = []; migrate(A.s); resetUi(); Object.assign(A.ui, { view: "command", setupStep: 0 });
      this.lastGameSig = JSON.stringify(g); save(); top0(); emit();
      toast(`Opened ${j.item.name}`);
    } catch (e: any) { toast(e.message); }
  },
  async deleteGame(id: string) { await this.remove(id); },
};
