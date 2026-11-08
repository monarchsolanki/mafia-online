"use client";
// Which roles the group has played lately, for "Tonight's twist". Kept on this device, and merged with the role lists
// saved in the host's account games when signed in, so a new phone still knows what the group played.
import type { Game } from "@/lib/engine/engine";
import { A, LS, taste } from "./store";
import { Cloud } from "./cloud";
import { resultOf, type GameResult } from "./results";

export const HKEY = "omerta.history.v1";
export interface Played { id: string; at: number; n: number; roles: Record<string, number>; liked?: number; result?: GameResult }

export function rolesOf(s: Game): Record<string, number> {
  const out: Record<string, number> = {};
  const list = s.initialRoles && s.initialRoles.length ? s.initialRoles.map(r => r.roleId) : s.players.map(p => p.roleId);
  for (const id of list) if (id) out[id] = (out[id] || 0) + 1;
  return out;
}
/** Called when a game starts. One entry per game; a restart of the same game replaces it. */
export function recordPlayed(s: Game) {
  const list = LS.get<Played[]>(HKEY, []).filter(h => h.id !== s.id);
  list.unshift({ id: s.id, at: Date.now(), n: s.players.length, roles: rolesOf(s) });
  LS.set(HKEY, list.slice(0, 60));
}
/** Called when a game ends: who played what and who won, for group stats and self-tuning. */
export function recordResult(s: Game) {
  const result = resultOf(s); if (!result) return;
  const list = LS.get<Played[]>(HKEY, []);
  const h = list.find(x => x.id === s.id);
  if (h) h.result = result; else list.unshift({ id: s.id, at: s.startedAt || Date.now(), n: s.players.length, roles: rolesOf(s), result });
  LS.set(HKEY, list.slice(0, 60));
}
/** The Game Master's verdict at the end: 1 good game, -1 not for us, 0 cleared. */
export function rateGame(s: Game, liked: number) {
  const list = LS.get<Played[]>(HKEY, []);
  const h = list.find(x => x.id === s.id);
  if (h) h.liked = liked; else list.unshift({ id: s.id, at: s.startedAt || Date.now(), n: s.players.length, roles: rolesOf(s), liked, result: resultOf(s) });
  LS.set(HKEY, list.slice(0, 60));
}
/** Recent games, newest first, from this device and the account. */
export function playedHistory(): Played[] {
  const byId = new Map<string, Played>();
  for (const h of LS.get<Played[]>(HKEY, [])) byId.set(h.id, h);
  for (const g of Cloud.games()) {
    const m = (g.meta || {}) as { gid?: string; roles?: Record<string, number>; startedAt?: number; players?: number; liked?: number; result?: GameResult };
    if (!m.roles || !m.gid) continue;
    const mine = byId.get(m.gid);
    if (mine) { if (mine.liked === undefined && m.liked !== undefined) mine.liked = m.liked; if (!mine.result && m.result) mine.result = m.result; continue; }
    byId.set(m.gid, { id: m.gid, at: m.startedAt || new Date(g.createdAt || g.updatedAt).getTime(), n: m.players || 0, roles: m.roles, liked: m.liked, result: m.result });
  }
  return [...byId.values()].sort((a, b) => b.at - a.at).slice(0, 60);
}

/** What "For you" learns from: recent games plus every saved setup (a setup the host kept is one they like). */
export function tasteHistory(): (Played | { roles: Record<string, number>; n: number; saved: true })[] {
  const saved = A.presets.filter(p => p.pool && Object.keys(p.pool).length).map(p => ({ roles: p.pool, n: p.n, saved: true as const }));
  return [...playedHistory(), ...saved];
}

taste.history = tasteHistory;
