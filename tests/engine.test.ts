// @ts-nocheck — rule scripts drive the untyped engine directly
// Rules-engine tests: Mayor votes, the one-time Mayor option, phone voting, Investigator clues.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from "vitest";
import Engine from "@/lib/engine/engine";

const E: any = Engine;
let pass = 0; const fails: string[] = [];
const ok = (c: unknown, m: string) => { if (c) pass++; else fails.push(m); };

function dayWith(n: number, cfg: Record<string, any> = {}) {
  let s = E.newGame(); Object.assign(s.config, cfg);
  for (let i = 0; i < n; i++) E.addPlayer(s, 'P' + i);
  s.players.forEach((p, i) => E.setRole(s, p, i === 0 ? 'mayor' : i === n - 1 ? 'mafia' : 'villager'));
  E.startGame(s); s = E.resolveNight(s); E.startDay(s);
  return s;
}
const mayor = (s: any) => s.players.find(p => p.roleId === 'mayor');
const everyone = (s: any) => s.players.filter(p => p.alive).map(p => p.id);

/* ---------- Mayor: 3 votes while more than 7 are alive, then 2 ---------- */
{
  let s = dayWith(9); E.mayorReveal(s, mayor(s).id);
  ok(E.voteWeight(s, mayor(s)) === 3, 'mayor: 9 alive -> 3 votes');
  s.players[3].alive = false; ok(E.voteWeight(s, mayor(s)) === 3, 'mayor: 8 alive -> still 3 votes');
  s.players[4].alive = false; ok(E.voteWeight(s, mayor(s)) === 2, 'mayor: 7 alive -> 2 votes');
  s.players[5].alive = false; ok(E.voteWeight(s, mayor(s)) === 2, 'mayor: 6 alive -> 2 votes');
  ok(E.voteWeight(s, s.players[1]) === 1, 'mayor: other players always 1 vote');
  s = dayWith(9); ok(E.voteWeight(s, mayor(s)) === 1, 'mayor: not revealed -> 1 vote');
  s = dayWith(9, { mayorWeight: '4' }); E.mayorReveal(s, mayor(s).id); ok(E.voteWeight(s, mayor(s)) === 4, 'mayor: a fixed weight still works');
  s = dayWith(9, { mayorWeight: 3 }); E.mayorReveal(s, mayor(s).id); ok(E.voteWeight(s, mayor(s)) === 3, 'mayor: an older numeric setting still reads');
  s = dayWith(9); E.mayorReveal(s, mayor(s).id); E.openVote(s, everyone(s));
  const target = s.players[2], other = s.players[3];
  E.castVote(s, mayor(s).id, target.id); E.castVote(s, s.players[1].id, other.id); E.castVote(s, s.players[4].id, other.id);
  const t = E.tally(s); ok(t.totals[target.id] === 3 && t.totals[other.id] === 2 && t.result.target === target.id, 'mayor: 3 votes beat two plain votes in the tally');
  s = dayWith(9); ok(/3 votes while more than 7/.test(E.playerCard(s, mayor(s).id).desc), 'mayor: the player card explains the rule');
}

