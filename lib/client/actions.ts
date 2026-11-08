"use client";
// Everything the Game Master can do. Each function is the old app's handler, unchanged in behaviour.
import E from "@/lib/engine/engine";
import { recordPlayed, playedHistory, rateGame, recordResult } from "./history";
import type { Game, NightStep } from "@/lib/engine/engine";
import { A, taste, emit, cmd, save, savePrefs, saveLibrary, setupMut, toast, confirmSheet, top0, resetUi, lastHist, effN, autoPool, roleCount, afterPlayersChange, plural, P, type View } from "./store";
import { Sound } from "./sound";
import { Cloud } from "./cloud";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ---------- navigation ---------- */
export function nav(v: View) { A.ui.view = v; A.ui.sheet = null; if (v === "command") A.ui.backTo = null; top0(); emit(); }
export function goHome() { A.ui.view = "home"; A.ui.sheet = null; A.ui.backTo = null; emit(); }
export function resume() { A.ui.view = "command"; A.ui.backTo = null; emit(); }
export function browseRoles() { A.ui.view = "roles"; A.ui.backTo = "home"; emit(); }
export function openSheet(type: string, extra?: Record<string, any>) { A.ui.sheet = Object.assign({ type }, extra || {}); emit(); }
export function closeSheet() { A.ui.sheet = null; emit(); }
export function setStep(i: number) { const b = setupBlocked(i); if (b && i > A.ui.setupStep) { toast(b); return; } A.ui.setupStep = i; top0(); emit(); }

export function setupBlocked(i: number): string {
  const s = A.s; const n = s.players.length;
  if (i >= 1 && n < 5) return "Add at least 5 players";
  if (i >= 3 && roleCount() !== n) return `Role list has ${roleCount()} roles for ${n} players`;
  if (i >= 4 && !s.setup.dealt) return "Deal the roles first";
  return "";
}

/* ---------- new game ---------- */
function freshGame(): Game { const n = E.newGame(); for (const r of A.customLib) n.customRoles[r.id] = r; n.setup.disabled = A.prefs.disabled.slice(); return n; }
export function newGameNow() {
  if (A.s.phase === "setup" && !A.s.players.length) A.s = freshGame(); else cmd("New game", freshGame);
  resetUi(); Object.assign(A.ui, { setupStep: 0, view: "command" });
  save(); top0(); emit();
}
export function newGame() {
  const s = A.s; if (s.phase === "setup" && !s.players.length) { newGameNow(); return; }
  confirmSheet({ title: "Start a new game?", body: s.phase === "ended" ? "The finished game will be replaced." + (Cloud.host ? " It stays in Your games." : " Export its log first if you want a record.") : "The current game will be replaced." + (Cloud.host ? " It stays in Your games, so you can open it again." : " Export a save file first if you want to keep it."), ok: "Start a new game", danger: s.phase !== "ended" && !Cloud.host, onOk: newGameNow });
}

