// Rules-engine tests (no dependencies): node tests/engine.test.js
'use strict';
const path = require('path');
const E = require(path.join(__dirname, '..', 'js', 'engine.js'));
let pass = 0; const fails = [];
const ok = (c, m) => c ? pass++ : fails.push(m);

function dayWith(n, cfg = {}) {
  let s = E.newGame(); Object.assign(s.config, cfg);
  for (let i = 0; i < n; i++) E.addPlayer(s, 'P' + i);
  s.players.forEach((p, i) => E.setRole(s, p, i === 0 ? 'mayor' : i === n - 1 ? 'mafia' : 'villager'));
  E.startGame(s); s = E.resolveNight(s); E.startDay(s);
  return s;
}
const mayor = s => s.players.find(p => p.roleId === 'mayor');
const everyone = s => s.players.filter(p => p.alive).map(p => p.id);

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

/* ---------- Investigator: only roles in this game ---------- */
function nightOne(roles) {
  const s = E.newGame(); roles.forEach((r, i) => E.addPlayer(s, 'P' + i));
  s.players.forEach((p, i) => E.setRole(s, p, roles[i]));
  s.initialRoles = s.players.map(p => ({ id: p.id, roleId: p.roleId, team: p.team }));
  E.startGame(s); return s;
}
{
  const roles = ['investigator', 'villager', 'villager', 'doctor', 'police', 'mayor', 'godfather', 'mafia', 'jester'];
  const s = nightOne(roles); const inv = s.players[0]; const inGame = new Set(roles.map(r => E.getRole(s, r).name));
  for (let t = 1; t < s.players.length; t++) {
    const target = s.players[t]; const act = { key: inv.id, actor: inv.id, ab: 'inv', targets: [target.id], opts: {} };
    const pv = E.previewResult(s, act);
    ok(pv.roles && pv.roles.length >= 3, `investigator: ${target.roleId} gets 3+ names`);
    ok(pv.roles && pv.roles.every(r => inGame.has(r.name)), `investigator: ${target.roleId} gets only roles that are in the game`);
    ok(pv.roles && pv.roles.some(r => r.id === target.roleId), `investigator: the true role of ${target.roleId} is on the list`);
    E.setAction(s, act); const res = E.resolveNight(s).reports[1].messages.find(m => m.to === inv.id && m.tag === 'result');
    ok(res && JSON.stringify(res.roles) === JSON.stringify(pv.roles), `investigator: the real result matches the preview for ${target.roleId}`); E.clearAction(s, inv.id);
  }
  const pvDoc = E.previewResult(s, { key: inv.id, actor: inv.id, ab: 'inv', targets: [s.players[3].id], opts: {} });
  ok(!pvDoc.roles.some(r => ['Priest', 'Evil Guesser', 'Good Guesser', 'Werewolf'].includes(r.name)), 'investigator: no out-of-game roles even when the group has a single match');

  const d = nightOne(['drunk', 'villager', 'villager', 'doctor', 'police', 'mayor', 'godfather', 'mafia', 'jester']); d.players[0].meta.fake = 'investigator';
  const ab = E.nightAbilities(d, d.players[0]).find(a => a.kind === 'clue');
  ok(!!ab, 'drunk: has a fake investigator ability');
  if (ab) {
    E.setAction(d, { key: d.players[0].id, actor: d.players[0].id, ab: ab.id, targets: [d.players[3].id], opts: {} });
    const names = new Set(['Drunk', 'Villager', 'Doctor', 'Police', 'Mayor', 'Godfather', 'Mafia', 'Jester']);
    const m1 = E.resolveNight(d).reports[1].messages.find(m => m.to === d.players[0].id && m.tag === 'result');
    const m2 = E.resolveNight(d).reports[1].messages.find(m => m.to === d.players[0].id && m.tag === 'result');
    ok(m1 && m1.roles.length >= 3 && m1.roles.every(r => names.has(r.name)), 'drunk: a made-up clue still uses only in-game roles');
    ok(m1 && m2 && m1.text === m2.text, 'drunk: a made-up clue is stable between runs');
  }
  const small = nightOne(['investigator', 'villager', 'villager', 'villager', 'mafia']);
  const pv2 = E.previewResult(small, { key: small.players[0].id, actor: small.players[0].id, ab: 'inv', targets: [small.players[1].id], opts: {} });
  ok(pv2.roles.length === 3 && pv2.roles.every(r => ['Investigator', 'Villager', 'Mafia'].includes(r.name)), 'investigator: a small game uses every distinct in-game role');
}

console.log(`${pass} passed, ${fails.length} failed`); if (fails.length) { console.log(' - ' + fails.join('\n - ')); process.exit(1); }
