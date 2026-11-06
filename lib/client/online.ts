"use client";
// Online rooms, Game Master side: host a room, push every player's private slice, read phone votes back.
import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import E from "@/lib/engine/engine";
import type { Game, Player } from "@/lib/engine/engine";
import { A, LS, emit, save, toast } from "./store";

/* eslint-disable @typescript-eslint/no-explicit-any */
const OKEY = "omerta.online.v1";

/* ---------- what each phone is allowed to see ---------- */
function hiddenAtDawn(s: Game): Set<string> {
  // between resolving a night and starting the day, nobody's phone may learn who died
  if (s.phase !== "dawn") return new Set();
  return new Set(s.deaths.filter(d => d.ph === "N" + s.night || d.ph === "D" + s.night).map(d => d.id));
}
export function publicView(s: Game): any {
  const phase = s.phase === "reveal-done" || s.phase === "dawn" ? "night" : s.phase;
  const hide = hiddenAtDawn(s);
  const lastDeath = (id: string) => s.deaths.slice().reverse().find(d => d.id === id);
  const pv: any = { phase, night: s.night, day: s.day, dealt: !!s.setup.dealt,
    players: s.players.map(p => { const alive = s.phase === "setup" || p.alive || hide.has(p.id); const d = alive ? null : lastDeath(p.id);
      return { id: p.id, name: p.name, alive, role: d && d.publicRole ? d.publicRole : null }; }) };
  if ((s.phase === "day" || s.phase === "ended") && s.lastAnnounce && s.lastAnnounce.n === s.day) {
    const a = E.dawnAnnouncement(s, s.day); const f = s.lastAnnounce.format;
    const showRole = f === "role" || f === "full", showCause = f === "cause" || f === "full";
    pv.announce = { day: s.day, custom: f === "custom" ? String(s.lastAnnounce.custom || "").slice(0, 600) : null,
      deaths: a.deaths.map(d => ({ name: d.name, role: showRole && !d.cleaned ? d.role : null, hidden: showRole && d.cleaned, cause: showCause ? d.cause : null })), notes: a.notes };
  }
  if (s.phase === "day") pv.notes = s.publicNotes.filter(n => n.ph === "D" + s.day).map(n => n.text);
  const ds = s.dayState;
  if (s.phase === "day" && ds && ds.open) pv.vote = { key: `D${s.day}R${ds.round}`, round: ds.round, allowSkip: !!s.config.allowSkip,
    nominees: ds.nominees.map(id => ({ id, name: E.pname(s, id) })), eligible: s.players.filter(p => E.canVote(s, p)).map(p => p.id) };
  if (s.phase === "day" && ds && ds.done && ds.result) {
    const r = ds.result;
    pv.voteResult = r.type === "execute" ? (r.spared ? `${E.pname(s, r.target)} was voted out — but survived as the Prince.` : `${E.pname(s, r.target)} was executed.`) : (r.reason || "Nobody was executed.");
    if (r.type === "execute") {
      const d = s.deaths.slice().reverse().find(x => x.id === r.target && x.execution);
      pv.execution = { key: `D${s.day}`, name: E.pname(s, r.target), spared: !!r.spared, role: d && d.publicRole ? d.publicRole : null, hidden: !!(d && s.config.revealOnDeath && d.cleaned) };
    }
  }
  if (s.phase === "ended" && s.result) pv.result = { factionName: s.result.factionName, faction: s.result.faction, reason: s.result.reason,
    winners: s.result.winners.map(w => ({ name: E.pname(s, w.id), why: w.why })),
    roles: s.players.map(p => ({ name: p.name, role: E.getRole(s, p.roleId).name, team: E.teamLabel(p), alive: p.alive })) };
  return pv;
}
/* ---------- night choices and the faction chat, as each phone may see them ---------- */
export const phoneMode = (s: Game): "off" | "mafia" | "all" => (["mafia", "all"].includes(s.config.phoneActions) ? s.config.phoneActions : "off");
export const chatMode = (s: Game): "off" | "night" | "always" => (["off", "always"].includes(s.config.mafiaChat) ? s.config.mafiaChat : "night");
export const nightKeyOf = (s: Game) => (s.phase === "night" ? `${s.id}:N${s.night}` : "");
// The phone must not learn hidden roles from a refusal: a transport-immune target stays selectable (the transport simply fails).
const phoneOk = (t: { ok: boolean; why: string }) => t.ok || t.why === "Cannot be transported";
function phoneTargets(s: Game, actor: string, ab: string, slot = 0) {
  return E.legalTargets(s, actor, ab, slot, null)
    .filter(t => phoneOk(t) || !["Dead", "Alive", "Teammate", "Not Town"].includes(t.why))
    .map(t => ({ id: t.id, name: E.pname(s, t.id), ok: phoneOk(t), why: phoneOk(t) ? "" : t.why }));
}
const nameList = (s: Game, ids: string[]) => ids.map(id => E.pname(s, id));
function phoneNight(s: Game, p: Player): any {
  const mode = phoneMode(s); const key = nightKeyOf(s);
  if (mode === "off" || !key || !p.alive) return null;
  const steps: any[] = [];
  for (const st of E.nightSteps(s)) {
    const ex = s.actions.find(a => a.key === st.key);
    if (st.type === "faction" && st.actors!.includes(p.id)) {
      const carrier = ex ? ex.actor : E.defaultCarrier(s, st.faction!) || p.id; const mafia = st.faction === "mafia";
      const strong: Record<string, number> = {};
      for (const id of st.actors!) { const q = E.getP(s, id); if (q && q.roleId === "strongman" && (q.uses.strong || 0) > 0) strong[id] = q.uses.strong; }
      steps.push({ key: st.key, type: "faction", kind: st.kind, title: mafia ? "Tonight’s kill" : "Tonight’s bite", verb: mafia ? "Kill" : "Bite",
        carriers: st.actors!.map(id => { const q = E.getP(s, id)!; return { id, name: q.name, role: E.effRole(s, q).name, forfeits: E.nightAbilities(s, q).length > 0 }; }),
        carrier, strong, targets: phoneTargets(s, carrier, st.kind!),
        current: ex ? { targets: ex.targets, names: nameList(s, ex.targets), carrier: ex.actor, carrierName: E.pname(s, ex.actor), strong: !!(ex.opts && ex.opts.strong) } : null });
    } else if (mode === "all" && st.type === "player" && st.actor === p.id) {
      const carrying = s.actions.find(a => (a.key === "mafia" || a.key === "vampire") && a.actor === p.id);
      steps.push({ key: st.key, type: "player", title: st.title, carrying: carrying ? { verb: carrying.key === "mafia" ? "kill" : "bite", name: E.pname(s, carrying.targets[0]) } : null,
        abilities: st.abilities!.map(a => {
          const o: any = { id: a.id, verb: a.verb, kind: a.kind, target: a.target, ok: a.ok, why: a.ok ? "" : a.why || "", gm: a.kind === "duel" };
          if (a.ok && !["self", "none", "assigned"].includes(a.target)) { o.targets = phoneTargets(s, p.id, a.id, 0); if (a.target === "two") o.targets2 = phoneTargets(s, p.id, a.id, 1); }
          if (a.target === "assigned") o.ward = p.meta.target ? E.pname(s, p.meta.target) : null;
          if (a.kind === "jail") o.execute = p.uses.execute || 0;
          if (a.kind === "hypnotize") o.msgs = E.HYPNO_MSGS;
          return o;
        }),
        current: ex ? { ab: ex.ab, targets: ex.targets, names: nameList(s, ex.targets), opts: ex.opts || {} } : null });
    }
  }
  return steps.length ? { key, steps } : null;
}
function phoneChat(s: Game, p: Player): any {
  const mode = chatMode(s); if (mode === "off" || !p.alive || s.phase === "setup" || s.phase === "ended") return null;
  for (const f of ["mafia", "vampire"] as const) {
    const members = s.players.filter(q => q.alive && q.team === f && !E.isHidden(s, q));
    if (members.length < 2 || !members.some(q => q.id === p.id)) continue;
    const night = s.phase === "night" || s.phase === "reveal-done";
    return { channel: `${s.id}:${f}`, label: f === "mafia" ? "The Mafia" : "The Vampires", open: mode === "always" || night, members: members.filter(q => q.id !== p.id).map(q => q.name) };
  }
  return null;
}

