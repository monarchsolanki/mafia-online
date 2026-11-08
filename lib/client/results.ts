// A finished game in a few bytes, for group stats and self-tuning: who played what, who won, who survived.
import type { Game } from "@/lib/engine/engine";

export interface GameResult { faction: string; players: [name: string, role: string, won: number, alive: number][] }
export function resultOf(s: Game): GameResult | undefined {
  if (s.phase !== "ended" || !s.result) return undefined;
  const winners = new Set((s.result.winners || []).map(w => w.id));
  const init = (id: string) => (s.initialRoles || []).find(r => r.id === id);
  return { faction: s.result.faction, players: s.players.map(p => [p.name, (init(p.id) || { roleId: p.roleId || "" }).roleId, winners.has(p.id) ? 1 : 0, p.alive ? 1 : 0]) };
}