/* ---------- Mayor: the one-time option ---------- */
{
  let s = dayWith(9, { mayorOnce: true }); E.mayorReveal(s, mayor(s).id); E.openVote(s, everyone(s)); E.castVote(s, mayor(s).id, s.players[2].id);
  ok(E.voteWeight(s, mayor(s)) === 3, 'once: bonus available until the vote is locked');
  E.confirmVote(s); ok(mayor(s).fx.mayorSpent === true && E.voteWeight(s, mayor(s)) === 1, 'once: bonus gone after the Mayor voted in a confirmed vote');
  s = dayWith(9, { mayorOnce: false }); E.mayorReveal(s, mayor(s).id); E.openVote(s, everyone(s)); E.castVote(s, mayor(s).id, s.players[2].id); E.confirmVote(s);
  ok(E.voteWeight(s, mayor(s)) === 3, 'once off: the bonus stays after a vote');
  s = dayWith(9, { mayorOnce: true }); E.mayorReveal(s, mayor(s).id); E.openVote(s, everyone(s)); E.castVote(s, s.players[1].id, s.players[2].id); E.confirmVote(s);
  ok(E.voteWeight(s, mayor(s)) === 3, 'once: a Mayor who sat out the vote keeps the bonus');
  s = dayWith(9, { mayorOnce: true }); E.mayorReveal(s, mayor(s).id); E.quickExecute(s, s.players[2].id);
  ok(s.players[2].alive === false && s.dayState.done && mayor(s).fx.mayorSpent === true, 'once: naming the executed player uses the bonus');
  ok(s.votes.length === 1 && E.stats(s).voteRounds === 1 && E.stats(s).executions === 1, 'quick execute: counted in the stats');
  s = dayWith(9, { mayorOnce: true }); E.mayorReveal(s, mayor(s).id); E.openVote(s, everyone(s)); E.castVote(s, s.players[1].id, s.players[2].id); E.quickExecute(s, s.players[2].id);
  ok(!mayor(s).fx.mayorSpent, 'once: naming someone while phones voted keeps the bonus of a Mayor who did not vote');
  s = dayWith(9, { mayorOnce: true }); E.mayorReveal(s, mayor(s).id); E.skipVote(s);
  ok(!mayor(s).fx.mayorSpent, 'once: skipping the vote keeps the bonus');
  s = dayWith(9, { mayorOnce: true }); E.mayorReveal(s, mayor(s).id); E.mayorBonusSet(s, mayor(s).id, true);
  ok(E.voteWeight(s, mayor(s)) === 1, 'once: marked used by hand'); E.mayorBonusSet(s, mayor(s).id, false); ok(E.voteWeight(s, mayor(s)) === 3, 'once: marked available again');
  s = dayWith(9, { mayorOnce: true }); ok(/one time only/.test(E.mayorRuleText(s)), 'once: the rule text says so');
}

/* ---------- Voting by phone can be closed again ---------- */
{
  const s = dayWith(9); E.openVote(s, everyone(s)); E.castVote(s, s.players[1].id, s.players[2].id); E.cancelVote(s);
  ok(!s.dayState.open && !s.dayState.done && Object.keys(s.dayState.votes).length === 0, 'cancelVote: closes the vote without ending the day');
}