export function playerView(s: Game, p: Player): any {
  const hide = hiddenAtDawn(s);
  const v: any = { id: p.id, name: p.name, alive: s.phase === "setup" || p.alive || hide.has(p.id) };
  if (p.roleId && (s.setup.dealt || s.phase !== "setup")) v.card = E.playerCard(s, p.id);
  // a night's private results reach the phone once the Game Master starts the following day
  const upTo = s.phase === "day" || s.phase === "ended" ? s.day : Math.max(0, s.night - 1);
  v.results = [];
  for (let n = upTo; n >= 1; n--) {
    const rep = s.reports[n]; if (!rep) continue;
    const m = rep.messages.filter(x => x.to === p.id);
    if (m.length) v.results.push({ night: n, messages: m.map(x => x.text), roles: m.find(x => x.roles) ? { subject: m.find(x => x.roles)!.subject, list: m.find(x => x.roles)!.roles } : null });
  }
  if (s.phase === "day") v.today = { mute: p.fx.blackmailed === s.day, noVote: p.fx.silenced === s.day };
  const night = phoneNight(s, p); if (night) v.night = night;
  const chat = phoneChat(s, p); if (chat) v.chat = chat;
  return v;
}
function onlinePayload(s: Game) {
  const views: Record<string, any> = {}; for (const p of s.players) views[p.id] = playerView(s, p);
  return { seats: s.players.map(p => ({ id: p.id, name: p.name })), views, publicView: publicView(s) };
}
export const voteKey = (s: Game) => (s.phase === "day" && s.dayState && s.dayState.open ? `D${s.day}R${s.dayState.round}` : "");

