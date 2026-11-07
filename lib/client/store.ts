"use client";
// The Game Master's state: the game (A.s), its undo history, preferences, the saved library and UI state.
// Every change goes through cmd() (undoable) or emit() (UI only); components re-render from useStore().
import { useSyncExternalStore } from "react";
import E from "@/lib/engine/engine";
import type { Game } from "@/lib/engine/engine";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const KEY = "omerta.game.v1", PKEY = "omerta.prefs.v1", PRKEY = "omerta.presets.v1", CRKEY = "omerta.customroles.v1", GKEY = "omerta.groups.v1";

export const LS = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k: string, v: unknown): boolean { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
};

export interface Preset { id?: string; name: string; n: number; pool: Record<string, number>; style: string; updatedAt?: string }
export interface Group { id?: string; name: string; players: string[]; updatedAt?: string }
export type Sheet = { type: string; [k: string]: any } | null;
export type Overlay = { type: string; [k: string]: any } | null;
export type View = "home" | "command" | "players" | "timeline" | "roles" | "settings";

export interface Ui {
  view: View; backTo: View | null; setupStep: number; nightIdx: number; draft: any; sheet: Sheet; overlay: Overlay;
  libQuery: string; libFilter: string; poolTab: string; poolQuery: string; tlMode: "all" | "public"; pfilter: "all" | "alive" | "dead";
  annFormat: string | null; annCustom: string; twistIdx: number; showAssign: boolean; peek: Record<string, boolean>; delivered: Record<string, boolean>;
  timer: { running: boolean; left: number; endAt: number; total: number } | null; pin: string; bulk: boolean; promptSel: Record<string, string>;
  debug: boolean; toast: string | null; quickN: number;
}

export const A = {
  ready: false,
  s: null as unknown as Game,
  hist: [] as { label: string; snap: string; t: number }[],
  prefs: { sound: true, disabled: [] as string[] },
  presets: [] as Preset[],
  customLib: [] as any[],
  groups: [] as Group[],
  ui: {
    view: "home", backTo: null, setupStep: 0, nightIdx: 0, draft: null, sheet: null, overlay: null, libQuery: "", libFilter: "all", poolTab: "town", poolQuery: "",
    tlMode: "all", pfilter: "all", annFormat: null, annCustom: "", twistIdx: 0, showAssign: false, peek: {}, delivered: {}, timer: null, pin: "", bulk: false, promptSel: {},
    debug: false, toast: null, quickN: 10,
  } as Ui,
};

/* ---------- subscription ---------- */
let version = 0;
const subs = new Set<() => void>();
export function emit() { version++; for (const f of subs) f(); }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function useStore() { useSyncExternalStore(subscribe, () => version, () => 0); return A; }

/* ---------- hooks other modules attach (online sync, cloud autosave) ---------- */
const afterSave: (() => void)[] = [];
export function onSave(f: () => void) { afterSave.push(f); }

export function boot() {
  if (A.ready) return;
  A.prefs = Object.assign({ sound: true, disabled: [] as string[] }, LS.get(PKEY, {}));
  A.presets = LS.get<Preset[]>(PRKEY, []); A.customLib = LS.get<any[]>(CRKEY, []); A.groups = LS.get<Group[]>(GKEY, []);
  const saved = LS.get<{ s?: Game; hist?: any[] } | null>(KEY, null);
  if (saved && saved.s && saved.s.v === 1) { A.s = saved.s; A.hist = saved.hist || []; A.ui.view = A.s.phase === "setup" && !A.s.players.length ? "home" : "command"; }
  else { A.s = E.newGame(); A.ui.view = "home"; }
  migrate(A.s);
  A.ready = true;
}
export function migrate(s: Game) {
  for (const r of A.customLib) if (!s.customRoles[r.id]) s.customRoles[r.id] = r;
  s.setup.disabled = A.prefs.disabled.slice();
  if ((s.config.cfgv || 1) < 2) { s.config.godfatherInnocent = false; s.config.nkSuspicious = false; s.config.cfgv = 2; } // Police: thumbs up only for Mafia
  if ((s.config.cfgv || 1) < 3) { s.config.mayorWeight = "auto"; s.config.mayorOnce = false; s.config.cfgv = 3; } // Mayor: 3 votes above 7 alive, then 2
}

