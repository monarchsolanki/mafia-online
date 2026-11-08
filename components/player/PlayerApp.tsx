"use client";
// A player's own phone. It sees ONLY this player's slice of the game, fetched with this phone's secret seat token.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import { Icon } from "@/components/ui/Icon";
import { Hold } from "@/components/ui/Hold";
import { RoleCard } from "@/components/fx/RoleCard";
import { DeathScene } from "@/components/fx/DeathScene";
import { VoteReveal, LastWords } from "@/components/fx/VoteDrama";
import { StoryShare } from "@/components/fx/StoryShare";
import { haptic } from "@/lib/client/sound";
import { ASK, SLOT_LABELS } from "@/lib/client/phrases";

/* eslint-disable @typescript-eslint/no-explicit-any */
const PKEY = "omerta.player.v1", SEENKEY = "omerta.player.seen.v1", SCENEKEY = "omerta.player.scenes.v1";
const LS = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* blocked */ } },
};
const cleanCode = (c: string) => String(c || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

type Me = { code: string; seat: string; token: string; name: string };
type Scene = { kind: "announce" | "votes" | "execution" | "win"; key: string };
const S = {
  v: 0, cfg: null as any, me: null as Me | null, data: null as any, stage: "loading" as "loading" | "join" | "pick" | "play",
  err: "", code: "", seats: null as any[] | null, pending: null as any, busy: false, reveal: null as null | "card" | "results",
  toast: "", sb: null as SupabaseClient | null, ch: null as RealtimeChannel | null, pollT: null as ReturnType<typeof setInterval> | null,
  scene: null as Scene | null, sending: "", leaving: false,
};
const subs = new Set<() => void>();
function emit() { S.v++; subs.forEach(f => f()); }
function useS() { return useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => S.v, () => S.v); }
let toastT: ReturnType<typeof setTimeout> | undefined;
function toast(m: string) { S.toast = m; emit(); clearTimeout(toastT); toastT = setTimeout(() => { S.toast = ""; emit(); }, 2800); }

async function api(action: string, opt: { method?: "GET" | "POST"; query?: Record<string, string>; body?: Record<string, unknown> } = {}) {
  const qs = new URLSearchParams(Object.assign({ action }, opt.query || {})).toString();
  let r: Response;
  try { r = await fetch("/api/room?" + qs, opt.method === "POST" ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ action }, opt.body || {})) } : { cache: "no-store" }); }
  catch { throw Object.assign(new Error("No connection. Check the internet and try again."), { status: 0 }); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "Could not reach the game. Check your connection."), { status: r.status });
  return j;
}
const auth = () => ({ code: S.me!.code, seat: S.me!.seat, token: S.me!.token });