/* ---------- connection ---------- */
export interface Diag { ok: boolean; storage?: string; steps: { name: string; ok: boolean; detail: string; fix: string }[] }
export const Online = {
  avail: false as boolean | "unconfigured", cfg: null as any, room: null as { code: string; hostSecret: string } | null,
  status: { seats: [] as { id: string; name: string; claimed: boolean; seen: boolean }[], votes: [] as any[], night: [] as any[], chat: [] as any[] },
  readChat: false,
  sb: null as SupabaseClient | null, ch: null as RealtimeChannel | null,
  pushT: null as ReturnType<typeof setTimeout> | null, pollT: null as ReturnType<typeof setInterval> | null,
  lastSent: "", applied: {} as Record<string, string>, err: "", busy: false, checking: false, started: false,
  link() { return `${location.origin}/play?room=${this.room!.code}`; },
  async api(action: string, body?: Record<string, unknown>) {
    let r: Response;
    try { r = await fetch("/api/room?action=" + action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ action }, body || {})) }); }
    catch { throw Object.assign(new Error("No connection to the server. Check the internet and try again."), { status: 0 }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `The server did not answer properly (HTTP ${r.status}). Tap “Check connection”.`), { status: r.status });
    return j;
  },
  async diagnose(): Promise<Diag> {
    try { const r = await fetch("/api/room?action=diagnose", { cache: "no-store" }); const j = await r.json(); if (r.ok && Array.isArray(j.steps)) return j; }
    catch { /* falls through */ }
    return { ok: false, steps: [{ name: "Server", ok: false, detail: "The site did not answer.", fix: "Check the internet connection. If it is fine, check that the Vercel deployment is live." }] };
  },
  async init() {
    if (this.started) return; this.started = true;
    this.room = LS.get(OKEY, null);
    try {
      const r = await fetch("/api/room?action=config", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (r.status === 503) { this.avail = "unconfigured"; this.err = j.error || ""; emit(); } return; }
      this.cfg = j; this.avail = true;
    } catch { return; }
    if (this.room) { this.connect(); this.push(true); this.refresh(); }
    emit();
  },
  async host() {
    if (this.busy) return; this.busy = true; this.err = ""; emit();
    try {
      const j = await this.api("create");
      this.room = { code: j.code, hostSecret: j.hostSecret }; LS.set(OKEY, this.room);
      this.connect(); await this.push(true); await this.refresh(); toast(`Room ${j.code} is open`);
    } catch (e: any) { this.err = e.message; toast(e.message); }
    this.busy = false; emit();
  },
  connect() {
    this.disconnect();
    const rt = this.cfg && this.cfg.realtime;
    if (rt && this.room) {
      try {
        this.sb = this.sb || createClient(rt.url, rt.key, { auth: { persistSession: false, autoRefreshToken: false } });
        this.ch = this.sb.channel("omerta-" + this.room.code, { config: { broadcast: { self: false } } });
        this.ch.on("broadcast", { event: "player" }, () => this.refresh()).on("broadcast", { event: "chat" }, () => { if (this.readChat) this.refresh(); }).subscribe();
      } catch { this.ch = null; }
    }
    this.pollT = setInterval(() => this.refresh(), this.ch ? 12000 : 3000);
  },
  disconnect() { if (this.pollT) clearInterval(this.pollT); if (this.ch && this.sb) { try { this.sb.removeChannel(this.ch); } catch { /* gone */ } } this.ch = null; },
  schedule() { if (!this.room) return; if (this.pushT) clearTimeout(this.pushT); this.pushT = setTimeout(() => this.push(), 250); },
  async push(force?: boolean) {
    if (!this.room) return;
    const payload = onlinePayload(A.s); const sig = JSON.stringify(payload);
    if (!force && sig === this.lastSent) return;
    try {
      await this.api("sync", Object.assign({ code: this.room.code, hostSecret: this.room.hostSecret, version: Date.now() }, payload));
      this.lastSent = sig; if (this.err) { this.err = ""; emit(); }
      if (this.ch) Promise.resolve(this.ch.send({ type: "broadcast", event: "update", payload: {} })).catch(() => {});
    } catch (e: any) { this.err = e.message; if (e.status === 404 || e.status === 403) this.lost(); else emit(); }
  },
  async refresh() {
    if (!this.room) return;
    const key = voteKey(A.s); const nk = nightKeyOf(A.s);
    try {
      const j = await this.api("status", { code: this.room.code, hostSecret: this.room.hostSecret, voteKey: key, nightKey: phoneMode(A.s) === "off" ? "" : nk, chat: this.readChat });
      j.night = j.night || []; j.chat = j.chat || [];
      const before = JSON.stringify([this.status.seats, this.status.night, this.status.chat]); this.status = j; const hadErr = !!this.err; this.err = "";
      const votesChanged = applyRemoteVotes(j.votes, key); const nightChanged = applyRemoteNight(j.night, nk);
      const changed = votesChanged || nightChanged;
      if (changed) { save(); emit(); } else if (hadErr || before !== JSON.stringify([j.seats, j.night, j.chat])) emit();
    } catch (e: any) { this.err = e.message; if (e.status === 404 || e.status === 403) this.lost(); }
  },
  lost() { this.disconnect(); this.room = null; LS.del(OKEY); this.status = { seats: [], votes: [], night: [], chat: [] }; toast("The online room has closed. Host a new one to reconnect the phones."); emit(); },
  async resetSeat(id: string) { try { await this.api("resetSeat", { code: this.room!.code, hostSecret: this.room!.hostSecret, seatId: id }); await this.refresh(); toast("Seat reset — that player can join again."); } catch (e: any) { toast(e.message); } },
  async close() { try { await this.api("close", { code: this.room!.code, hostSecret: this.room!.hostSecret }); } catch { /* already gone */ } this.disconnect(); this.room = null; LS.del(OKEY); this.status = { seats: [], votes: [], night: [], chat: [] }; emit(); },
  joined(): number { return A.s.players.filter(p => (this.status.seats.find(x => x.id === p.id) || { claimed: false }).claimed).length; },
};

