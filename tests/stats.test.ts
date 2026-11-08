// Group stats and self-tuning balance, from finished-game records.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect } from "vitest";
import E from "@/lib/engine/engine";
import { groupStats } from "@/lib/client/stats";

const game = (n: number, faction: string, rows: [string, string, number, number][]) => ({ n, result: { faction, players: rows } });

describe("group stats", () => {
  const history = [ // newest first
    game(6, "mafia", [["Riya", "mafia", 1, 1], ["Kabir", "doctor", 0, 0], ["Dev", "police", 0, 1], ["Isha", "villager", 0, 0], ["Neha", "villager", 0, 1], ["Aman", "jester", 0, 1]]),
    game(6, "mafia", [["Riya", "godfather", 1, 1], ["Kabir", "villager", 0, 0], ["Dev", "doctor", 0, 0], ["Isha", "police", 0, 1], ["Neha", "villager", 0, 1], ["Aman", "villager", 0, 0]]),
    game(6, "town", [["riya", "mafia", 1, 0], ["Kabir", "police", 1, 1], ["Dev", "villager", 1, 1], ["Isha", "doctor", 1, 1], ["Neha", "mafia", 0, 0], ["Aman", "jester", 1, 0]]),
    { n: 6, roles: { mafia: 1 } }, // started but never finished: ignored
  ];
  const g = groupStats(history as any);
  test("counts finished games and who won them", () => {
    expect(g.games).toBe(3);
    expect(g.factions).toEqual({ town: 1, mafia: 2, neutral: 0, draw: 0 });
  });
  test("one record per player, names matched without case", () => {
    const riya = g.players.find(p => p.name.toLowerCase() === "riya")!;
    expect(riya.games).toBe(3); expect(riya.wins).toBe(3); expect(riya.bySide.mafia).toEqual({ games: 3, wins: 3 });
    expect(riya.streak).toBe(3);
    expect(g.players[0].name.toLowerCase()).toBe("riya"); // most wins first
  });
  test("highlights and badges", () => {
    expect(g.highlights.some(h => /Riya wins 100% as Mafia \(3 of 3\)/i.test(h))).toBe(true);
    const riya = g.players.find(p => p.name.toLowerCase() === "riya")!;
    expect(riya.badges.map(b => b.label)).toEqual(expect.arrayContaining(["Mastermind", "On a roll"]));
    expect(g.players.find(p => p.name === "Aman")!.badges.map(b => b.label)).toContain("Jester’s joke");
  });
  test("table sizes with at least two games", () => {
    expect(g.bySize).toEqual([{ n: 6, games: 3, mafia: 2, town: 1 }]);
  });
});

describe("self-tuning balance", () => {
  const base = E.recommend(10, "basic").pool;
  const results = (mafiaWins: number, townWins: number, n = 10) =>
    Array.from({ length: mafiaWins + townWins }, (_, i) => ({ n, roles: {}, result: { faction: i < mafiaWins ? "mafia" : "town", players: [] } }));
  test("the Mafia keeps winning: one fewer Mafia", () => {
    const t = E.groupTune(null, base, 10, results(4, 1) as any);
    expect(t.pool.mafia).toBe(base.mafia - 1); expect(t.pool.villager).toBe(base.villager + 1);
    expect(t.note).toMatch(/Mafia won 4 of your last 5 games at about 10 players/);
    expect(E.recommend(10, "basic", 1, null, results(4, 1) as any).pool.mafia).toBe(base.mafia - 1);
  });
  test("the Town keeps winning: one more Mafia, never more than a third of the table", () => {
    const t = E.groupTune(null, E.recommend(12, "basic").pool, 12, results(0, 5, 12) as any);
    expect(t.pool.mafia).toBe(E.recommend(12, "basic").pool.mafia + 1);
    expect(t.note).toMatch(/Town won 5 of your last 5 games/);
    for (let n = 5; n <= 30; n++) { const p = E.groupTune(null, E.recommend(n, "basic").pool, n, results(0, 6, n) as any).pool; expect(p.mafia * 3).toBeLessThanOrEqual(n); expect(E.seatList(p).length).toBe(n); }
  });
  test("too few games, or a different table size: no change", () => {
    expect(E.groupTune(null, base, 10, results(3, 0) as any).pool).toEqual(base);
    expect(E.groupTune(null, base, 10, results(5, 0, 16) as any).pool).toEqual(base);
    expect(E.groupTune(null, base, 10, results(2, 2) as any).note).toBe("");
  });
});
