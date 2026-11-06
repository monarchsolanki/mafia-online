// Phones make their own night choices and the Mafia talk in silence: the Game Master's phone computes what each
// phone may do, the server checks every choice against it, and the Game Master's phone applies it through the engine.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect } from "vitest";
import E from "@/lib/engine/engine";
import { A } from "@/lib/client/store";
import { playerView, publicView, applyRemoteNight, nightKeyOf } from "@/lib/client/online";
import { handleRoom } from "@/lib/server/rooms";
import { memoryStore } from "@/lib/server/store";

function game(phoneActions: string, mafiaChat = "night") {
  const roles = ["godfather", "mafia", "doctor", "police", "villager", "villager"];
  const s: any = E.newGame();
  ["Rahul", "Priya", "Kabir", "Dev", "Isha", "Neha"].forEach(n => E.addPlayer(s, n));
  s.players.forEach((p: any, i: number) => E.setRole(s, p, roles[i]));
  s.setup.pool = {}; roles.forEach(r => { s.setup.pool[r] = (s.setup.pool[r] || 0) + 1; }); s.setup.dealt = true;
  s.initialRoles = s.players.map((p: any) => ({ id: p.id, roleId: p.roleId, team: p.team }));
  Object.assign(s.config, { phoneActions, mafiaChat });
  E.startGame(s);
  const by = (n: string) => s.players.find((p: any) => p.name === n);
  return { s, by };
}

describe("what each phone may do at night", () => {
  test("off: no phone gets night choices; the chat still opens for 2+ Mafia", () => {
    const { s, by } = game("off");
    for (const p of s.players) expect(playerView(s, p).night).toBeUndefined();
    expect(playerView(s, by("Rahul")).chat).toMatchObject({ label: "The Mafia", open: true, members: ["Priya"] });
    expect(playerView(s, by("Kabir")).chat).toBeUndefined();
  });

  test("mafia: only the Mafia choose, teammates can't be the victim, nobody else learns anything", () => {
    const { s, by } = game("mafia");
    const v = playerView(s, by("Priya"));
    expect(v.night.key).toBe(nightKeyOf(s));
    expect(v.night.steps).toHaveLength(1);
    const st = v.night.steps[0];
    expect(st).toMatchObject({ key: "mafia", type: "faction", verb: "Kill" });
    expect(st.carriers.map((c: any) => c.name).sort()).toEqual(["Priya", "Rahul"]);
    expect(st.targets.map((t: any) => t.name)).not.toContain("Rahul");
    expect(st.targets.every((t: any) => t.ok)).toBe(true);
    expect(playerView(s, by("Kabir")).night).toBeUndefined(); // the Doctor is called by the Game Master
    for (const n of ["Kabir", "Dev", "Isha"]) expect(JSON.stringify(playerView(s, by(n)))).not.toMatch(/"mafia"|Godfather/);
  });

  test("all: each role sees only its own step; the Drunk is never told", () => {
    const { s, by } = game("all");
    const d = playerView(s, by("Kabir"));
    expect(d.night.steps.map((x: any) => x.key)).toEqual([by("Kabir").id]);
    expect(d.night.steps[0].title).toBe("Doctor");
    expect(d.night.steps[0].abilities[0]).toMatchObject({ kind: "heal", ok: true });
    expect(JSON.stringify(d)).not.toContain("drunk");
    expect(playerView(s, by("Isha")).night).toBeUndefined();
    expect(playerView(s, by("Rahul")).night.steps.map((x: any) => x.key)).toContain("mafia");
  });

  test("chat closes by day unless always on; a lone Mafia member has no chat", () => {
    const { s, by } = game("off");
    E.startDay(s);
    expect(playerView(s, by("Rahul")).chat.open).toBe(false);
    s.config.mafiaChat = "always"; expect(playerView(s, by("Rahul")).chat.open).toBe(true);
    s.config.mafiaChat = "off"; expect(playerView(s, by("Rahul")).chat).toBeUndefined();
    s.config.mafiaChat = "night"; by("Priya").alive = false;
    expect(playerView(s, by("Rahul")).chat).toBeUndefined();
  });
});