/** Night choices sent from phones become recorded actions, checked again against the rules engine.
 *  Each phone change is applied once, so the Game Master can still overrule it on this phone. */
export function applyRemoteNight(rows: any[], key: string): boolean {
  const s = A.s; if (!key || s.phase !== "night" || !rows || !rows.length) return false;
  if (!s.nightUi || s.nightUi.night !== s.night) s.nightUi = { night: s.night, visited: {} };
  const ui = s.nightUi; ui.phone = ui.phone || {};
  const steps = E.nightSteps(s); let changed = false, fresh = 0;
  for (const r of rows) {
    if (r.key && r.key !== key) continue;
    const stamp = key + "|" + r.step; if (Online.applied[stamp] === r.at) continue;
    Online.applied[stamp] = r.at;
    const st = steps.find(x => x.key === r.step); if (!st) continue;
    const by = E.pname(s, r.seat);
    if (r.ab === null) { E.clearAction(s, st.key); ui.visited[st.key] = "skip"; ui.phone[st.key] = { by, pass: true }; changed = true; fresh++; continue; }
    if (st.type === "faction") {
      const carrier = r.opts && r.opts.carrier; if (!st.actors!.includes(carrier)) continue;
      const t = (r.targets || [])[0]; if (!E.legalTargets(s, carrier, st.kind!).some(x => x.id === t && phoneOk(x))) continue;
      E.setAction(s, { key: st.key, actor: carrier, ab: st.kind!, targets: [t], opts: { strong: !!(r.opts && r.opts.strong) } });
    } else if (st.type === "player") {
      const ab = st.abilities!.find(a => a.id === r.ab && a.ok); if (!ab) continue;
      const t: string[] = r.targets || [];
      const okAt = (id: string, slot: number) => E.legalTargets(s, st.actor!, ab.id, slot, slot ? t[0] : null).some(x => x.id === id && phoneOk(x));
      const need = ab.target === "two" ? 2 : ["self", "none", "assigned"].includes(ab.target) ? 0 : 1;
      if (t.length !== need || t.some((id, i) => !okAt(id, i))) continue;
      const opts: Record<string, unknown> = {};
      if (ab.kind === "jail" && r.opts && r.opts.execute) opts.execute = true;
      if (ab.kind === "hypnotize" && r.opts && E.HYPNO_MSGS.includes(r.opts.msg)) opts.msg = r.opts.msg;
      if (ab.kind === "duel") { ui.phone[st.key] = { by, ab: ab.id, targets: t.slice(), waiting: true }; changed = true; fresh++; continue; } // the Game Master records who won
      E.setAction(s, { key: st.key, actor: st.actor!, ab: ab.id, targets: t.slice(), opts });
    } else continue;
    ui.visited[st.key] = "done"; ui.phone[st.key] = { by }; changed = true; fresh++;
    if (A.ui.draft && A.ui.draft.key === st.key) A.ui.draft = null; // the open step shows the phone's choice
  }
  if (fresh) toast(fresh === 1 ? "A night choice arrived from a phone." : `${fresh} night choices arrived from phones.`);
  return changed;
}

function applyRemoteVotes(votes: any[], key: string): boolean {
  const s = A.s; const ds = s.dayState; if (!key || !ds || !ds.open || !votes) return false;
  let changed = false;
  for (const v of votes) {
    if (v.key && v.key !== key) continue;
    const stamp = key + "|" + v.seat; if (Online.applied[stamp] === v.at) continue; // apply each phone change once; GM entries can override
    Online.applied[stamp] = v.at;
    const p = E.getP(s, v.seat); if (!p || !E.canVote(s, p)) continue;
    const valid = v.target === null || (v.target === "skip" && s.config.allowSkip) || ds.nominees.includes(v.target);
    if (!valid) continue;
    if (v.target === null) { if (ds.votes[p.id] !== undefined) { delete ds.votes[p.id]; changed = true; } }
    else if (ds.votes[p.id] !== v.target) { ds.votes[p.id] = v.target; changed = true; }
  }
  return changed;
}