/* ---------- players ---------- */
export function targetStep(d: number) { setupMut(s => { s.setup.targetN = Math.max(5, s.players.length, Math.min(40, effN() + d)); autoPool(s); }); }
export function targetSet(n: number) { setupMut(s => { s.setup.targetN = Math.max(n, s.players.length); autoPool(s); }); }
export function playersContinue() {
  const N = effN();
  cmd(`Set up ${N} players`, s => {
    let k = 1; while (s.players.length < N) { let name: string; do { name = "Player " + k++; } while (s.players.some(p => p.name === name)); E.addPlayer(s, name); }
    afterPlayersChange(s);
  });
  A.ui.setupStep = 1; top0(); emit();
}
export function addPlayer(raw: string): boolean {
  const name = raw.trim(); const s = A.s;
  if (!name) return false;
  if (s.players.length >= 40) { toast("40 players is the maximum."); return false; }
  if (s.players.some(p => p.name.toLowerCase() === name.toLowerCase())) { toast(`${name} is already in the game.`); return false; }
  const ph = s.players.find(p => /^Player \d+$/.test(p.name));
  return cmd(ph ? `Rename seat to ${name}` : `Add ${name}`, s2 => { if (ph) { E.getP(s2, ph.id)!.name = name.slice(0, 24); return; } E.addPlayer(s2, name); afterPlayersChange(s2); });
}
export function bulkAdd(text: string): boolean {
  const names = text.split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
  if (!names.length) { toast("Paste at least one name."); return false; }
  cmd(`Add ${plural(names.length, "player")}`, s => {
    for (const n of names) {
      if (s.players.some(p => p.name.toLowerCase() === n.toLowerCase())) continue;
      const ph = s.players.find(p => /^Player \d+$/.test(p.name));
      if (ph) ph.name = n.slice(0, 24); else if (s.players.length < 40) E.addPlayer(s, n);
    }
    afterPlayersChange(s);
  });
  A.ui.bulk = false; emit(); return true;
}
export function renamePlayer(id: string, raw: string): boolean {
  const name = raw.trim(); if (!name) { toast("Enter a name."); return false; }
  if (A.s.players.some(p => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) { toast("Another player already has that name."); return false; }
  A.ui.sheet = null; return cmd(`Rename to ${name}`, s => { E.getP(s, id)!.name = name.slice(0, 24); });
}
export function movePlayer(id: string, d: number) { cmd("Reorder players", s => { const i = s.players.findIndex(p => p.id === id); const j = i + d; if (j < 0 || j >= s.players.length) return; [s.players[i], s.players[j]] = [s.players[j], s.players[i]]; }); }
export function removePlayer(id: string) { const p = P(id); cmd(`Remove ${p.name}`, s => { s.players = s.players.filter(x => x.id !== id); afterPlayersChange(s); }); }

/* ---------- groups and setups (saved to the account when signed in, else on this device) ---------- */
export function saveGroup() {
  const names = A.s.players.map(p => p.name);
  if (names.length < 2) { toast("Add at least 2 players first."); return; }
  const label = names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
  Cloud.saveGroup({ name: label.slice(0, 60), players: names });
}
export function loadGroup(i: number) {
  const g = A.groups[i]; if (!g) return;
  cmd(`Load group "${g.name}"`, s => { s.players = []; for (const n of g.players) E.addPlayer(s, n); afterPlayersChange(s); });
  toast(`Loaded ${g.name}`);
}
export function deleteGroup(i: number) {
  const g = A.groups[i]; if (!g) return;
  confirmSheet({ title: `Delete “${g.name}”?`, body: Cloud.host ? "This removes the group from your account." : "This removes the group from this device.", ok: "Delete", danger: true, onOk: () => Cloud.deleteGroup(i) });
}
export function savePreset(raw: string) {
  const s = A.s; const name = raw.trim() || `${roleCount()}-player ${E.STYLE_NAMES[s.setup.style] || "custom"} setup`;
  Cloud.saveSetup({ name: name.slice(0, 40), n: roleCount(), pool: E.clone(s.setup.pool), style: s.setup.style });
}
export function loadPreset(i: number) {
  const p = A.presets[i]; if (!p) return;
  setupMut(s => { s.setup.pool = E.clone(p.pool); s.setup.poolTouched = true; s.setup.dealt = false; });
  toast(`Loaded ${p.name}`);
}
/** A setup shared by another host: save it, and optionally use it right away. Custom roles come along. */
export function importSetup(sh: { name: string; pool: Record<string, number>; custom?: Record<string, any>[] }, useNow: boolean) {
  const map: Record<string, string> = {};
  for (const d of sh.custom || []) {
    const existing = Object.values(A.s.customRoles).find(r => r.name === d.name) || A.customLib.find(r => r.name === d.name);
    if (existing) { map[d.id] = existing.id; continue; }
    // only the fields the custom-role editor itself offers; decodeSetup has already checked their values
    const def = { name: d.name, icon: d.icon, team: d.team, kind: d.kind, uses: d.uses, attack: d.attack, nights: d.nights, def: d.def, rbImmune: d.rbImmune, sus: d.sus, desc: d.desc };
    let r = E.makeCustomRole(def); let k = 2;
    while (E.LIBMAP[r.id] || A.s.customRoles[r.id]) { r = E.makeCustomRole(Object.assign({}, def, { idSuffix: String(k++) })); }
    Cloud.saveRole(r); map[d.id] = r.id;
  }
  const pool: Record<string, number> = {};
  for (const [id, n] of Object.entries(sh.pool)) pool[map[id] || id] = (pool[map[id] || id] || 0) + n;
  Cloud.saveSetup({ name: sh.name, n: E.seatList(pool).length, pool, style: "custom" }); // the Drunk card is not a seat
  if (useNow && A.s.phase === "setup") {
    setupMut(s => { s.setup.pool = E.clone(pool); s.setup.poolTouched = true; s.setup.dealt = false; });
    Object.assign(A.ui, { view: "command", setupStep: 1, sheet: null }); top0(); emit();
  } else { A.ui.sheet = null; emit(); }
}
export function deletePreset(i: number) {
  const p = A.presets[i]; if (!p) return;
  confirmSheet({ title: `Delete “${p.name}”?`, body: Cloud.host ? "This removes the setup from your account." : "This removes the setup from this device.", ok: "Delete", danger: true, onOk: () => Cloud.deleteSetup(i) });
}

/* ---------- roles and rules ---------- */
export function recStyle(v: string) { setupMut(s => { s.setup.style = v; s.setup.seed = 1; s.setup.poolTouched = false; s.setup.dealt = false; autoPool(s); }); }
export function recReroll() { setupMut(s => { s.setup.seed = (s.setup.seed || 1) + 1; if (!s.setup.poolTouched) { autoPool(s); s.setup.dealt = false; } }); Sound.tick(); }
/** The Game Master's verdict on a finished game: 1 loved it, -1 not for us, 0 cleared. Saved with the game. */
export function rate(v: number) {
  const s = A.s as Game & { rating?: number }; s.rating = v || undefined; rateGame(s, v); save(); emit();
  if (v) toast(v === 1 ? "Noted — more games like this" : "Noted — fewer games like this");
}
/* ---------- tonight's twist: change one role ---------- */
export function twists() { const s = A.s; return E.suggestTwists(s, s.setup.pool, playedHistory(), Math.max(5, s.players.length || effN())); }
export function twistNext() { A.ui.twistIdx = (A.ui.twistIdx || 0) + 1; emit(); }
export function twistApply(t: { add: string; remove: string; addName: string; removeName: string }) {
  setupMut(s => {
    const p = s.setup.pool; if (!p[t.remove]) return;
    p[t.remove]--; if (!p[t.remove]) delete p[t.remove]; p[t.add] = (p[t.add] || 0) + 1;
    s.setup.poolTouched = true; s.setup.dealt = false;
  });
  A.ui.twistIdx = 0; toast(`Swapped one ${t.removeName} for the ${t.addName}`);
}
export function recUse() { setupMut(s => { const n = A.ui.setupStep === 0 ? effN() : Math.max(5, s.players.length); s.setup.pool = E.recommend(n, s.setup.style, s.setup.seed, s, taste.history()).pool; s.setup.poolTouched = false; s.setup.dealt = false; }); toast("Recommended setup applied"); }
export function poolInc(id: string) { setupMut(s => { s.setup.pool[id] = (s.setup.pool[id] || 0) + 1; s.setup.poolTouched = true; s.setup.dealt = false; }); Sound.tick(); }
export function poolDec(id: string) { setupMut(s => { s.setup.pool[id] = Math.max(0, (s.setup.pool[id] || 0) - 1); if (!s.setup.pool[id]) delete s.setup.pool[id]; s.setup.poolTouched = true; s.setup.dealt = false; }); Sound.tick(); }
export function poolFill() { setupMut(s => { const d = s.players.length - roleCount(); if (d > 0) { s.setup.pool.villager = (s.setup.pool.villager || 0) + d; s.setup.poolTouched = true; s.setup.dealt = false; } }); }
export function poolTrim() {
  const d = roleCount() - A.s.players.length; const v = A.s.setup.pool.villager || 0;
  if (v < d) toast(`Remove ${d - v} more role${d - v === 1 ? "" : "s"} by hand — not enough Villagers to trim.`);
  setupMut(s => { const cut = Math.min(d, v); if (cut > 0) { s.setup.pool.villager -= cut; if (!s.setup.pool.villager) delete s.setup.pool.villager; s.setup.poolTouched = true; s.setup.dealt = false; } });
}
const NUM_CFG = ["convertCap", "guessShots", "dayTimer", "stalemateCycles", "lastWords"];
export function cfgToggle(k: string) { const s = A.s; s.config[k] = !s.config[k]; if (s.phase !== "setup") E.log(s, "override", `Rule changed: ${k} → ${s.config[k] ? "on" : "off"}.`); save(); emit(); }
export function cfgSet(k: string, v: string) { const s = A.s; s.config[k] = NUM_CFG.includes(k) ? +v : v; if (k === "dayTimer") A.ui.timer = null; if (s.phase !== "setup") E.log(s, "override", `Rule changed: ${k} → ${v}.`); save(); emit(); }
export function cfgReset() { confirmSheet({ title: "Restore default rules?", body: "Every house rule goes back to its default. Your PIN is kept.", ok: "Restore defaults", onOk: () => { const pin = A.s.config.godPin; A.s.config = E.clone(E.DEFAULT_CONFIG); A.s.config.godPin = pin; save(); toast("Defaults restored"); } }); }
export function roleToggle(id: string) {
  const d = A.prefs.disabled; const i = d.indexOf(id); if (i >= 0) d.splice(i, 1); else d.push(id);
  savePrefs(); A.s.setup.disabled = d.slice(); if (A.s.phase === "setup") autoPool(A.s); save(); emit();
}
export function createCustomRole(def: Record<string, any>): boolean {
  let r = E.makeCustomRole(def); let k = 2;
  while (E.LIBMAP[r.id] || (A.s.customRoles[r.id] && A.s.customRoles[r.id].name !== r.name)) { def.idSuffix = String(k++); r = E.makeCustomRole(def); }
  A.s.customRoles[r.id] = r; save();
  Cloud.saveRole(r);
  toast(`${r.name} created`); A.ui.sheet = { type: "role", id: r.id }; emit(); return true;
}
export function deleteCustomRole(id: string) {
  const r = E.getRole(A.s, id);
  confirmSheet({ title: `Delete ${r.name}?`, body: Cloud.host ? "The custom role is removed from your account." : "The custom role is removed from this device.", ok: "Delete", danger: true, onOk: () => { delete A.s.customRoles[id]; save(); Cloud.deleteRole(id); } });
}

/* ---------- deal and reveal ---------- */
export function manualRole(pid: string, v: string) {
  cmd("Hand-pick a role", s => {
    const p = E.getP(s, pid)!;
    if (!v) { p.lock = false; return; }
    if (s.setup.dealt) {
      const other = s.players.find(q => q.id !== p.id && q.roleId === v && !q.lock) || s.players.find(q => q.id !== p.id && q.roleId === v);
      if (!other && p.roleId !== v) throw new Error("That role is not in the role list.");
      if (other) other.roleId = p.roleId;
      p.roleId = v; p.lock = true; E.finalizeAssignment(s);
    } else { p.roleId = v; p.lock = true; }
  });
}
export function deal() { cmd("Deal roles", s => { E.assignRoles(s); s.setup.dealt = true; s.setup.revealed = false; }); A.ui.showAssign = false; A.ui.peek = {}; Sound.confirm(); emit(); }
/** Move a Drunk card from one player to another (or put it on someone). */
export function moveDrunk(from: string | null, to: string) {
  if (!to || from === to) return;
  cmd(`Drunk: ${E.pname(A.s, to)}`, s => { if (from) E.setDrunk(s, from, false); E.setDrunk(s, to, true); });
  toast(`${E.pname(A.s, to)} is now the drunk one`);
}
export function toggleDrunk(pid: string) {
  const on = !E.getP(A.s, pid)!.meta.drunk;
  cmd(`${E.pname(A.s, pid)}: ${on ? "drunk" : "sober"}`, s => E.setDrunk(s, pid, on));
  toast(on ? `${E.pname(A.s, pid)} is drunk from now on` : `${E.pname(A.s, pid)} is sober from now on`);
}
export function openReveal(ids: string[], after?: () => void) { A.ui.overlay = { type: "reveal", queue: ids, i: 0, stage: "pass", after }; A.ui.sheet = null; emit(); }
export function revealAll() { if (!A.s.setup.dealt) { toast("Deal the roles first."); return; } openReveal(A.s.players.map(p => p.id), () => { A.s.setup.revealed = true; save(); emit(); }); }
function nightFalls() { Sound.night(); A.ui.overlay = { type: "cine", kind: "night", n: A.s.night }; }
export function startGame() {
  if (!A.s.setup.dealt) { toast("Deal the roles first."); return; }
  if (!cmd("Start the game", s => E.startGame(s))) return;
  recordPlayed(A.s);
  Object.assign(A.ui, { view: "command", nightIdx: 0, draft: null }); nightFalls(); top0(); emit();
}

/* ---------- overlays ---------- */
export function closeOverlay() { const ov = A.ui.overlay; A.ui.overlay = null; A.ui.pin = ""; emit(); if (ov && ov.after) ov.after(); }
export function overlayShow() { const ov = A.ui.overlay!; ov.stage = "card"; Sound.tick(); emit(); }
export function overlayHide() {
  const ov = A.ui.overlay; if (!ov) return;
  if (ov.type === "reveal" && ov.i < ov.queue.length - 1) { ov.i++; ov.stage = "pass"; } else ov.stage = "done";
  emit();
}
export function overlaySkip() { const ov = A.ui.overlay!; if (A.s.config.godPin) { ov.stage = "done"; ov.skipped = true; emit(); } else closeOverlay(); }
export function pinKey(d: string) {
  if (d === "⌫") A.ui.pin = A.ui.pin.slice(0, -1); else if (A.ui.pin.length < 4) A.ui.pin += d;
  if (A.ui.pin.length === 4) { if (A.ui.pin === String(A.s.config.godPin)) { closeOverlay(); return; } toast("Wrong PIN"); A.ui.pin = ""; }
  emit();
}

/* ---------- night ---------- */
export function nightUi() { const s = A.s; if (!s.nightUi || s.nightUi.night !== s.night) s.nightUi = { night: s.night, visited: {} }; return s.nightUi; }
export function stepState(st: NightStep): "" | "done" | "skip" { const s = A.s; if (s.actions.some(a => a.key === st.key)) return "done"; return nightUi().visited[st.key] ? "skip" : ""; }
export function nightCurrent(): NightStep | undefined { return E.nightSteps(A.s)[A.ui.nightIdx]; }
export function nightStep(i: number) { A.ui.nightIdx = Math.max(0, i); A.ui.draft = null; emit(); }
function nightAdvance() {
  const steps = E.nightSteps(A.s); let i = A.ui.nightIdx + 1;
  while (i < steps.length && stepState(steps[i])) i++;
  A.ui.nightIdx = i; A.ui.draft = null; emit(); top0();
}
export function initDraft(st: NightStep) {
  const s = A.s; const ex = s.actions.find(a => a.key === st.key);
  if (st.type === "faction") return { key: st.key, ab: st.kind, targets: ex ? ex.targets.slice() : [], opts: ex ? Object.assign({}, ex.opts) : {}, carrier: ex ? ex.actor : E.defaultCarrier(s, st.faction!) };
  if (st.type === "player") {
    const okAb = st.abilities!.find(a => a.ok) || st.abilities![0];
    const ph = !ex && s.nightUi && s.nightUi.night === s.night && s.nightUi.phone ? s.nightUi.phone[st.key] : null; // a duel chosen on a phone waits for its result
    if (ph && ph.waiting) return { key: st.key, ab: ph.ab, targets: (ph.targets || []).slice(), opts: {} };
    return { key: st.key, ab: ex ? ex.ab : okAb.id, targets: ex ? ex.targets.slice() : [], opts: ex ? Object.assign({}, ex.opts) : {} };
  }
  return { key: st.key, targets: [], opts: {} };
}
export function draftFor(st: NightStep) { if (!A.ui.draft || A.ui.draft.key !== st.key) A.ui.draft = initDraft(st); return A.ui.draft; }
export function draftCarrier(v: string) { const d = A.ui.draft; d.carrier = v; if (P(v).roleId !== "strongman") delete d.opts.strong; Sound.tick(); emit(); }
export function draftOpt(k: string) { const d = A.ui.draft; d.opts[k] = !d.opts[k]; emit(); }
export function draftAb(v: string) { const d = A.ui.draft; d.ab = v; d.targets = []; d.opts = {}; emit(); }
export function draftMsg(v: string) { A.ui.draft.opts.msg = v; emit(); }
export function draftDuel(won: boolean) { A.ui.draft.opts.won = won; emit(); }
export function draftTarget(v: string) {
  const d = A.ui.draft; const st = nightCurrent(); if (!st) return;
  let two = false; if (st.type === "player") { const ab = st.abilities!.find(a => a.id === d.ab); two = !!ab && ab.target === "two"; }
  if (!two) d.targets = d.targets[0] === v ? [] : [v];
  else { const i = d.targets.indexOf(v); if (i >= 0) d.targets.splice(i, 1); else if (d.targets.length < 2) d.targets.push(v); else d.targets = [d.targets[0], v]; }
  Sound.tick(); emit();
}
export function nightConfirm() {
  const st = nightCurrent(); const d = A.ui.draft; if (!st || !d) return; const N = A.s.night;
  const act = st.type === "faction" ? { key: st.key, actor: d.carrier, ab: st.kind!, targets: d.targets.slice(0, 1), opts: { strong: !!d.opts.strong } }
    : { key: st.key, actor: st.actor!, ab: d.ab, targets: d.targets.slice(), opts: Object.assign({}, d.opts) };
  if (cmd(`Night ${N}: ${st.title}`, s => { E.setAction(s, act); nightUi().visited[st.key] = "done"; })) { Sound.confirm(); nightAdvance(); }
}
export function nightSkip() {
  const st = nightCurrent(); if (!st) return;
  if (cmd(`Night ${A.s.night}: ${st.title} — no action`, s => { E.clearAction(s, st.key); nightUi().visited[st.key] = "skip"; })) nightAdvance();
}
export function showResult(pid: string) {
  const d = A.ui.draft; if (!d || d.key !== pid || !d.targets[0]) return;
  let pv; try { pv = E.previewResult(A.s, { key: pid, actor: pid, ab: d.ab, targets: d.targets.slice(), opts: {} }); } catch { return; }
  if (!pv.messages[0]) return;
  A.ui.overlay = { type: "result", pid, text: pv.messages[0], roles: pv.roles, subject: pv.subject }; A.ui.sheet = null; Sound.tick(); emit();
}
export function actionText(a: any): string {
  const s = A.s; const tn = a.targets.map((t: string) => E.pname(s, t)).join(" & ");
  if (a.key === "mafia" || a.key === "vampire") return `${a.key === "mafia" ? "The Mafia" : "The Vampires"} (${E.pname(s, a.actor)}) → ${a.key === "mafia" ? "kill" : "bite"} ${tn}${a.opts.strong ? " · strong kill" : ""}`;
  const p = P(a.actor); const r = E.effRole(s, p); const ab = (r.abilities || []).find(x => x.id === a.ab);
  return `${p.name} (${r.name}${p.roleId === "drunk" ? ", Drunk" : ""}) → ${ab ? E.KINDS[ab.kind].verb.toLowerCase() : a.ab}${tn ? " " + tn : ""}${a.opts.execute ? " · execute" : ""}${typeof a.opts.won === "boolean" ? (a.opts.won ? " · Pirate won" : " · target won") : ""}`;
}
export function resolveAsk() {
  const s = A.s;
  confirmSheet({ title: `Resolve Night ${s.night}?`, body: "The engine applies every recorded action in priority order. You can undo this afterwards.", detail: s.actions.length ? s.actions.map(actionText) : ["No actions recorded."], ok: `Resolve Night ${s.night}`,
    onOk: () => { const before = A.s.deaths.length; if (cmd(`Resolve Night ${A.s.night}`, s2 => E.resolveNight(s2))) { Object.assign(A.ui, { nightIdx: 0, draft: null, annFormat: null, annCustom: "", delivered: {}, promptSel: {} }); if (A.s.deaths.length > before) Sound.kill(); else Sound.confirm(); top0(); } } });
}
export function restartNight() {
  const N = A.s.night;
  if (A.s.phase === "dawn") {
    const i = lastHist(`Resolve Night ${N}`); if (i < 0) { toast("The night is no longer in the undo history."); return; }
    confirmSheet({ title: `Restart Night ${N}?`, body: "The night’s results are undone and every action recorded tonight is cleared. You can undo this.", ok: `Restart Night ${N}`, danger: true, onOk: () => {
      const pre = JSON.stringify(A.s); const s = JSON.parse(A.hist[i].snap); s.actions = []; s.nightUi = { night: s.night, visited: {} };
      A.s = s; A.hist.push({ label: `Restart Night ${N}`, snap: pre, t: Date.now() }); if (A.hist.length > 80) A.hist.shift(); resetUi(); A.ui.view = "command"; save(); top0(); emit(); } });
    return;
  }
  confirmSheet({ title: `Restart Night ${N}?`, body: "Every action recorded tonight is cleared and you start again from the first role. You can undo this.", ok: "Clear and restart", danger: true, onOk: () => { cmd(`Restart Night ${N}`, s => { s.actions = []; s.nightUi = { night: s.night, visited: {} }; }); resetUi(); A.ui.view = "command"; emit(); } });
}

/* ---------- prompts ---------- */
export function promptSel(qid: string, id: string) { A.ui.promptSel[qid] = id; emit(); }
export function promptGo(qid: string) {
  const q = A.s.pending.find(x => x.id === qid); const t = A.ui.promptSel[qid]; if (!q || !t) return;
  const go = () => { const before = A.s.deaths.length; cmd(q.type === "hunter" ? "Hunter's last shot" : "Jester's haunt", s => E.resolvePrompt(s, qid, t)); if (A.s.deaths.length > before) Sound.kill(); };
  if (q.type === "hunter") confirmSheet({ title: `Shoot ${E.pname(A.s, t)}?`, body: "The shot is Unstoppable and happens immediately. Any death abilities trigger.", ok: "Shoot", danger: true, onOk: go }); else go();
}
export function promptSkip(qid: string) { cmd("Skip prompt", s => E.resolvePrompt(s, qid, null)); }

/* ---------- dawn ---------- */
export function showPrivate(pid: string) {
  const N = A.s.night; const rep = A.s.reports[N];
  A.ui.overlay = { type: "private", pid, messages: rep.messages.filter(m => m.to === pid), title: `Night ${N}`, stage: "pass", after: () => { A.ui.delivered[N + ":" + pid] = true; emit(); } };
  A.ui.sheet = null; emit();
}
export function markDelivered(k: string) { A.ui.delivered[k] = !A.ui.delivered[k]; emit(); }
export function defaultFormat() { const c = A.s.config; return c.revealOnDeath && c.showCause ? "full" : c.revealOnDeath ? "role" : c.showCause ? "cause" : "name"; }
export function startDay() {
  const N = A.s.night; const fmt = A.ui.annFormat || defaultFormat();
  if (!cmd(`Start Day ${N}`, s => { E.startDay(s); s.lastAnnounce = { n: N, format: fmt, custom: A.ui.annCustom }; })) return;
  A.ui.timer = null; Sound.day(); A.ui.overlay = { type: "announce", n: N, format: fmt, custom: A.ui.annCustom }; top0(); emit();
}

/* ---------- day ---------- */
export function timerToggle() {
  const mins = A.s.config.dayTimer; if (!mins) return;
  const t = A.ui.timer || (A.ui.timer = { running: false, left: mins * 60000, endAt: 0, total: mins * 60000 });
  if (t.running) { t.left = Math.max(0, t.endAt - Date.now()); t.running = false; } else { if (t.left <= 0) t.left = t.total; t.endAt = Date.now() + t.left; t.running = true; }
  emit();
}
export function timerReset() { A.ui.timer = null; emit(); }
export function mayorReveal(id: string) { confirmSheet({ title: `Reveal ${E.pname(A.s, id)} as the Mayor?`, body: `Their vote will count as ${E.mayorRuleText(A.s)}, and Doctors can no longer heal them.`, ok: "Reveal the Mayor", onOk: () => cmd("Mayor revealed", s => E.mayorReveal(s, id)) }); }
export function mayorBonus(id: string) { cmd("Mayor vote bonus", s => E.mayorBonusSet(s, id, E.mayorBonusLeft(s, E.getP(s, id)))); }
export function guessGo(gid: string, t: string, r: string) {
  if (!t || !r) return; let res: any = null; A.ui.sheet = null;
  if (cmd(`${E.pname(A.s, gid)} guessed`, s => { res = E.guess(s, gid, t, r); if (res.error) throw new Error(res.error); })) { Sound.kill(); toast(res.correct ? `Correct — ${E.pname(A.s, t)} is shot.` : "Wrong guess."); }
}
/** After an execution, the room watches it happen. */
function executionScene(targetId: string) {
  const s = A.s; const r = s.dayState && s.dayState.result;
  const d = s.deaths.slice().reverse().find(x => x.id === targetId && x.execution);
  A.ui.overlay = { type: "execution", name: E.pname(s, targetId), spared: !!(r && r.spared), role: d ? d.publicRole : null, hidden: !!(d && s.config.revealOnDeath && d.cleaned), cause: r && r.spared ? null : "executed by the town" };
}
/* ---------- vote drama: the ballots one by one, then the accused's last words ---------- */
/** Before an execution: a countdown for the accused to speak, on this phone and every player's phone. */
function lastWordsThen(target: string, then: () => void) {
  const secs = Number(A.s.config.lastWords) || 0; const ds = A.s.dayState;
  if (!secs || !ds) { then(); return; }
  const endsAt = Date.now() + secs * 1000;
  ds.lastWords = { target, endsAt, total: secs }; save();
  A.ui.overlay = { type: "lastwords", target, endsAt, total: secs, then }; emit();
}
export function finishLastWords() {
  const ov = A.ui.overlay; if (A.s.dayState) delete A.s.dayState.lastWords; save();
  A.ui.overlay = null; emit(); if (ov && ov.then) ov.then();
}
export function cancelLastWords() { if (A.s.dayState) delete A.s.dayState.lastWords; save(); A.ui.overlay = null; toast("Execution cancelled"); emit(); }
/** Shows the locked ballots one by one (and sends them to the phones), then carries on. */
function revealVotes(then: () => void) {
  const s = A.s; const ds = s.dayState; if (!ds) { then(); return; }
  const t = E.tally(s); const r = t.result; const nm = (id: string) => (id === "skip" ? "No execution" : E.pname(s, id));
  const ballots = s.players.filter(p => ds.votes[p.id] !== undefined).map(p => ({ from: p.name, to: nm(ds.votes[p.id]), w: E.voteWeight(s, p) }));
  const outcome = r.type === "execute" ? `${nm(r.target)} is to be executed.` : r.type === "revote" ? `A tie between ${r.tied.map(nm).join(" and ")} — they face a revote.` : r.type === "random" ? `A tie between ${r.tied.map(nm).join(" and ")} — one is picked at random.` : r.reason || "Nobody is executed.";
  if (!ballots.length) { then(); return; }
  ds.reveal = { key: `D${s.day}R${ds.round}-${Date.now().toString(36)}`, round: ds.round, ballots, outcome }; save(); // unique, so a corrected re-count is shown again
  A.ui.overlay = { type: "votes", ballots, outcome, round: ds.round, then }; emit();
}
export function finishVotes() { const ov = A.ui.overlay; A.ui.overlay = null; emit(); if (ov && ov.then) ov.then(); }
export function execPick(id: string) {
  const name = E.pname(A.s, id);
  const go = () => { if (cmd(`Day ${A.s.day}: execute ${name}`, s => E.quickExecute(s, id))) { executionScene(id); emit(); } };
  confirmSheet({ title: `Execute ${name}?`, body: "Death abilities trigger immediately. You can undo this.", ok: `Execute ${name}`, danger: true,
    onOk: () => lastWordsThen(id, go) });
}
export function voteSkip() { confirmSheet({ title: "Skip execution?", body: "Nobody is executed today.", ok: "Skip", onOk: () => cmd(`Day ${A.s.day}: no vote`, s => E.skipVote(s)) }); }
export function voteOpen() { const ids = A.s.players.filter(p => p.alive).map(p => p.id); cmd(`Day ${A.s.day}: let phones vote`, s => E.openVote(s, ids)); }
export function voteClose() { cmd(`Day ${A.s.day}: close phone voting`, s => E.cancelVote(s)); }
export function voteManual(pid: string, v: string) { const s = A.s; const ds = s.dayState; const p = E.getP(s, pid); if (!ds || !ds.open || !p || !E.canVote(s, p)) return; if (v) ds.votes[p.id] = v; else delete ds.votes[p.id]; save(); Sound.tick(); emit(); }
export function voteConfirm() {
  const s = A.s; const t = E.tally(s); const r = t.result; const nm = (id: string) => id === "skip" ? "no execution" : E.pname(s, id);
  const exec = () => { if (cmd(`Day ${A.s.day} vote`, s2 => E.confirmVote(s2))) { const res = A.s.dayState && A.s.dayState.result; if (res && res.type === "execute") executionScene(res.target); emit(); } };
  const go = () => revealVotes(() => (r.type === "execute" ? lastWordsThen(r.target, exec) : exec()));
  if (r.type === "execute") confirmSheet({ title: `Execute ${nm(r.target)}?`, body: `${nm(r.target)} received ${t.totals[r.target]} vote${t.totals[r.target] === 1 ? "" : "s"}. Death abilities trigger immediately. You can undo this.`, ok: `Execute ${nm(r.target)}`, danger: true, onOk: go });
  else if (r.type === "revote") confirmSheet({ title: "Tie — hold a revote?", body: `${r.tied.map(nm).join(" and ")} are tied. Votes are cleared and only they stay on trial.`, ok: "Start the revote", onOk: go });
  else if (r.type === "random") confirmSheet({ title: "Tie — pick at random?", body: `${r.tied.map(nm).join(" and ")} are tied. One outcome is chosen at random.`, ok: "Pick at random", danger: true, onOk: go });
  else confirmSheet({ title: "No execution", body: r.reason, ok: "Confirm", onOk: go });
}
export function endDay() {
  if (!cmd(`End Day ${A.s.day}`, s => E.endDay(s))) return;
  if (A.s.phase === "night") { Object.assign(A.ui, { nightIdx: 0, draft: null }); nightFalls(); }
  top0(); emit();
}
export function restartDay() {
  const N = A.s.day; const i = lastHist(`Start Day ${N}`);
  if (i < 0) { toast("The start of this day is no longer in the undo history."); return; }
  confirmSheet({ title: `Restart Day ${N}?`, body: "Today’s votes, executions, guesses and reveals are undone. The night’s results stay. You can undo this.", ok: `Restart Day ${N}`, danger: true, onOk: () => {
    const pre = JSON.stringify(A.s); const prevAnn = A.s.lastAnnounce; const s = JSON.parse(A.hist[i].snap); E.startDay(s); if (prevAnn && prevAnn.n === N) s.lastAnnounce = prevAnn;
    A.s = s; A.hist.push({ label: `Restart Day ${N}`, snap: pre, t: Date.now() }); if (A.hist.length > 80) A.hist.shift();
    resetUi(); A.ui.view = "command"; save(); top0(); toast(`Day ${N} restarted`); emit(); } });
}

/* ---------- winning, ending and restarting ---------- */
function winScene() { Sound.end(); recordResult(A.s); A.ui.overlay = { type: "win" }; top0(); }
export function endGameWin() { confirmSheet({ title: "End the game and reveal every role?", body: "The results screen shows all roles to everyone.", ok: "End the game", onOk: () => { if (cmd("End the game", s => E.endGame(s, s.winPrompt))) { winScene(); emit(); } } }); }
export function dismissWin() { cmd("Keep playing", s => E.dismissWin(s)); }
export function stalemateDraw() { confirmSheet({ title: "End the game as a draw?", body: "No faction wins. Survivors, Jesters and other independents are still judged on their own goals.", ok: "End as a draw", onOk: () => { if (cmd("End as a draw", s => E.endGame(s, { status: "over", faction: "draw", reason: "Stalemate — nobody could be eliminated.", winners: E.computeWinners(s, "draw") }))) { winScene(); emit(); } } }); }
export function stalemateAck() { cmd("Play on through stalemate", s => E.ackStalemate(s)); }
export function endGameNow() { confirmSheet({ title: "End the game now?", body: "This finishes the game immediately. If no faction has won, it is recorded as a draw. You can still undo.", ok: "End the game", danger: true, onOk: () => { if (cmd("End the game", s => E.endGame(s))) { A.ui.view = "command"; winScene(); emit(); } } }); }
export function playAgain() {
  if (!cmd("Play again", s => { const n = E.restartGame(s, "setup"); n.setup.seed = (s.setup.seed || 1) + 1; if (!n.setup.poolTouched) n.setup.pool = E.recommend(n.players.length, n.setup.style, n.setup.seed, n, taste.history()).pool; return n; })) return;
  resetUi(); Object.assign(A.ui, { setupStep: 1, view: "command" }); top0(); emit();
}
export function rematch() {
  confirmSheet({ title: "Rematch — reshuffle and start?", body: "Same players and role list, new random deal. The game starts immediately at Night 1.", ok: "Rematch", onOk: () => {
    if (!cmd("Rematch", s => { E.restartGame(s, "reshuffle"); E.startGame(s); return s; })) return;
    resetUi(); Object.assign(A.ui, { view: "command", nightIdx: 0, draft: null }); nightFalls(); top0(); emit();
  } });
}
export function restartSame() {
  confirmSheet({ title: "Restart with the same roles?", body: "Everything that happened is cleared and the game goes back to Night 1. Everyone keeps the role they were dealt, so no reveal is needed. You can undo this.", ok: "Restart from Night 1", danger: true, onOk: () => {
    if (!cmd("Restart the game", s => E.restartGame(s, "same"))) return;
    resetUi(); A.ui.view = "command"; nightFalls(); top0(); emit(); } });
}
export function restartReshuffle() {
  confirmSheet({ title: "Reshuffle and restart?", body: "Same players and role list, but everyone gets a new secret role. The game goes to the reveal so each player can see their new card. You can undo this.", ok: "Reshuffle and restart", danger: true, onOk: () => {
    if (!cmd("Reshuffle and restart", s => E.restartGame(s, "reshuffle"))) return;
    resetUi(); Object.assign(A.ui, { view: "command", setupStep: 4 }); top0(); emit(); } });
}
export function restartSetup() {
  confirmSheet({ title: "Go back to setup?", body: "The game is cleared but the players stay. Roles and rules can be changed before dealing again. You can undo this.", ok: "Back to setup", danger: true, onOk: () => {
    if (!cmd("Back to setup", s => E.restartGame(s, "setup"))) return;
    resetUi(); Object.assign(A.ui, { view: "command", setupStep: 1 }); top0(); emit(); } });
}

/* ---------- Game Master overrides ---------- */
export function killGo(id: string, cause: string) { A.ui.sheet = null; if (cmd(`Kill ${E.pname(A.s, id)}`, s => { E.manualKill(s, id, cause.trim() || "removed by the Game Master"); })) Sound.kill(); }
export function revive(id: string) { confirmSheet({ title: `Revive ${E.pname(A.s, id)}?`, body: "They return to life with their current role. Win conditions are re-checked.", ok: "Revive", onOk: () => cmd(`Revive ${E.pname(A.s, id)}`, s => E.manualRevive(s, id)) }); }
export function setRoleGo(id: string, r: string, t: string) { A.ui.sheet = null; cmd(`Change ${E.pname(A.s, id)}'s role`, s => E.manualSetRole(s, id, r, t || null)); }

/* ---------- files ---------- */
export async function offerFile(filename: string, text: string) {
  try {
    const blob = new Blob([text], { type: filename.endsWith(".json") ? "application/json" : "text/plain" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000); toast("Downloaded " + filename); return;
  } catch { /* fall through to the clipboard */ }
  try { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); return; } catch { /* fall through */ }
  openSheet("copytext", { title: filename, text });
}
export function exportLog() { const d = new Date(); offerFile(`omerta-log-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.txt`, E.historyText(A.s)); }
export function exportSave() { offerFile("omerta-save.json", JSON.stringify(A.s)); }
export function importSave(text: string): boolean {
  let obj: any; try { obj = JSON.parse(text); } catch { toast("That is not valid save data."); return false; }
  if (!obj || obj.v !== 1 || !Array.isArray(obj.players) || !obj.config) { toast("That file is not an Omertà save."); return false; }
  A.s = obj; A.hist = []; A.ui.sheet = null; A.ui.view = "command"; A.ui.setupStep = 0; save(); toast("Game imported"); emit(); return true;
}
export function pinSet(v: string) { if (!/^\d{4}$/.test(v.trim())) { toast("The PIN must be exactly 4 digits."); return false; } A.s.config.godPin = v.trim(); save(); toast("PIN set. It is needed to leave private screens."); emit(); return true; }
export function pinClear() { A.s.config.godPin = ""; save(); toast("PIN removed"); emit(); }
export function toggleSound() { A.prefs.sound = !A.prefs.sound; savePrefs(); if (A.prefs.sound) { Sound.unlock(); Sound.confirm(); } emit(); }
export { saveLibrary };
