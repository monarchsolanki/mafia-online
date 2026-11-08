// Review fixes in the client: shared-setup links are validated, forced endings stay out of group stats.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect } from "vitest";
import E from "@/lib/engine/engine";
import { decodeSetup } from "@/lib/client/share";
import { resultOf } from "@/lib/client/results";

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("shared setup links", () => {
  test("custom roles keep only the editor's fields, within its limits", () => {
    const sh = decodeSetup(enc({ v: 1, name: "Test", pool: { villager: 4, mafia: 1, c_x: 1 }, custom: [{ id: "c_x", name: "X", kind: "control", team: "cult", uses: 99, attack: 7, nights: "always", def: 9, clue: "evil", w: 50, tags: "oops", icon: "<svg>" }] }))!;
    const c = sh.custom![0] as any;
    expect(c.kind).toBe("none"); expect(c.team).toBe("town"); expect(c.uses).toBe(9); expect(c.attack).toBe(3); expect(c.nights).toBe("all"); expect(c.def).toBe(3);
    expect(c.icon).toBe("star"); expect(c.w).toBeUndefined(); expect(c.clue).toBeUndefined(); expect(c.tags).toBeUndefined();
  });
  test("a custom role with a non-Latin name still travels", () => {
    const sh = decodeSetup(enc({ v: 1, name: "Hindi", pool: { villager: 4, mafia: 1, c_: 1 }, custom: [{ id: "c_", name: "डॉक्टर", kind: "heal", team: "town" }] }))!;
    expect(sh.pool.c_).toBe(1); expect(sh.custom![0].name).toBe("डॉक्टर"); expect(sh.custom![0].kind).toBe("heal");
  });
});

describe("results", () => {
  const ended = (forced: boolean) => {
    const s = E.newGame(); ["A", "B", "C", "D", "E"].forEach(n => E.addPlayer(s, n));
    ["mafia", "villager", "villager", "villager", "villager"].forEach((id, i) => E.setRole(s, s.players[i], id));
    E.startGame(s); const r = E.resolveNight(s); E.startDay(r);
    if (forced) E.endGame(r); else { E.quickExecute(r, r.players[0].id); E.endGame(r, r.winPrompt); }
    return r;
  };
  test("a game ended early is not a result", () => { expect(resultOf(ended(true))).toBeUndefined(); });
  test("a finished game is", () => { expect(resultOf(ended(false))!.faction).toBe("town"); });
});