/* ---------- Investigator: four roles from this game, never more than one evil ---------- */
function nightOne(roles: string[]) {
  const s = E.newGame(); roles.forEach((r, i) => E.addPlayer(s, 'P' + i));
  s.players.forEach((p, i) => E.setRole(s, p, roles[i]));
  s.initialRoles = s.players.map(p => ({ id: p.id, roleId: p.roleId, team: p.team }));
  E.startGame(s); return s;
}
const evilCount = (s, list) => list.filter(r => E.evilRole(E.getRole(s, r.id))).length;
const invCheck = (s, inv, target) => { const act = { key: inv.id, actor: inv.id, ab: 'inv', targets: [target.id], opts: {} }; return { act, pv: E.previewResult(s, act) }; };
{
  const roles = ['investigator', 'villager', 'villager', 'doctor', 'police', 'mayor', 'godfather', 'mafia', 'jester'];
  const s = nightOne(roles); const inv = s.players[0]; const inGame = new Set(roles.map(r => E.getRole(s, r).name));
  for (let t = 1; t < s.players.length; t++) {
    const target = s.players[t]; const { act, pv } = invCheck(s, inv, target);
    ok(pv.roles && pv.roles.length === 4, `investigator: ${target.roleId} gets exactly 4 roles`);
    ok(pv.roles && pv.roles.every(r => inGame.has(r.name)), `investigator: ${target.roleId} gets only roles that are in the game`);
    ok(pv.roles && pv.roles.some(r => r.id === target.roleId), `investigator: the true role of ${target.roleId} is on the list`);
    const evilTarget = E.evilRole(E.getRole(s, target.roleId));
    ok(pv.roles && (evilTarget ? evilCount(s, pv.roles) === 1 : evilCount(s, pv.roles) <= 1), `investigator: never more than one evil role for ${target.roleId}`);
    if (evilTarget) ok(pv.roles.filter(r => E.evilRole(E.getRole(s, r.id))).every(r => r.id === target.roleId), `investigator: an evil ${target.roleId} is the only evil role listed`);
    E.setAction(s, act); const res = E.resolveNight(s).reports[1].messages.find(m => m.to === inv.id && m.tag === 'result');
    ok(res && JSON.stringify(res.roles) === JSON.stringify(pv.roles), `investigator: the real result matches the preview for ${target.roleId}`); E.clearAction(s, inv.id);
  }
  // many different nights and investigators: the rule holds every time, and the decoys vary
  const seen = new Set(), decoys = new Set();
  for (let n = 1; n <= 40; n++) { s.night = n; const { pv } = invCheck(s, inv, s.players[1]); ok(pv.roles.length === 4 && evilCount(s, pv.roles) <= 1, `investigator: night ${n} keeps 4 roles with at most one evil`); seen.add(pv.roles.map(r => r.id).join()); decoys.add(evilCount(s, pv.roles)); }
  ok(seen.size > 1, 'investigator: the decoys change from night to night');
  ok(decoys.has(0) && decoys.has(1), 'investigator: a good target sometimes gets an evil decoy and sometimes not');
  for (let n = 1; n <= 40; n++) { s.night = n; const { pv } = invCheck(s, inv, s.players[6]); ok(pv.roles.some(r => r.id === 'godfather') && evilCount(s, pv.roles) === 1, `investigator: an evil target always shows exactly its own evil role (night ${n})`); }
  s.night = 1;

  // Mafia target in a game with two evil roles: the other evil role never appears beside it
  const g = nightOne(['investigator', 'villager', 'doctor', 'police', 'godfather', 'mafia', 'jester']);
  for (let n = 1; n <= 20; n++) { g.night = n; const { pv } = invCheck(g, g.players[0], g.players[4]); ok(pv.roles.length === 4 && pv.roles.some(r => r.id === 'godfather') && !pv.roles.some(r => r.id === 'mafia'), `investigator: Godfather listed with no second evil role (night ${n})`); }

  const small = nightOne(['investigator', 'villager', 'villager', 'villager', 'mafia']);
  const pv2 = invCheck(small, small.players[0], small.players[1]).pv;
  ok(pv2.roles.length >= 2 && pv2.roles.length <= 3 && pv2.roles.some(r => r.name === 'Villager') && pv2.roles.some(r => r.name === 'Investigator') && pv2.roles.every(r => ['Investigator', 'Villager', 'Mafia'].includes(r.name)), 'investigator: a small game lists every good in-game role it can, Mafia only as a decoy');

  // a Disguiser makes a Mafia member read as a good role; a Framer makes a Town member read as an evil one
  const d = nightOne(['investigator', 'villager', 'doctor', 'police', 'godfather', 'disguiser', 'framer', 'jester']);
  const dis = E.nightAbilities(d, d.players[5])[0], fra = E.nightAbilities(d, d.players[6])[0];
  E.setAction(d, { key: d.players[5].id, actor: d.players[5].id, ab: dis.id, targets: [d.players[4].id], opts: {} });
  const pvDis = invCheck(d, d.players[0], d.players[4]).pv;
  ok(pvDis.roles.length === 4 && pvDis.roles.some(r => r.id === 'villager') && !pvDis.roles.some(r => r.id === 'godfather') && evilCount(d, pvDis.roles) <= 1, 'investigator: a disguised Godfather reads as a Villager, never listed as Godfather');
  E.clearAction(d, d.players[5].id);
  E.setAction(d, { key: d.players[6].id, actor: d.players[6].id, ab: fra.id, targets: [d.players[2].id], opts: {} });
  const pvFra = invCheck(d, d.players[0], d.players[2]).pv;
  ok(pvFra.roles.length === 4 && !pvFra.roles.some(r => r.id === 'doctor') && evilCount(d, pvFra.roles) === 1, 'investigator: a framed Doctor reads as one evil role among good ones, without Doctor');

  const dr = nightOne(['drunk', 'villager', 'villager', 'doctor', 'police', 'mayor', 'godfather', 'mafia', 'jester']); dr.players[0].meta.fake = 'investigator';
  const ab = E.nightAbilities(dr, dr.players[0]).find(a => a.kind === 'clue');
  ok(!!ab, 'drunk: has a fake investigator ability');
  if (ab) {
    E.setAction(dr, { key: dr.players[0].id, actor: dr.players[0].id, ab: ab.id, targets: [dr.players[3].id], opts: {} });
    const names = new Set(['Drunk', 'Villager', 'Doctor', 'Police', 'Mayor', 'Godfather', 'Mafia', 'Jester']);
    const m1 = E.resolveNight(dr).reports[1].messages.find(m => m.to === dr.players[0].id && m.tag === 'result');
    const m2 = E.resolveNight(dr).reports[1].messages.find(m => m.to === dr.players[0].id && m.tag === 'result');
    ok(m1 && m1.roles.length === 4 && m1.roles.every(r => names.has(r.name)) && evilCount(dr, m1.roles) <= 1, 'drunk: a made-up clue looks real (4 in-game roles, at most one evil)');
    ok(m1 && m2 && m1.text === m2.text, 'drunk: a made-up clue is stable between runs');
  }
}