/* ---------- the flow: code → name → playing ---------- */
async function init() {
  S.me = LS.get<Me | null>(PKEY, null);
  const roomQ = cleanCode(new URL(location.href).searchParams.get("room") || "");
  try { S.cfg = await api("config"); } catch (e: any) { S.cfg = null; S.err = e.message; }
  if (S.me && (!roomQ || roomQ === S.me.code)) { S.stage = "play"; emit(); await load(); connect(); return; }
  S.code = roomQ; S.stage = "join"; emit();
  if (roomQ.length === 5) findRoom(roomQ);
}
async function findRoom(code: string) {
  S.busy = true; S.err = ""; emit();
  try { const j = await api("seats", { query: { code } }); S.code = j.code; S.seats = j.seats; S.stage = "pick"; }
  catch (e: any) { S.err = e.message; S.stage = "join"; }
  S.busy = false; emit();
}
async function claim(seat: { id: string; name: string }) {
  S.busy = true; emit();
  try {
    const j = await api("claim", { method: "POST", body: { code: S.code, seatId: seat.id } });
    S.me = { code: S.code, seat: seat.id, token: j.token, name: j.name }; LS.set(PKEY, S.me); haptic(50);
    S.stage = "play"; S.pending = null; try { history.replaceState(history.state, "", "/play?room=" + S.code); } catch { /* blocked */ }
    await load(); connect(); ping("player");
  } catch (e: any) { S.err = e.message; S.pending = null; await findRoom(S.code); }
  S.busy = false; emit();
}
function seenScenes(): string[] { return LS.get<string[]>(SCENEKEY, []); }
function markScene(key: string) { LS.set(SCENEKEY, seenScenes().concat(key).slice(-40)); }
/** Announcements play once per phone: the morning's deaths, an execution, the end of the game. */
function nextScene(j: any): Scene | null {
  const pv = j.publicView || {}; const code = S.me!.code; const seen = seenScenes();
  if (pv.phase === "ended" && pv.result) { const k = `${code}:end:${pv.result.faction}`; return seen.includes(k) ? null : { kind: "win", key: k }; }
  if (pv.phase !== "day") return null;
  // in the order they happened: the morning, the ballots, the execution
  if (pv.announce) { const k = `${code}:D${pv.announce.day}:a`; if (!seen.includes(k)) return { kind: "announce", key: k }; }
  if (pv.voteReveal && !pv.lastWords) { const k = `${code}:${pv.voteReveal.key}:v`; if (!seen.includes(k)) return { kind: "votes", key: k }; }
  if (pv.execution) { const k = `${code}:${pv.execution.key}:x`; if (!seen.includes(k)) return { kind: "execution", key: k }; }
  return null;
}
async function load(markSeen?: boolean) {
  if (!S.me) return;
  try {
    const j = await api("view", { query: Object.assign(auth(), markSeen ? { seen: "1" } : {}) as Record<string, string> });
    const prev = S.data;
    const before = prev ? JSON.stringify(prev.view.results || []) : null;
    S.data = j; S.err = "";
    if (before !== null && JSON.stringify(j.view.results || []) !== before && (j.view.results || []).length) haptic([60, 60, 60]);
    if (prev && prev.view.alive && !j.view.alive) haptic([100, 50, 100, 50, 200]);
    if (prev && prev.view.night && !j.view.night) S.sending = "";
    // last words follow the vote: once they start, the ballots count as seen
    const pvj = j.publicView || {};
    if (pvj.lastWords && pvj.voteReveal) { const vk = `${S.me!.code}:${pvj.voteReveal.key}:v`; if (!seenScenes().includes(vk)) markScene(vk); if (S.scene && S.scene.kind === "votes") S.scene = null; }
    if (!S.scene) { const sc = nextScene(j); if (sc) { S.scene = sc; S.reveal = null; haptic(sc.kind === "win" ? [50, 30, 50, 30, 50] : [30, 40, 30]); } }
    emit();
  } catch (e: any) {
    if (e.status === 404 || e.status === 403) return leave(e.message === "seat-reset" ? "The Game Master reset your seat. Join again." : "That game has ended or your seat was removed. Join again.");
    S.err = "Reconnecting…"; emit();
  }
}
function connect() {
  disconnect();
  const rt = S.cfg && S.cfg.realtime;
  if (rt && S.me) {
    try {
      S.sb = S.sb || createClient(rt.url, rt.key, { auth: { persistSession: false, autoRefreshToken: false } });
      S.ch = S.sb.channel("omerta-" + S.me.code, { config: { broadcast: { self: false } } });
      S.ch.on("broadcast", { event: "update" }, () => load()).on("broadcast", { event: "chat" }, () => { if (S.data && S.data.view.chat) load(); }).subscribe();
    } catch { S.ch = null; }
  }
  S.pollT = setInterval(() => load(), S.ch ? 15000 : 3000);
}
function disconnect() { if (S.pollT) clearInterval(S.pollT); if (S.ch && S.sb) { try { S.sb.removeChannel(S.ch); } catch { /* gone */ } } S.ch = null; }
function ping(event: "player" | "chat") { if (S.ch) Promise.resolve(S.ch.send({ type: "broadcast", event, payload: {} })).catch(() => {}); }
function leave(msg?: string) { disconnect(); LS.del(PKEY); S.me = null; S.data = null; S.stage = "join"; S.err = msg || ""; S.reveal = null; S.scene = null; S.leaving = false; emit(); }
async function vote(target: string | null) {
  const v = S.data.publicView.vote; if (!v) return;
  const prev = S.data.myVote; S.data.myVote = target; emit();
  try { await api("vote", { method: "POST", body: Object.assign(auth(), { voteKey: v.key, target }) }); ping("player"); haptic(target === null ? 20 : [30, 20, 30]); toast(target === null ? "Vote taken back" : "Vote sent"); }
  catch (e: any) { S.data.myVote = prev; toast(e.message); load(); }
}
async function sendNight(stepKey: string, body: Record<string, unknown>, label: string) {
  const n = S.data && S.data.view.night; if (!n) return;
  S.sending = stepKey; emit();
  try {
    await api("act", { method: "POST", body: Object.assign(auth(), { nightKey: n.key, stepKey }, body) });
    S.data.sent = Object.assign({}, S.data.sent, { [stepKey]: { ab: body.ab || null, targets: body.targets || [], opts: body.opts || {}, mine: true, at: new Date().toISOString() } });
    ping("player"); haptic([30, 20, 30]); toast(label);
  } catch (e: any) { toast(e.message); load(); }
  S.sending = ""; emit();
}
async function sendChat(body: string): Promise<boolean> {
  try { const j = await api("chat", { method: "POST", body: Object.assign(auth(), { body }) }); S.data.chat = j.chat; ping("chat"); emit(); return true; }
  catch (e: any) { toast(e.message); return false; }
}
function reveal(which: "card" | "results") {
  S.reveal = which; haptic(which === "card" ? [40, 30, 40] : 30); emit();
  if (which === "card") load(true).then(() => ping("player"));
  if (which === "results" && S.data) { const r = S.data.view.results || []; if (r[0]) LS.set(SEENKEY, { code: S.me!.code, night: r[0].night }); }
}