export function save() {
  for (const f of afterSave) { try { f(); } catch { /* a sync hook must never break saving */ } }
  if (LS.set(KEY, { s: A.s, hist: A.hist.slice(-25) })) return;
  if (LS.set(KEY, { s: A.s, hist: A.hist.slice(-5) })) return;
  LS.set(KEY, { s: A.s, hist: [] });
}
export function savePrefs() { LS.set(PKEY, A.prefs); }
export function saveLibrary() { LS.set(PRKEY, A.presets); LS.set(GKEY, A.groups); LS.set(CRKEY, A.customLib); }

/** Runs an undoable change to the game. Returns false (and restores the game) if it throws. */
export function cmd(label: string, fn: (s: Game) => unknown): boolean {
  const snap = JSON.stringify(A.s);
  let r: unknown;
  try { r = fn(A.s); }
  catch (err: any) { console.error(err); A.s = JSON.parse(snap); toast(err && err.message ? err.message : "That action could not be completed."); emit(); return false; }
  if (r && typeof r === "object" && Array.isArray((r as Game).players) && r !== A.s) A.s = r as Game;
  A.hist.push({ label, snap, t: Date.now() }); if (A.hist.length > 80) A.hist.shift();
  save(); emit(); return true;
}
export function undo() {
  const h = A.hist.pop(); if (!h) return;
  A.s = JSON.parse(h.snap); A.ui.sheet = null; A.ui.draft = null; save(); toast("Undone: " + h.label); emit();
}
export function lastHist(label: string) { return A.hist.map(h => h.label).lastIndexOf(label); }

/** Mutates the game without an undo step (setup tweaks, rule toggles). */
export function setupMut(fn: (s: Game) => void) { fn(A.s); save(); emit(); }
export function ui(patch: Partial<Ui>) { Object.assign(A.ui, patch); emit(); }

let toastT: ReturnType<typeof setTimeout> | null = null;
export function toast(msg: string) {
  A.ui.toast = msg; emit();
  if (toastT) clearTimeout(toastT);
  toastT = setTimeout(() => { A.ui.toast = null; emit(); }, 2800);
}
export function confirmSheet(o: { title: string; body?: string; ok?: string; danger?: boolean; onOk: () => void; detail?: string[] }) {
  A.ui.sheet = Object.assign({ type: "confirm" }, o); emit();
}
export const top0 = () => { try { window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }); } catch { window.scrollTo(0, 0); } };

export function resetUi() {
  Object.assign(A.ui, { nightIdx: 0, draft: null, sheet: null, peek: {}, showAssign: false, delivered: {}, timer: null, promptSel: {}, annFormat: null, annCustom: "" });
}

/* ---------- small helpers used across views ---------- */
export const role = (id: string | null | undefined) => E.getRole(A.s, id);
export const P = (id: string) => E.getP(A.s, id)!;
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
export const teamName = (t: string | null | undefined) => ({ town: "Town", mafia: "Mafia", cult: "Cult", vampire: "Vampire", solo: "Solo killer", neutral: "Neutral" } as Record<string, string>)[t || ""] || "Neutral";
export function fmtDur(ms: number) { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; }
export function effN() { const s = A.s; return Math.max(5, Math.min(40, Math.max(s.players.length, s.setup.targetN || 10))); }
/** The group's recent games for "For you" and the twist; filled in by history.ts (which needs the account too). */
export const taste = { history: (): { id?: string; at?: number; n?: number; roles: Record<string, number>; liked?: number }[] => [] };
export function autoPool(s: Game) { if (!s.setup.poolTouched) s.setup.pool = E.recommend(Math.max(5, Math.min(40, Math.max(s.players.length, s.setup.targetN || 10))), s.setup.style, s.setup.seed, s, taste.history()).pool; }
export function roleCount() { return E.poolList(A.s.setup.pool).length; }
export function afterPlayersChange(s: Game) {
  s.setup.dealt = false; s.setup.revealed = false;
  for (const p of s.players) if (!p.lock) p.roleId = null;
  if (s.players.length > (s.setup.targetN || 0)) s.setup.targetN = s.players.length;
  autoPool(s);
}

/** The colour of the room: which act the whole screen should be lit in right now. */
export function actOf(s: Game | null, view: View): string {
  if (!s || view === "home" || s.phase === "setup") return "dusk";
  if (s.phase === "ended") {
    const f = s.result ? s.result.faction : "draw";
    return f === "town" ? "win-town" : f === "mafia" ? "win-mafia" : f === "draw" ? "win-draw" : "win-solo";
  }
  if (s.phase === "night" || s.phase === "reveal-done") return "night";
  if (s.phase === "dawn") return "dawn";
  if (s.phase === "day") return s.dayState && s.dayState.open ? "vote" : "day";
  return "dusk";
}
