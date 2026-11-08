// Group stats from finished games: who wins, with which side, how often, and a few badges for bragging rights.
import E from "@/lib/engine/engine";
import type { GameResult } from "./results";

type Side = "town" | "mafia" | "neutral";
export interface Badge { label: string; why: string }
export interface PlayerStat {
  name: string; games: number; wins: number; survived: number; streak: number;
  bySide: Record<Side, { games: number; wins: number }>; byRole: Record<string, { games: number; wins: number }>; badges: Badge[];
}
export interface GroupStats {
  games: number; factions: { town: number; mafia: number; neutral: number; draw: number };
  players: PlayerStat[]; highlights: string[]; bySize: { n: number; games: number; mafia: number; town: number }[];
}
const sideOf = (roleId: string): Side => { const r = E.getRole(null, roleId); return !r ? "neutral" : r.team === "town" ? "town" : r.team === "mafia" ? "mafia" : "neutral"; };
const SIDE_NAME: Record<Side, string> = { town: "Town", mafia: "Mafia", neutral: "a Neutral" };
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** history: newest first; only entries with a result count. */
export function groupStats(history: { n?: number; result?: GameResult }[]): GroupStats {
  const done = history.filter(h => h.result && h.result.players && h.result.players.length);
  const factions = { town: 0, mafia: 0, neutral: 0, draw: 0 };
  const byName = new Map<string, PlayerStat>();
  for (const h of done) {
    const f = h.result!.faction; if (f === "town" || f === "mafia" || f === "draw") factions[f]++; else factions.neutral++;
    for (const [name, role, won, alive] of h.result!.players) {
      const key = name.trim().toLowerCase(); if (!key) continue;
      let p = byName.get(key);
      if (!p) { p = { name, games: 0, wins: 0, survived: 0, streak: 0, bySide: { town: { games: 0, wins: 0 }, mafia: { games: 0, wins: 0 }, neutral: { games: 0, wins: 0 } }, byRole: {}, badges: [] }; byName.set(key, p); }
      const side = sideOf(role);
      p.games++; p.wins += won; p.survived += alive; p.bySide[side].games++; p.bySide[side].wins += won;
      const br = (p.byRole[role] = p.byRole[role] || { games: 0, wins: 0 }); br.games++; br.wins += won;
    }
  }
  // current winning streak (newest games first)
  for (const p of byName.values()) {
    let k = 0;
    for (const h of done) { const row = h.result!.players.find(r => r[0].trim().toLowerCase() === p.name.trim().toLowerCase()); if (!row) continue; if (row[2]) k++; else break; }
    p.streak = k;
  }
  const players = [...byName.values()].sort((a, b) => b.wins - a.wins || pct(b.wins, b.games) - pct(a.wins, a.games) || a.name.localeCompare(b.name));
  // badges go to the single best player for each, with a minimum so they mean something
  const award = (label: string, why: (p: PlayerStat) => string, score: (p: PlayerStat) => number, min: number) => {
    const best = players.filter(p => score(p) >= min).sort((a, b) => score(b) - score(a))[0];
    if (best) best.badges.push({ label, why: why(best) });
  };
  award("Mastermind", p => `${p.bySide.mafia.wins} wins as Mafia`, p => p.bySide.mafia.wins, 2);
  award("Town hero", p => `${p.bySide.town.wins} wins for the Town`, p => p.bySide.town.wins, 2);
  award("Survivor", p => `alive at the end of ${pct(p.survived, p.games)}% of games`, p => (p.games >= 3 ? p.survived / p.games : 0), 0.5);
  award("On a roll", p => `${p.streak} wins in a row`, p => p.streak, 3);
  award("Regular", p => `${p.games} games played`, p => p.games, 10);
  for (const p of players) if ((p.byRole.jester && p.byRole.jester.wins) || 0) p.badges.push({ label: "Jester’s joke", why: "fooled the town into an execution" });
  // the lines worth reading out
  const highlights: string[] = [];
  for (const p of players) for (const side of ["mafia", "town", "neutral"] as Side[]) {
    const b = p.bySide[side]; if (b.games >= 3 && pct(b.wins, b.games) >= 60) highlights.push(`${p.name} wins ${pct(b.wins, b.games)}% as ${SIDE_NAME[side]} (${b.wins} of ${b.games}).`);
  }
  highlights.sort((a, b) => parseInt(b.split(" wins ")[1]) - parseInt(a.split(" wins ")[1]));
  // how each side does at each table size
  const sizes = new Map<number, { n: number; games: number; mafia: number; town: number }>();
  for (const h of done) { const n = h.n || h.result!.players.length; const z = sizes.get(n) || { n, games: 0, mafia: 0, town: 0 }; z.games++; if (h.result!.faction === "mafia") z.mafia++; if (h.result!.faction === "town") z.town++; sizes.set(n, z); }
  return { games: done.length, factions, players, highlights: highlights.slice(0, 6), bySize: [...sizes.values()].filter(z => z.games >= 2).sort((a, b) => a.n - b.n) };
}