/* ---------- small pieces ---------- */
function Toast() { return S.toast ? <div className="toast-wrap"><div className="toast" role="status">{S.toast}</div></div> : null; }
function Err() { return S.err ? <p className="note warn" style={{ marginTop: 14 }}><Icon name="alert" size="sm" /><span>{S.err}</span></p> : null; }
function AutoHide({ ms = 20000 }: { ms?: number }) {
  useEffect(() => { const t = setTimeout(() => { S.reveal = null; emit(); }, ms); return () => clearTimeout(t); }, [ms]);
  return <p className="tiny muted" style={{ marginTop: 6 }}>Hides by itself in {Math.round(ms / 1000)} seconds.</p>;
}
function TargetButtons({ list, chosen, onPick, tags }: { list: any[]; chosen: string[]; onPick: (id: string) => void; tags?: string[] }) {
  return (
    <div className="targets">
      {list.map(t => { const i = chosen.indexOf(t.id);
        return <button key={t.id} className="tgt" aria-pressed={i >= 0} disabled={!t.ok && i < 0} onClick={() => onPick(t.id)}>
          <span className="nm">{t.name}{!t.ok && t.why && <span className="why">{t.why}</span>}</span>{i >= 0 && tags && <span className="tag">{tags[i]}</span>}
        </button>; })}
    </div>
  );
}

/* ---------- join ---------- */
function JoinScreen() {
  const [code, setCode] = useState(S.code);
  const c = cleanCode(code);
  return (
    <>
      <section style={{ marginTop: "10vh" }}>
        <h1 className="mega phase-title">Join the game.</h1>
        <p className="lead" style={{ marginTop: 16 }}>Type the room code the Game Master shows you.</p>
      </section>
      <form style={{ marginTop: 28 }} onSubmit={e => { e.preventDefault(); if (c.length !== 5) { S.err = "Room codes have 5 letters."; emit(); return; } S.code = c; findRoom(c); }}>
        <input className="input code-input" style={{ textAlign: "center", fontSize: "1.9rem", minHeight: 68 }} value={c} onChange={e => setCode(e.target.value)} placeholder="ROOM CODE" aria-label="Room code"
          autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={5} enterKeyHint="go" autoFocus={!S.code} />
        <Err />
        <button className="btn block primary" style={{ marginTop: 14 }} type="submit" disabled={S.busy || c.length !== 5}>{S.busy ? "Looking…" : "Find my game"}</button>
      </form>
      <p className="small muted" style={{ marginTop: 28, textAlign: "center" }}>Running the game yourself? <a className="linkbtn" href="/">Host instead</a></p>
    </>
  );
}
function PickScreen() {
  if (S.pending) return (
    <section style={{ marginTop: "12vh" }}>
      <h1 className="display">Are you {S.pending.name}?</h1>
      <p className="lead" style={{ marginTop: 12 }}>Once you join, only the Game Master can move you to another name.</p>
      <div className="stack" style={{ marginTop: 28 }}>
        <button className="btn block primary" onClick={() => claim(S.pending)} disabled={S.busy}><Icon name="check" />{S.busy ? "Joining…" : `Yes, I’m ${S.pending.name}`}</button>
        <button className="btn block ghost" onClick={() => { S.pending = null; emit(); }}>No, go back</button>
      </div>
    </section>
  );
  const seats = S.seats || [];
  return (
    <>
      <section style={{ marginTop: "4vh" }}>
        <h1 className="display">Who are you?</h1>
        <p className="lead" style={{ marginTop: 10 }}>Room {S.code}. Tap your own name.</p>
      </section>
      <Err />
      {seats.length ? <div className="targets" style={{ marginTop: 22 }}>{seats.map(s => (
        <button key={s.id} className="tgt" disabled={s.claimed} onClick={() => { S.pending = s; S.err = ""; emit(); }}>
          <span className="nm">{s.name}{s.claimed && <span className="why">Already joined</span>}</span>
        </button>))}</div>
        : <p className="muted" style={{ marginTop: 22 }}>The Game Master hasn’t added players yet. Refresh in a moment.</p>}
      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn sm" onClick={() => findRoom(S.code)} disabled={S.busy}><Icon name="refresh" size="sm" />Refresh</button>
        <button className="btn sm ghost" onClick={() => { S.stage = "join"; S.seats = null; S.err = ""; emit(); }}>Different code</button>
      </div>
    </>
  );
}