/* ---------- Jailkeeper against a roleblocker ---------- */
{
  const setup = () => {
    const s = nightOne(['mafia', 'investigator', 'jester', 'jailkeeper', 'consort', 'police', 'escort', 'villager']);
    const [harsh, deep, , twisha, virti, , esc] = s.players;
    const ab = (p, k) => E.nightAbilities(s, p).find(a => a.kind === k).id;
    return { s, harsh, deep, twisha, virti, esc, ab };
  };
  // the Mafia Roleblocker blocks the Jailkeeper: no jail, so the Mafia kill goes through
  {
    const { s, harsh, deep, twisha, virti, ab } = setup();
    E.setAction(s, { key: twisha.id, actor: twisha.id, ab: ab(twisha, 'jail'), targets: [harsh.id], opts: {} });
    E.setAction(s, { key: virti.id, actor: virti.id, ab: ab(virti, 'roleblock'), targets: [twisha.id], opts: {} });
    E.setAction(s, { key: 'mafia', actor: harsh.id, ab: 'factionKill', targets: [deep.id], opts: {} });
    const r = E.resolveNight(s); const rep = r.reports[1];
    ok(rep.deaths.some(d => d.id === deep.id), 'jailkeeper: a roleblocked Jailkeeper jails nobody, so the Mafia kill lands');
    ok(rep.messages.some(m => m.to === twisha.id && /roleblocked/.test(m.text)), 'jailkeeper: is told they were roleblocked');
    ok(!rep.messages.some(m => m.to === harsh.id && /jailed/.test(m.text)), 'jailkeeper: the would-be prisoner is not jailed');
    ok((rep.why || []).some(t => /jail on .* did not happen/.test(t)), 'jailkeeper: the dawn report explains why the jail failed');
  }
  // they target each other: the Jailkeeper wins
  {
    const { s, harsh, deep, twisha, virti, ab } = setup();
    E.setAction(s, { key: twisha.id, actor: twisha.id, ab: ab(twisha, 'jail'), targets: [virti.id], opts: {} });
    E.setAction(s, { key: virti.id, actor: virti.id, ab: ab(virti, 'roleblock'), targets: [twisha.id], opts: {} });
    const rep = E.resolveNight(s).reports[1];
    ok(rep.messages.some(m => m.to === virti.id && /jailed/.test(m.text)), 'jailkeeper: jailing the roleblocker who targets you wins');
    ok(!rep.messages.some(m => m.to === twisha.id && /roleblocked/.test(m.text)), 'jailkeeper: the jailed roleblocker blocks nobody');
  }
  // a Town Escort blocking the Jailkeeper stops the jail too
  {
    const { s, harsh, deep, twisha, esc, ab } = setup();
    E.setAction(s, { key: twisha.id, actor: twisha.id, ab: ab(twisha, 'jail'), targets: [harsh.id], opts: {} });
    E.setAction(s, { key: esc.id, actor: esc.id, ab: ab(esc, 'roleblock'), targets: [twisha.id], opts: {} });
    E.setAction(s, { key: 'mafia', actor: harsh.id, ab: 'factionKill', targets: [deep.id], opts: {} });
    ok(E.resolveNight(s).reports[1].deaths.some(d => d.id === deep.id), 'jailkeeper: any roleblock on the Jailkeeper stops the jail');
  }
  // no roleblock: the jail still cancels the Mafia kill, as before
  {
    const { s, harsh, deep, twisha, ab } = setup();
    E.setAction(s, { key: twisha.id, actor: twisha.id, ab: ab(twisha, 'jail'), targets: [harsh.id], opts: {} });
    E.setAction(s, { key: 'mafia', actor: harsh.id, ab: 'factionKill', targets: [deep.id], opts: {} });
    ok(E.resolveNight(s).reports[1].deaths.length === 0, 'jailkeeper: an unblocked jail on the carrier still stops the kill');
  }
}