describe("from the phone to the resolved night", () => {
  test("phones choose, the server checks, the Game Master's phone records it, the engine resolves it", async () => {
    const { s, by } = game("all");
    A.s = s; A.hist = [];
    const store = memoryStore();
    const call = (method: string, q: any, b?: any) => handleRoom(store, method, q || {}, b || {});
    const sync = () => {
      const views: Record<string, any> = {}; for (const p of s.players) views[p.id] = playerView(A.s, p);
      return call("POST", { action: "sync" }, { code, hostSecret, version: Date.now(), seats: A.s.players.map((p: any) => ({ id: p.id, name: p.name })), views, publicView: publicView(A.s) });
    };
    const { code, hostSecret } = await call("POST", { action: "create" });
    await sync();
    const tok: Record<string, string> = {};
    for (const n of ["Rahul", "Priya", "Kabir", "Isha"]) tok[n] = (await call("POST", { action: "claim" }, { code, seatId: by(n).id })).token;
    const key = nightKeyOf(A.s);
    const act = (n: string, b: any) => call("POST", { action: "act" }, Object.assign({ code, seat: by(n).id, token: tok[n], nightKey: key }, b));

    await expectErr(act("Priya", { stepKey: "mafia", targets: [by("Rahul").id], opts: { carrier: by("Priya").id } }), 400); // a teammate
    await act("Priya", { stepKey: "mafia", targets: [by("Kabir").id], opts: { carrier: by("Priya").id } });
    await act("Rahul", { stepKey: "mafia", targets: [by("Isha").id], opts: { carrier: by("Priya").id } }); // the last choice counts
    await act("Kabir", { stepKey: by("Kabir").id, ab: "heal", targets: [by("Kabir").id] });
    await expectErr(act("Isha", { stepKey: by("Isha").id, pass: true }), 409); // a Villager has no night to answer

    const st = await call("POST", { action: "status" }, { code, hostSecret, nightKey: key });
    expect(applyRemoteNight(st.night, key)).toBe(true);
    const kill = A.s.actions.find((a: any) => a.key === "mafia");
    expect(kill).toMatchObject({ actor: by("Priya").id, targets: [by("Isha").id] });
    expect(A.s.actions.find((a: any) => a.key === by("Kabir").id)).toMatchObject({ ab: "heal", targets: [by("Kabir").id] });
    expect(A.s.nightUi!.phone![by("Kabir").id]).toMatchObject({ by: "Kabir" });
    expect(applyRemoteNight(st.night, key)).toBe(false); // each phone change applies once

    // the Mafia now see what is locked in; the Doctor sees only their own step
    await sync();
    const vm = await call("GET", { action: "view", code, seat: by("Rahul").id, token: tok.Rahul });
    expect(vm.view.night.steps.find((x: any) => x.key === "mafia").current).toMatchObject({ names: ["Isha"], carrierName: "Priya" });
    const vd = await call("GET", { action: "view", code, seat: by("Kabir").id, token: tok.Kabir });
    expect(JSON.stringify(vd)).not.toMatch(/"mafia"|factionKill|Godfather/); expect(Object.keys(vd.sent)).toEqual([by("Kabir").id]);

    A.s = E.resolveNight(A.s);
    expect(A.s.deaths.map((d: any) => d.id)).toEqual([by("Isha").id]);
    await sync();
    await expectErr(act("Kabir", { stepKey: by("Kabir").id, ab: "heal", targets: [by("Dev").id] }), 409); // the night is over
  });
});

async function expectErr(p: Promise<unknown>, status: number) {
  try { await p; } catch (e: any) { expect(e.status, e.message).toBe(status); return; }
  throw new Error(`expected an error with status ${status}`);
}