/* ---------- night: choices made on the phone ---------- */
function stepStatus(st: any) {
  const sent = S.data.sent && S.data.sent[st.key];
  if (st.current) return st.type === "faction" ? `Locked in: ${st.current.names.join(" & ")}${st.current.carrierName ? `, carried out by ${st.current.carrierName}` : ""}.` : `Locked in: ${st.current.names.length ? st.current.names.join(" & ") : "used"}.`;
  if (sent) return sent.ab === null ? "Sent: no action tonight." : "Sent. Waiting for the Game Master.";
  return "";
}
function FactionStep({ st }: { st: any }) {
  const cur = st.current; const sent = S.data.sent && S.data.sent[st.key];
  const [carrier, setCarrier] = useState<string>(cur ? cur.carrier : sent && sent.opts && sent.opts.carrier ? sent.opts.carrier : st.carrier);
  const [target, setTarget] = useState<string | null>(cur ? cur.targets[0] : sent && sent.targets[0] ? sent.targets[0] : null);
  const [strong, setStrong] = useState<boolean>(cur ? cur.strong : false);
  const c = st.carriers.find((x: any) => x.id === carrier) || st.carriers[0];
  const tName = target ? (st.targets.find((t: any) => t.id === target) || {}).name : "";
  const status = stepStatus(st);
  return (
    <section className="well night-step">
      <h2 className="title">{st.title}</h2>
      <p className="small muted" style={{ marginTop: 4 }}>Agree with your team, then any of you sends it. The last choice sent counts.</p>
      {status && <p className="note" style={{ marginTop: 12 }}><Icon name="check" size="sm" /><span>{status}</span></p>}
      {st.carriers.length > 1 && <>
        <h3 className="label" style={{ marginTop: 18, marginBottom: 8 }}>Who carries it out?</h3>
        <TargetButtons list={st.carriers.map((x: any) => ({ id: x.id, name: x.name, ok: true }))} chosen={[carrier]} onPick={id => { setCarrier(id); if (!st.strong[id]) setStrong(false); }} />
        {c && c.forfeits && <p className="small muted" style={{ marginTop: 8 }}>{c.name} gives up their own {c.role} ability tonight to do this.</p>}
      </>}
      {st.strong[carrier] > 0 && <div className="toggle"><div className="grow"><b id="sk-l">Strong kill</b><span>{st.strong[carrier]} left. Pierces heals and jail.</span></div><button className="switch" role="switch" aria-checked={strong} aria-labelledby="sk-l" onClick={() => setStrong(!strong)} /></div>}
      <h3 className="label" style={{ marginTop: 18, marginBottom: 8 }}>{st.verb === "Kill" ? "The victim" : "Who to bite"}</h3>
      <TargetButtons list={st.targets} chosen={target ? [target] : []} onPick={id => setTarget(target === id ? null : id)} />
      <div className="row nowrap" style={{ marginTop: 16 }}>
        <button className="btn" onClick={() => sendNight(st.key, { pass: true }, `No ${st.verb.toLowerCase()} tonight — sent`)} disabled={S.sending === st.key}>No {st.verb.toLowerCase()}</button>
        <button className="btn primary grow" disabled={!target || S.sending === st.key} onClick={() => sendNight(st.key, { targets: [target], opts: { carrier, strong } }, `${st.verb} ${tName} — sent`)}><span className="t">{target ? `${st.verb} ${tName}` : "Pick a target"}</span></button>
      </div>
    </section>
  );
}
function PlayerStep({ st }: { st: any }) {
  const cur = st.current; const sent = S.data.sent && S.data.sent[st.key];
  const first = st.abilities.find((a: any) => a.ok) || st.abilities[0];
  const [abId, setAb] = useState<string>(cur ? cur.ab : sent && sent.ab ? sent.ab : first.id);
  const [targets, setTargets] = useState<string[]>(cur ? cur.targets : sent && sent.ab ? sent.targets : []);
  const [execute, setExecute] = useState<boolean>(!!(cur && cur.opts && cur.opts.execute));
  const ab = st.abilities.find((a: any) => a.id === abId) || first;
  const [msg, setMsg] = useState<string>((cur && cur.opts && cur.opts.msg) || (ab.msgs ? ab.msgs[0] : ""));
  const status = stepStatus(st);
  if (st.carrying) return (
    <section className="well night-step">
      <h2 className="title">{st.title}</h2>
      <p className="note" style={{ marginTop: 10 }}><Icon name="info" size="sm" /><span>You’re carrying out tonight’s {st.carrying.verb} on {st.carrying.name}, so your own ability rests tonight.</span></p>
    </section>
  );
  const names = (ids: string[]) => ids.map(id => ((ab.targets || []).concat(ab.targets2 || []).find((t: any) => t.id === id) || {}).name).join(" & ");
  const t = ab.target; const two = t === "two"; const none = ["self", "none", "assigned"].includes(t);
  const pick = (id: string) => {
    if (!two) { setTargets(targets[0] === id ? [] : [id]); return; }
    const i = targets.indexOf(id); if (i >= 0) setTargets(targets.filter(x => x !== id)); else if (targets.length < 2) setTargets(targets.concat(id)); else setTargets([targets[0], id]);
  };
  const ready = ab.ok && (none || targets.length === (two ? 2 : 1));
  const labels = SLOT_LABELS[ab.kind] || ["First", "Second"];
  const go = () => sendNight(st.key, { ab: ab.id, targets: none ? [] : targets, opts: ab.kind === "jail" ? { execute } : ab.kind === "hypnotize" ? { msg } : {} }, `${ab.verb}${none ? "" : " " + names(targets)} — sent`);
  return (
    <section className="well night-step">
      <h2 className="title">{st.title}</h2>
      <p className="small muted" style={{ marginTop: 4 }}>{ASK[ab.kind] || "What do you do tonight?"}</p>
      {status && <p className="note" style={{ marginTop: 12 }}><Icon name="check" size="sm" /><span>{status}</span></p>}
      {st.abilities.length > 1 && <div className="seg" role="group" aria-label="Ability" style={{ marginTop: 14 }}>{st.abilities.map((a: any) => <button key={a.id} aria-pressed={a.id === ab.id} disabled={!a.ok} onClick={() => { setAb(a.id); setTargets([]); }}>{a.verb}</button>)}</div>}
      {!ab.ok ? <p className="note" style={{ marginTop: 14 }}><Icon name="info" size="sm" /><span>{ab.why || "You can’t use this tonight"}.</span></p> : <>
        {t === "assigned" && <p style={{ marginTop: 14 }}>Your ward is <b>{ab.ward || "gone"}</b>.</p>}
        {!none && <div style={{ marginTop: 16 }}>
          {two && <p className="small muted" style={{ marginBottom: 8 }}>Tap the {labels[Math.min(targets.length, 1)].toLowerCase()}.</p>}
          <TargetButtons list={two && targets.length >= 1 ? ab.targets2 || ab.targets : ab.targets} chosen={targets} onPick={pick} tags={two ? labels.map((l: string) => l.split(" ")[0]) : undefined} />
        </div>}
        {ab.kind === "jail" && <div className="toggle"><div className="grow"><b id="ex-l">Execute the prisoner</b><span>{ab.execute ? `${ab.execute} left` : "No executions left"}</span></div><button className="switch" role="switch" disabled={!ab.execute} aria-checked={execute} aria-labelledby="ex-l" onClick={() => setExecute(!execute)} /></div>}
        {ab.kind === "hypnotize" && <label className="field" style={{ marginTop: 14 }}><span>Message to plant</span><select value={msg} onChange={e => setMsg(e.target.value)}>{(ab.msgs || []).map((m: string) => <option key={m}>{m}</option>)}</select></label>}
        {ab.gm && <p className="small muted" style={{ marginTop: 10 }}>The Game Master settles the duel with you in person.</p>}
      </>}
      <div className="row nowrap" style={{ marginTop: 16 }}>
        <button className="btn" onClick={() => sendNight(st.key, { pass: true }, "No action tonight — sent")} disabled={S.sending === st.key}>Nothing</button>
        <button className="btn primary grow" disabled={!ready || S.sending === st.key} onClick={go}><span className="t">{!ab.ok ? "Not tonight" : ready ? `${ab.verb}${none ? "" : " " + names(targets)}` : two ? "Pick two" : "Pick a target"}</span></button>
      </div>
    </section>
  );
}