/* ---------- Suggestions: the basic game, one-role twists, and "For you" ---------- */
{
  const want = { 5: [1, 1, 1, 2], 7: [2, 1, 1, 3], 10: [3, 1, 1, 5], 12: [3, 1, 1, 7], 13: [4, 1, 2, 6], 16: [5, 2, 2, 7], 20: [6, 2, 2, 10] };
  for (const [n, [m, d, p, v]] of Object.entries(want)) {
    const pool = E.recommend(+n, 'basic').pool;
    ok(pool.mafia === m && pool.doctor === d && pool.police === p && pool.villager === v && Object.keys(pool).length === 4, `basic: ${n} players → ${m} Mafia, ${d} Doctor, ${p} Police, ${v} Villagers`);
  }
  for (let n = 5; n <= 30; n++) { const pool = E.recommend(n, 'basic').pool; ok(E.poolList(pool).length === n && pool.mafia * 3 < n, `basic: ${n} players fills every seat, Mafia under a third`); }
  ok(E.newGame().setup.style === 'basic', 'basic: new games start from the basic setup');

  const base = E.recommend(10, 'basic').pool;
  const tw = E.suggestTwists(null, base, [], 10);
  ok(tw.length > 0, 'twist: there is always something to try');
  for (const t of tw.slice(0, 10)) {
    const next = Object.assign({}, base); next[t.remove]--; next[t.add] = (next[t.add] || 0) + 1;
    ok(E.poolList(next).length === 10 && !base[t.add] && Math.abs(t.balance.score) <= 3, `twist: ${t.removeName} → ${t.addName} changes one role and stays fair`);
  }
  const played = [{ roles: Object.assign({ jester: 1 }, base) }, { roles: Object.assign({ jester: 1 }, base) }];
  ok(E.suggestTwists(null, base, played, 10)[0].add !== 'jester', 'twist: prefers roles not played lately');

  ok(E.recommend(10, 'foryou', 1, null, []).note.includes('basic'), 'for you: without history it is the basic game');
  const liked = [
    { roles: { mafia: 2, godfather: 1, doctor: 1, police: 1, bodyguard: 1, jester: 1, villager: 3 }, liked: 1 },
    { roles: { mafia: 2, doctor: 1, police: 1, jester: 1, lookout: 1, villager: 4 }, liked: 1 },
    { roles: { mafia: 2, doctor: 1, police: 1, arsonist: 1, villager: 5 }, liked: -1 },
  ];
  const fy = E.forYou(null, 10, liked, 1);
  ok(E.poolList(fy.pool).length === 10 && Math.abs(fy.balance.score) <= 3, 'for you: fills every seat and stays fair');
  ok(fy.pool.jester >= 1, 'for you: brings back a role from games the group loved');
  ok(!fy.pool.arsonist, 'for you: leaves out roles from games the group disliked');
  ok(/From 2 games you liked/.test(fy.note) && /Jester/.test(fy.note), 'for you: explains itself');
  ok(JSON.stringify(E.forYou(null, 10, liked, 1).pool) === JSON.stringify(fy.pool), 'for you: same history, same suggestion');
}

test("every engine rule check passes", () => {
  expect(fails).toEqual([]);
  expect(pass).toBeGreaterThan(50);
});