/* ---------- the silent faction chat ---------- */
function Chat() {
  const c = S.data.view.chat; const msgs: any[] = S.data.chat || [];
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const last = msgs.length ? msgs[msgs.length - 1].id : 0;
  useEffect(() => { if (end.current) end.current.scrollTop = end.current.scrollHeight; }, [last]);
  return (
    <section className="section">
      <div className="section-head"><h2 className="title">{c.label}</h2><span className="small muted">with {c.members.join(", ")}</span></div>
      <div className="chat" ref={end} aria-live="polite">
        {msgs.length ? msgs.map(m => <div key={m.id} className={`bubble ${m.mine ? "mine" : ""}`}>{!m.mine && <b>{m.name}</b>}<p>{m.body}</p></div>)
          : <p className="small muted" style={{ padding: "6px 2px" }}>Nobody has written yet. Messages stay between you{c.members.length === 1 ? " two" : ""} — the table hears nothing.</p>}
      </div>
      {c.open ? <form className="row nowrap" style={{ marginTop: 10 }} onSubmit={async e => { e.preventDefault(); const b = text.trim(); if (!b || busy) return; setBusy(true); if (await sendChat(b)) setText(""); setBusy(false); }}>
        <input className="input grow" style={{ minWidth: 0 }} value={text} onChange={e => setText(e.target.value)} maxLength={280} placeholder="Message your team" aria-label={`Message ${c.label}`} enterKeyHint="send" autoComplete="off" />
        <button className="btn primary" type="submit" disabled={!text.trim() || busy} aria-label="Send"><Icon name="send" /></button>
      </form> : <p className="small muted" style={{ marginTop: 8 }}>The chat opens when night falls.</p>}
    </section>
  );
}

/* ---------- day ---------- */
function Morning({ pv }: { pv: any }) {
  const a = pv.announce; const notes: string[] = ((a && a.notes) || []).concat((pv.notes || []).filter((t: string) => !(a && (a.notes || []).includes(t))));
  if (!a && !notes.length) return null;
  return (
    <section className="section">
      <div className="section-head"><h2 className="title">This morning</h2>{a && <button className="btn xs ghost" onClick={() => { S.scene = { kind: "announce", key: "replay" }; emit(); }}><Icon name="play" size="sm" />Replay</button>}</div>
      {a && (a.custom ? <p style={{ whiteSpace: "pre-wrap" }}>{a.custom}</p> : a.deaths.length ? <div className="list">{a.deaths.map((d: any, i: number) => (
        <div className="li" key={i}><span style={{ color: "var(--blood)" }}><Icon name="skull" /></span><span className="grow"><b>{d.name}</b><span>{[d.role ? `was the ${d.role}` : d.hidden ? "role unknown" : "", d.cause ? cap(d.cause) : ""].filter(Boolean).join(" · ") || "died in the night"}</span></span></div>))}</div>
        : <p className="muted">Nobody died last night.</p>)}
      {notes.map((t, i) => <p key={i} className="note" style={{ marginTop: 10 }}><Icon name="info" size="sm" /><span>{t}</span></p>)}
    </section>
  );
}
function Vote({ pv }: { pv: any }) {
  const v = pv.vote; const me = S.data.view;
  if (pv.voteResult) return <section className="section"><h2 className="title">The vote</h2><p className="lead" style={{ marginTop: 6, color: "var(--ink)" }}>{pv.voteResult}</p></section>;
  if (!v) return null;
  if (!v.eligible.includes(me.id)) return <section className="section"><h2 className="title">Voting is open</h2><p className="muted" style={{ marginTop: 6 }}>{me.alive ? "You can’t vote this round." : "You’re out, so you can’t vote."}</p></section>;
  const opts = v.nominees.concat(v.allowSkip ? [{ id: "skip", name: "No execution" }] : []);
  return (
    <section className="section">
      <h2 className="display">Vote{v.round > 1 ? `, round ${v.round}` : ""}.</h2>
      <p className="small muted" style={{ marginTop: 8 }}>Tap who should be executed. You can change it until the Game Master locks the vote.</p>
      <div className="targets" style={{ marginTop: 14 }}>{opts.map((o: any) => <button key={o.id} className="tgt" aria-pressed={S.data.myVote === o.id} onClick={() => vote(S.data.myVote === o.id ? null : o.id)}><span className="nm">{o.name}</span>{S.data.myVote === o.id && <span className="tag"><Icon name="check" size="sm" /></span>}</button>)}</div>
      {S.data.myVote && <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => vote(null)}>Take my vote back</button>}
    </section>
  );
}

/* ---------- secrets: the role card and private results ---------- */
function Secrets() {
  const me = S.data.view; const r: any[] = me.results || [];
  const seen = LS.get<{ code?: string; night?: number }>(SEENKEY, {}); const fresh = r.length > 0 && !(seen.code === S.me!.code && (seen.night || 0) >= r[0].night);
  if (!me.card && !r.length) return null;
  return (
    <section className="section stack">
      {me.card && <div className="secret"><div className="grow"><b>Your role</b><span>Shield your screen, then hold.</span></div><div style={{ width: 150 }}><Hold label="Hold to see" ms={500} onDone={() => reveal("card")} /></div></div>}
      {r.length > 0 && <div className="secret"><div className="grow"><b>Private results{fresh && <span className="chip solid" style={{ marginLeft: 8, height: 22 }}>New</span>}</b><span>Only for you.</span></div><div style={{ width: 150 }}><Hold label="Hold to read" ms={500} onDone={() => reveal("results")} /></div></div>}
    </section>
  );
}
function RevealStage() {
  const me = S.data.view; const hide = () => { S.reveal = null; emit(); };
  if (S.reveal === "card" && me.card) return (
    <div className="stage" role="dialog" aria-modal="true" aria-label="Your role">
      <div className="stage-body" style={{ justifyContent: "flex-start", paddingTop: "4vh" }}><RoleCard c={me.card} /><AutoHide /></div>
      <div className="stage-foot"><button className="btn block primary" onClick={hide}><Icon name="eyeoff" />Hide</button></div>
    </div>
  );
  const r: any[] = me.results || [];
  return (
    <div className="stage" role="dialog" aria-modal="true" aria-label="Your private results">
      <div className="stage-body" style={{ justifyContent: "flex-start", paddingTop: "4vh" }}>
        <h2 className="display develop">Only for you.</h2>
        {r.map(x => (
          <div key={x.night} style={{ marginTop: 14 }}>
            <p className="label">Night {x.night}</p>
            {x.roles && x.roles.list && x.roles.list.length ? <>
              <p className="title" style={{ marginTop: 6 }}>{x.roles.subject || "Your target"} could be one of</p>
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: "8px 0 0", gap: 6 }}>{x.roles.list.map((ro: any, i: number) => <li key={i} className="lead" style={{ color: "var(--ink)" }}>{typeof ro === "string" ? ro : ro.name}</li>)}</ul>
              {x.messages.filter((m: string) => !/could be:/.test(m)).map((m: string, i: number) => <p key={i} className="lead" style={{ color: "var(--ink)", marginTop: 6 }}>{m}</p>)}
            </> : x.messages.map((m: string, i: number) => <p key={i} className="title" style={{ marginTop: 6, fontWeight: 560 }}>{m}</p>)}
          </div>
        ))}
        <AutoHide />
      </div>
      <div className="stage-foot"><button className="btn block primary" onClick={hide}><Icon name="eyeoff" />Hide</button></div>
    </div>
  );
}

/* ---------- announcements, played on every phone at once ---------- */
function SceneStage() {
  const sc = S.scene!; const pv = S.data.publicView || {};
  const done = () => { if (sc.key !== "replay") markScene(sc.key); S.scene = null; emit(); };
  if (sc.kind === "win") return <WinStage r={pv.result} onDone={done} />;
  if (sc.kind === "votes" && pv.voteReveal) return <VoteReveal ballots={pv.voteReveal.ballots} outcome={pv.voteReveal.outcome} round={pv.voteReveal.round} onDone={done} />;
  if (sc.kind === "execution" && pv.execution) {
    const x = pv.execution;
    if (x.spared) return <DeathScene heading="The town has decided." deaths={[]} custom={`${x.name} was voted out — but survived. They are the Prince.`} sound={false} onDone={done} />;
    return <DeathScene heading="The town has decided." deaths={[{ name: x.name, role: x.role, hidden: x.hidden, cause: "executed by the town" }]} sound={false} onDone={done} />;
  }
  const a = pv.announce;
  if (!a) { done(); return null; }
  return <DeathScene heading={`Day ${a.day}.`} sub="The town wakes up." deaths={a.custom ? [] : a.deaths} custom={a.custom} notes={a.notes} sound={false} onDone={done} />;
}
function WinStage({ r, onDone }: { r: any; onDone: () => void }) {
  const [go, setGo] = useState(false);
  useEffect(() => { const t = setTimeout(() => setGo(true), 60); return () => clearTimeout(t); }, []);
  if (!r) return null;
  const mine = (r.winners || []).some((w: any) => w.name === S.me!.name);
  return (
    <div className="stage" role="dialog" aria-modal="true" aria-label="The game is over">
      <div className={`flood ${go ? "go" : ""}`} aria-hidden="true" />
      <div className="stage-body" style={{ position: "relative", zIndex: 2 }}>
        <h1 className="mega phase-title">{r.factionName} {r.faction === "draw" || String(r.faction).startsWith("solo:") ? "wins" : "win"}.</h1>
        <p className="lead settle" style={{ animationDelay: ".6s" }}>{r.reason}</p>
        <p className="title settle" style={{ animationDelay: "1s" }}>{mine ? "You won." : "You lost."}</p>
      </div>
      <div className="stage-foot" style={{ position: "relative", zIndex: 2 }}><button className="btn block primary" onClick={onDone}>See every role</button></div>
    </div>
  );
}

/* ---------- the main screen while playing ---------- */
function Ended({ r }: { r: any }) {
  return (
    <>
      <section style={{ marginTop: "4vh" }}>
        <h1 className="mega phase-title">{r.factionName} {r.faction === "draw" || String(r.faction).startsWith("solo:") ? "wins" : "win"}.</h1>
        <p className="lead" style={{ marginTop: 14 }}>{r.reason}</p>
      </section>
      {r.story && <StoryShare story={r.story} onToast={toast} />}
      <section className="section">
        <h2 className="title">Winners</h2>
        <div className="row" style={{ marginTop: 10, gap: 6 }}>{r.winners.length ? r.winners.map((w: any, i: number) => <span key={i} className="chip solid">{w.name}</span>) : <span className="muted">Nobody won.</span>}</div>
      </section>
      <section className="section">
        <h2 className="title">Every role</h2>
        <div className="list" style={{ marginTop: 6 }}>{r.roles.map((x: any, i: number) => (
          <div className="li" key={i}><span className="grow"><b>{x.name}</b><span>{x.role}{x.drunk ? " (drunk)" : ""} · {x.team}{x.alive ? "" : " · died"}</span></span>{!x.alive && <Icon name="skull" size="sm" />}</div>))}</div>
      </section>
    </>
  );
}
function Players({ pv }: { pv: any }) {
  if (!pv.players || pv.phase === "setup") return null;
  const alive = pv.players.filter((p: any) => p.alive), dead = pv.players.filter((p: any) => !p.alive);
  return (
    <section className="section">
      <div className="section-head"><h2 className="title">Players</h2><span className="small muted">{alive.length} alive · {dead.length} out</span></div>
      <div className="row" style={{ gap: 6 }}>
        {alive.map((p: any) => <span key={p.id} className="chip">{p.name}</span>)}
        {dead.map((p: any) => <span key={p.id} className="chip muted" style={{ textDecoration: "line-through" }}>{p.name}{p.role ? ` · ${p.role}` : ""}</span>)}
      </div>
    </section>
  );
}
function PlayScreen() {
  if (!S.data) return <section style={{ marginTop: "20vh" }}><p className="lead">Connecting…</p><Err /></section>;
  const pv = S.data.publicView || {}; const me = S.data.view; const ph = pv.phase || "setup";
  if (ph === "ended" && pv.result) return <><Err /><Ended r={pv.result} /><Leave /></>;
  const night = me.night && me.night.steps && me.night.steps.length ? me.night : null;
  return (
    <>
      <Err />
      {!me.alive && <p className="note warn" style={{ marginTop: 6, marginBottom: 6 }}><Icon name="skull" size="sm" /><span><b>You’re out.</b> Stay silent until the game ends — no hints, no reactions.</span></p>}
      {ph === "setup" && (me.card
        ? <section style={{ marginTop: "8vh" }}><h1 className="mega phase-title">Your role is ready.</h1><p className="lead" style={{ marginTop: 14 }}>Shield your screen, then hold the button below. Tell no one.</p></section>
        : <section style={{ marginTop: "8vh" }}><h1 className="mega phase-title">You’re in, {me.name}.</h1><p className="lead" style={{ marginTop: 14 }}>Waiting for the Game Master to deal the roles. Keep this page open.</p></section>)}
      {ph === "night" && <section style={{ marginTop: "4vh" }}>
        <h1 className="mega phase-title">Night {pv.night}.</h1>
        <p className="lead" style={{ marginTop: 14 }}>{night ? "Your move. Keep the screen to yourself." : "Close your eyes and put your phone face down. The Game Master will wake you if your role acts."}</p>
      </section>}
      {ph === "night" && night && <div className="stack" style={{ marginTop: 22, gap: 14 }}>{night.steps.map((st: any) => st.type === "faction" ? <FactionStep key={night.key + st.key} st={st} /> : <PlayerStep key={night.key + st.key} st={st} />)}</div>}
      {ph === "day" && <>
        <section style={{ marginTop: "4vh" }}><h1 className="mega phase-title">Day {pv.day}.</h1></section>
        {me.today && me.today.mute && <p className="note warn" style={{ marginTop: 16 }}><Icon name="mute" size="sm" /><span><b>You’ve been blackmailed.</b> You may not speak today. You may still vote.</span></p>}
        {me.today && me.today.noVote && <p className="note warn" style={{ marginTop: 16 }}><Icon name="ban" size="sm" /><span><b>You’ve been silenced.</b> You may not vote today.</span></p>}
        <Vote pv={pv} />
        <Morning pv={pv} />
      </>}
      {me.chat && <Chat />}
      <Secrets />
      <Players pv={pv} />
      <Leave />
    </>
  );
}
function Leave() {
  if (S.leaving) return (
    <section className="section well">
      <h2 className="subtitle">Leave this game on this phone?</h2>
      <p className="small muted" style={{ marginTop: 6 }}>You can only rejoin as {S.me!.name} if the Game Master resets your seat.</p>
      <div className="row" style={{ marginTop: 12 }}><button className="btn sm danger" onClick={() => leave("")}>Leave</button><button className="btn sm ghost" onClick={() => { S.leaving = false; emit(); }}>Stay</button></div>
    </section>
  );
  return <div className="row" style={{ marginTop: 40, justifyContent: "center" }}><button className="btn ghost sm" onClick={() => { S.leaving = true; emit(); }}>Leave this game on this phone</button></div>;
}

/* ---------- going back ---------- */
let backArmed = 0;
function goBack(): "handled" | "exit" {
  if (S.reveal) { S.reveal = null; emit(); return "handled"; }
  if (S.scene) return "handled"; // announcements finish with their own button
  if (S.stage === "pick") { if (S.pending) S.pending = null; else { S.stage = "join"; S.seats = null; S.err = ""; } emit(); return "handled"; }
  if (S.stage === "play") { const now = Date.now(); if (now - backArmed < 2500) { backArmed = 0; return "exit"; } backArmed = now; toast("Press Back again to leave this page. Your seat is kept."); return "handled"; }
  return "exit";
}

function actFor(): string {
  if (S.stage !== "play" || !S.data) return "dusk";
  const pv = S.data.publicView || {};
  if (S.scene) { if (S.scene.kind === "announce") return "dawn"; if (S.scene.kind === "execution") return "vote"; }
  if (pv.phase === "ended" && pv.result) { const f = pv.result.faction; return f === "town" ? "win-town" : f === "mafia" ? "win-mafia" : f === "draw" ? "win-draw" : "win-solo"; }
  if (pv.phase === "night") return "night";
  if (pv.phase === "day") return pv.vote ? "vote" : "day";
  return "dusk";
}

export default function PlayerApp() {
  useS();
  useEffect(() => {
    init();
    try { history.replaceState({ omerta: "root" }, ""); history.pushState({ omerta: "app" }, ""); } catch { /* blocked */ }
    const onPop = () => { if (goBack() === "exit") { try { history.back(); } catch { /* gone */ } return; } try { history.pushState({ omerta: "app" }, ""); } catch { /* blocked */ } };
    const onVis = () => { if (document.hidden) { if (S.reveal) { S.reveal = null; emit(); } } else if (S.me) load(); };
    window.addEventListener("popstate", onPop); document.addEventListener("visibilitychange", onVis);
    if ("serviceWorker" in navigator && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") navigator.serviceWorker.register("/sw.js").catch(() => {});
    (window as unknown as { __omertaPlayer: unknown }).__omertaPlayer = { S, emit, load }; // for tests and debugging on the device
    return () => { window.removeEventListener("popstate", onPop); document.removeEventListener("visibilitychange", onVis); disconnect(); };
  }, []);
  const theAct = actFor();
  useEffect(() => {
    document.documentElement.dataset.act = theAct;
    const m = document.querySelector('meta[name="theme-color"]');
    const t = setTimeout(() => { if (m) m.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--ground").trim()); }, 1300);
    return () => clearTimeout(t);
  }, [theAct]);

  const lw = S.stage === "play" && S.data && S.data.publicView && S.data.publicView.lastWords;
  if (lw) return <><LastWords name={lw.name} endsAt={lw.endsAt} total={lw.total} me={lw.target === S.data.view.id} /><Toast /></>;
  if (S.stage === "play" && S.data && S.scene) return <><SceneStage /><Toast /></>;
  if (S.stage === "play" && S.data && S.reveal) return <><RevealStage /><Toast /></>;
  return (
    <div className="shell player">
      <header className="topbar" style={{ position: "static" }}>
        {S.stage === "pick" ? <button className="iconbtn" onClick={() => goBack()} aria-label="Back"><Icon name="back" /></button> : null}
        <span className="wordmark" style={{ flex: 1, paddingLeft: S.stage === "pick" ? 4 : 0 }}>Omertà</span>
        {S.me && S.stage === "play" && <span className="chip" style={{ maxWidth: "58vw", overflow: "hidden", textOverflow: "ellipsis" }}>{S.me.name} · {S.me.code}</span>}
      </header>
      <main className="page no-tabs" id="main">
        {S.stage === "join" ? <JoinScreen /> : S.stage === "pick" ? <PickScreen /> : S.stage === "play" ? <PlayScreen /> : <p className="lead" style={{ marginTop: "20vh" }}>Loading…</p>}
      </main>
      <Toast />
    </div>
  );
}
