"use client";
import E from "@/lib/engine/engine";
import type { NightStep } from "@/lib/engine/engine";
import { A, emit, undo, P, role, plural, fmtDur, teamName } from "@/lib/client/store";
import { Online, phoneMode } from "@/lib/client/online";
import * as act from "@/lib/client/actions";
import { Icon } from "@/components/ui/Icon";
import { Dock } from "@/components/ui/Dock";
import { PlayerTile, StatsStrip } from "./Players";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { SCRIPT, SLOT_LABELS } from "@/lib/client/phrases";
const LIVE_KINDS = ["checkSus", "seekMafia", "clue", "checkRole", "checkAlign", "checkGun", "medium"];

function Hero({ big, line }: { big: string; line: string }) {
  return <section style={{ margin: "6px 0 26px" }}><h1 className="mega phase-title" key={big}>{big}</h1><p className="lead" style={{ marginTop: 14 }}>{line}</p></section>;
}

function Banners() {
  const s = A.s; const out: React.ReactNode[] = [];
  if (s.winPrompt) {
    const w = s.winPrompt;
    out.push(
      <section key="win" className="well" role="alert" style={{ marginBottom: 18 }}>
        <h2 className="display" style={{ fontSize: "2rem" }}>{E.factionName(s, w.faction)}{w.faction === "draw" ? " wins" : " win" + (w.faction!.startsWith("solo:") ? "s" : "")}</h2>
        <p className="muted" style={{ marginTop: 6 }}>The win condition is met. {w.reason}</p>
        {w.winners && w.winners.length > 0 && <p className="small" style={{ marginTop: 6 }}>Winners: {w.winners.map(x => E.pname(s, x.id)).join(", ")}</p>}
        <div className="row" style={{ marginTop: 14 }}><button className="btn primary" onClick={act.endGameWin}><Icon name="flag" />End the game and reveal</button><button className="btn" onClick={act.dismissWin}>Keep playing</button></div>
      </section>);
  }
  if (!s.winPrompt && s.lastWin && s.lastWin.status === "over") out.push(<p key="still" className="note" style={{ marginBottom: 16 }}><Icon name="flag" size="sm" /><span><b>Win condition still met:</b> {E.factionName(s, s.lastWin.faction)}. You chose to keep playing. <button className="linkbtn" onClick={act.endGameWin}>End the game</button></span></p>);
  const sm = E.stalemate(s);
  if (sm && s.phase !== "night") out.push(
    <section key="sm" className="well" role="alert" style={{ marginBottom: 18 }}>
      <h2 className="title">Possible stalemate</h2>
      <p className="small" style={{ marginTop: 6 }}>Nobody has died for {plural(sm.quietNights, "night")}.</p>
      <p className="small muted" style={{ marginTop: 6 }}>If the survivors can’t kill each other (say a Godfather and a Serial Killer, both with Basic defense), the game can’t end on its own.</p>
      <div className="row" style={{ marginTop: 12 }}><button className="btn primary sm" onClick={act.stalemateDraw}><Icon name="flag" size="sm" />End as a draw</button><button className="btn sm" onClick={act.stalemateAck}>Keep playing</button></div>
    </section>);
  if (s.showdown) out.push(<p key="sd" className="note" style={{ marginBottom: 16 }}><Icon name="hourglass" size="sm" /><span><b>Showdown.</b> {E.factionName(s, s.showdown.faction)} has secured the game, but {s.showdown.pending.map(id => E.pname(s, id)).join(" and ")} can still win. Play continues until the end of Day {s.showdown.endsAfterDay}.</span></p>);
  return <>{out}</>;
}

function Prompts() {
  const s = A.s; if (!s.pending.length) return null;
  return <>{s.pending.map(q => {
    const ch = E.promptChoices(s, q); const sel = A.ui.promptSel[q.id];
    return (
      <section key={q.id} className="well" role="alert" style={{ marginBottom: 18 }}>
        <h2 className="title">{q.type === "hunter" ? `${E.pname(s, q.actor)} the Hunter takes a last shot` : `${E.pname(s, q.actor)} the Jester chooses whom to haunt`}</h2>
        <p className="small muted" style={{ marginTop: 6 }}>{q.type === "hunter" ? "Ask them now. The shot is Unstoppable and resolves immediately." : "Only players who voted for the Jester can be haunted. They die next night; nothing can stop it."}</p>
        <div className="targets" style={{ marginTop: 14 }}>{ch.map(id => <button key={id} className="tgt" onClick={() => act.promptSel(q.id, id)} aria-pressed={sel === id}><span className="nm">{E.pname(s, id)}</span></button>)}</div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className={`btn ${q.type === "hunter" ? "danger" : "primary"}`} onClick={() => act.promptGo(q.id)} disabled={!sel}><Icon name={q.type === "hunter" ? "bow" : "jester"} />{q.type === "hunter" ? "Shoot" : "Haunt"}{sel ? " " + E.pname(s, sel) : ""}</button>
          <button className="btn ghost" onClick={() => act.promptSkip(q.id)}>No {q.type === "hunter" ? "shot" : "haunt"}</button>
        </div>
      </section>);
  })}</>;
}

/* ---------- night ---------- */
function TargetGrid({ actorId, abId, d, max = 1, kind = "" }: { actorId: string; abId: string; d: any; max?: number; kind?: string }) {
  const s = A.s;
  const lt = E.legalTargets(s, actorId, abId, max > 1 ? (d.targets.length >= max ? max - 1 : d.targets.length) : 0, d.targets[0]);
  const labels = SLOT_LABELS[kind];
  return (
    <>
      {max > 1 && <p className="small muted" style={{ marginBottom: 10 }}>{labels ? <>Tap the <b>{labels[Math.min(d.targets.length, 1)].toLowerCase()}</b>{d.targets.length >= 2 ? " (tap a chosen player to remove them)" : ""}.</> : "Choose two players."}</p>}
      <div className="targets">
        {lt.map(t => { const p = P(t.id); const sel = d.targets.indexOf(t.id); const pressed = sel >= 0;
          return (
            <button key={t.id} className="tgt" onClick={() => act.draftTarget(t.id)} aria-pressed={pressed} disabled={!t.ok && !pressed}>
              <span className="nm">{p.name}{!t.ok && t.why && <span className="why">{t.why}</span>}</span>
              {pressed && max > 1 && <span className="tag">{labels ? labels[sel].split(" ")[0] : sel + 1}</span>}
            </button>); })}
      </div>
    </>
  );
}

function LiveAnswer({ actorId, ab, d }: { actorId: string; ab: any; d: any }) {
  const s = A.s; const actor = P(actorId); let pv;
  try { pv = E.previewResult(s, { key: actorId, actor: actorId, ab: ab.id, targets: d.targets.slice(), opts: {} }); } catch { return null; }
  if (pv.blocked) return <p className="note warn" style={{ marginTop: 16 }}><Icon name="ban" size="sm" /><span>{actor.name} gets no answer tonight — {pv.blocked === "jailed" ? "they are in jail" : pv.blocked === "roleblocked" ? "they were roleblocked" : "their action is cancelled"}. Wake them anyway, but give no signal.</span></p>;
  const m = pv.messages[0]; if (!m) return null;
  const moved = pv.about && pv.pointed && pv.about !== pv.pointed ? <p className="note warn" style={{ marginTop: 10 }}><Icon name="swap" size="sm" /><span>A Transporter or Witch moved this check: the answer is about {E.pname(s, pv.about)}, but {actor.name} will think it is about {E.pname(s, pv.pointed)}. Give it anyway.</span></p> : null;
  if (ab.kind === "checkSus" || ab.kind === "seekMafia") {
    const up = /^Thumbs up/.test(m);
    return <div className="well" style={{ marginTop: 16, textAlign: "center" }}><p className="small muted">Signal now</p><p className="display" style={{ fontSize: "2.2rem", marginTop: 6, color: up ? "var(--blood)" : "var(--ink)" }}>{up ? "Thumbs up" : ab.kind === "checkSus" ? "Thumbs down" : "No thumbs up"}</p><p className="small muted" style={{ marginTop: 6 }}>{m}</p>{moved}</div>;
  }
  return (
    <div className="well" style={{ marginTop: 16 }}>
      <p className="subtitle">Result ready</p>
      <p className="small muted" style={{ marginTop: 4 }}>Show {actor.name} a private screen instead of saying it out loud.</p>
      <button className="btn primary sm" style={{ marginTop: 12 }} onClick={() => act.showResult(actorId)}><Icon name="eye" size="sm" />Show result to {actor.name}</button>
      {moved}
    </div>
  );
}

function StepStrip({ steps, idx }: { steps: NightStep[]; idx: number }) {
  return (
    <nav aria-label="Night order" className="seg" style={{ width: "100%", background: "none", padding: 0, gap: 6 }}>
      {steps.map((st, i) => { const ss = act.stepState(st);
        return <button key={st.key} onClick={() => act.nightStep(i)} aria-pressed={i === idx} aria-current={i === idx ? "step" : undefined}
          style={{ background: i === idx ? undefined : "color-mix(in oklab, var(--ink) 8%, transparent)", opacity: ss && i !== idx ? 0.6 : 1 }}>
          {ss === "done" ? "✓ " : ss === "skip" ? "– " : ""}{st.title}{st.type === "bluff" ? " (bluff)" : ""}
        </button>; })}
      <button onClick={() => act.nightStep(steps.length)} aria-pressed={idx >= steps.length} style={{ background: idx >= steps.length ? undefined : "color-mix(in oklab, var(--ink) 8%, transparent)" }}>Resolve</button>
    </nav>
  );
}

/** Steps a phone is expected to answer: the room is open, the option is on and a player of that step has joined. */
function phoneSteps(steps: NightStep[]): NightStep[] {
  const s = A.s; const mode = phoneMode(s); if (!Online.room || mode === "off") return [];
  const joined = (id: string) => Online.status.seats.some(x => x.id === id && x.claimed);
  return steps.filter(st => (st.type === "faction" && st.actors!.some(joined)) || (mode === "all" && st.type === "player" && joined(st.actor!)));
}
function PhoneWait({ steps }: { steps: NightStep[] }) {
  const on = phoneSteps(steps); if (!on.length) return null;
  const ph = (A.s.nightUi && A.s.nightUi.night === A.s.night && A.s.nightUi.phone) || {};
  const waiting = on.filter(st => !act.stepState(st) && !(ph[st.key] && ph[st.key].waiting));
  return (
    <p className="note" style={{ marginBottom: 12 }}><Icon name="phone" size="sm" /><span>{waiting.length ? <>Waiting on phones: <b>{waiting.map(st => st.title).join(", ")}</b>. Choices appear here as they arrive.</> : "Every phone has chosen."}</span></p>
  );
}

function NightConsole() {
  const s = A.s; const steps = E.nightSteps(s);
  const idx = Math.max(0, Math.min(A.ui.nightIdx, steps.length));
  const recorded = steps.filter(st => act.stepState(st) === "done").length;
  const handled = steps.filter(st => act.stepState(st)).length;
  return (
    <>
      <PhoneWait steps={steps} />
      <div className="spread small muted" style={{ marginBottom: 10 }}><span>{handled === steps.length ? "Every role called" : `Step ${Math.min(idx + 1, steps.length)} of ${steps.length}`} · {plural(recorded, "action")} recorded</span></div>
      <StepStrip steps={steps} idx={idx} />
      <div key={idx} className="settle" style={{ marginTop: 26 }}>{idx >= steps.length ? <NightSummary steps={steps} /> : <StepPanel st={steps[idx]} idx={idx} total={steps.length} />}</div>
    </>
  );
}

function StepPanel({ st, idx, total }: { st: NightStep; idx: number; total: number }) {
  const s = A.s; const d = act.draftFor(st);
  let inner: React.ReactNode = null, can = false, okLabel = "Confirm", head: React.ReactNode = null;
  const nav = (
    <div className="spread small" style={{ marginTop: 18 }}>
      <button className="btn ghost sm" onClick={() => act.nightStep(idx - 1)} disabled={!idx}><Icon name="back" size="sm" />Previous</button>
      <span className="muted num">{idx + 1} / {total}</span>
      <button className="btn ghost sm" onClick={() => act.nightStep(idx + 1)}>Next<Icon name="chev" size="sm" /></button>
    </div>
  );
  const dock = (primary: React.ReactNode, secondary: React.ReactNode) => <Dock><div className="row nowrap">{secondary}{primary}</div></Dock>;
  if (st.type === "bluff") {
    return (<>
      <h2 className="display">{st.title}, wake up.</h2>
      <p className="lead" style={{ marginTop: 10 }}>No one alive holds this role. Call it as usual, pause a few seconds, then send them back to sleep — the table can’t tell.</p>
      {nav}
      {dock(<button className="btn primary grow" onClick={act.nightSkip}><Icon name="check" />Called — next</button>, null)}
    </>);
  }
  if (st.type === "faction") {
    const carrier = d.carrier ? P(d.carrier) : null; const strongUses = carrier && carrier.roleId === "strongman" ? carrier.uses.strong || 0 : 0;
    head = <>
      <h2 className="display">{st.faction === "mafia" ? "Mafia, wake up." : "Vampires, wake up."}</h2>
      <p className="lead" style={{ marginTop: 10 }}>{st.faction === "mafia" ? "Choose tonight’s victim, and who carries out the kill." : "Choose who to bite."}</p>
      <div className="row" style={{ marginTop: 12, gap: 6 }}>{st.actors!.map(id => <span key={id} className="chip">{E.pname(s, id)} · {role(P(id).roleId).name}</span>)}</div>
    </>;
    inner = <>
      <h3 className="label" style={{ marginTop: 22, marginBottom: 10 }}>Who carries it out?</h3>
      <div className="targets">{st.actors!.map(id => <button key={id} className="tgt" onClick={() => act.draftCarrier(id)} aria-pressed={d.carrier === id}><span className="nm">{E.pname(s, id)}</span></button>)}</div>
      {carrier && E.nightAbilities(s, carrier).length > 0 && <p className="note warn" style={{ marginTop: 10 }}><Icon name="info" size="sm" /><span>{carrier.name} gives up their own {role(carrier.roleId).name} ability tonight to carry out the {st.faction === "mafia" ? "kill" : "bite"}.{st.actors!.length > 1 ? " Pick someone else if you want them to use it." : " They are the only one who can."}</span></p>}
      {strongUses > 0 && <div className="toggle"><div className="grow"><b id="sk-l">Strong kill (Unstoppable)</b><span>{strongUses} left — pierces heals and jail.</span></div><button className="switch" role="switch" aria-checked={!!d.opts.strong} aria-labelledby="sk-l" onClick={() => act.draftOpt("strong")} /></div>}
      <h3 className="label" style={{ marginTop: 22, marginBottom: 10 }}>{st.faction === "mafia" ? "The victim" : "Who to bite"}</h3>
      {d.carrier && <TargetGrid actorId={d.carrier} abId={st.kind!} d={d} />}
    </>;
    can = !!(d.carrier && d.targets[0]); okLabel = d.targets[0] ? `${st.faction === "mafia" ? "Kill" : "Bite"} ${E.pname(s, d.targets[0])}` : "Pick a target";
  } else {
    const actor = P(st.actor!); const r = role(st.roleId);
    const abs = st.abilities!; const ab = abs.find(a => a.id === d.ab) || abs[0];
    const carrying = s.actions.find(a => (a.key === "mafia" || a.key === "vampire") && a.actor === actor.id);
    head = <>
      <h2 className="display">{r.name}, wake up.</h2>
      <p className="lead" style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}><span className="chip" style={{ alignSelf: "center" }}><Icon name={r.icon} size="sm" />{actor.name}</span>{SCRIPT[ab.kind] || "What do you do tonight?"}</p>
      {st.drunk && <p className="note warn" style={{ marginTop: 12 }}><Icon name="bottle" size="sm" /><span>{actor.name} is the Drunk. Record their choice as normal — it has no effect.</span></p>}
    </>;
    if (carrying) {
      return (<>
        {head}
        <p className="note warn" style={{ marginTop: 16 }}><Icon name="info" size="sm" /><span><b>{actor.name} is carrying out tonight’s {carrying.key === "mafia" ? "Mafia kill" : "Vampire bite"}</b> (on {E.pname(s, carrying.targets[0])}), so their own {r.name} ability doesn’t happen. Wake them anyway so the table can’t tell. To use their ability instead, pick a different carrier in the {carrying.key === "mafia" ? "Mafia" : "Vampire"} step.</span></p>
        {nav}
        {dock(<button className="btn primary grow" onClick={act.nightSkip}><Icon name="check" />Called — next</button>, null)}
      </>);
    }
    inner = <>
      {abs.length > 1 && <div className="seg" role="group" aria-label="Ability" style={{ marginTop: 16 }}>{abs.map(a => <button key={a.id} onClick={() => act.draftAb(a.id)} aria-pressed={a.id === ab.id} disabled={!a.ok} title={a.ok ? undefined : a.why}>{a.verb}</button>)}</div>}
      {!ab.ok ? <p className="note" style={{ marginTop: 16 }}><Icon name="info" size="sm" /><span>{ab.why}. Wake them anyway so nobody can tell, then move on.</span></p> : (() => {
        const t = ab.target; const k = ab.kind;
        let body: React.ReactNode = null;
        if (t === "self" || t === "none") { body = <p className="muted" style={{ marginTop: 16 }}>{t === "self" ? "Does the player use this ability tonight?" : "This ability needs no target."}</p>; can = true; okLabel = ab.verb; }
        else if (t === "assigned") { const tg = actor.meta.target; body = <p style={{ marginTop: 16 }}>Their ward is <b>{E.pname(s, tg)}</b>. Shield them tonight?</p>; can = true; okLabel = `${ab.verb} ${E.pname(s, tg)}`; }
        else if (t === "two") { body = <div style={{ marginTop: 18 }}><TargetGrid actorId={actor.id} abId={ab.id} d={d} max={2} kind={k} /></div>; can = d.targets.length === 2; okLabel = can ? `${ab.verb} ${d.targets.map((x: string) => E.pname(s, x)).join(" & ")}` : "Pick two"; }
        else { body = <><h3 className="label" style={{ marginTop: 22, marginBottom: 10 }}>{t === "dead" || t === "deadTown" ? "Choose a dead player" : "Choose a target"}</h3><TargetGrid actorId={actor.id} abId={ab.id} d={d} /></>; can = !!d.targets[0]; okLabel = can ? `${ab.verb} ${E.pname(s, d.targets[0])}` : "Pick a target"; }
        return <>
          {body}
          {LIVE_KINDS.includes(k) && d.targets[0] && <LiveAnswer actorId={actor.id} ab={ab} d={d} />}
          {k === "jail" && (() => { const ex = actor.uses.execute || 0; return <div className="toggle"><div className="grow"><b id="ex-l">Execute the prisoner</b><span>{ex ? ex + " left · Unstoppable" : "No executions left"}</span></div><button className="switch" role="switch" disabled={!ex} aria-checked={!!d.opts.execute} aria-labelledby="ex-l" onClick={() => act.draftOpt("execute")} /></div>; })()}
          {k === "hypnotize" && (() => { if (!d.opts.msg) d.opts.msg = E.HYPNO_MSGS[0]; return <label className="field" style={{ marginTop: 16 }}><span>Message to plant</span><select value={d.opts.msg} onChange={e => act.draftMsg(e.target.value)}>{E.HYPNO_MSGS.map(m => <option key={m}>{m}</option>)}</select></label>; })()}
          {k === "duel" && <><h3 className="label" style={{ marginTop: 20 }}>Who won the duel?</h3><p className="small muted" style={{ margin: "4px 0 10px" }}>A quick rock-paper-scissors between the Pirate and the target.</p><div className="seg" role="group" aria-label="Duel result"><button onClick={() => act.draftDuel(true)} aria-pressed={d.opts.won === true}>The Pirate won</button><button onClick={() => act.draftDuel(false)} aria-pressed={d.opts.won === false}>The target won</button></div></>}
        </>;
      })()}
    </>;
    if (ab.ok && ab.kind === "duel") can = can && typeof d.opts.won === "boolean";
    if (ab.ok) d.ab = ab.id;
  }
  const recorded = s.actions.some(a => a.key === st.key);
  const ph = s.nightUi && s.nightUi.night === s.night && s.nightUi.phone ? s.nightUi.phone[st.key] : null;
  return (<>
    {head}{inner}
    {ph && <p className="note" style={{ marginTop: 16 }}><Icon name="phone" size="sm" /><span>{ph.pass ? `${ph.by} chose no action on their phone.` : ph.waiting ? `${ph.by} chose this on their phone. Record who won the duel to finish it.` : `Chosen on ${ph.by}’s phone.`} You can still change it here.</span></p>}
    {recorded && !ph && <p className="note" style={{ marginTop: 16 }}><Icon name="check" size="sm" /><span>Recorded — confirm again to change it.</span></p>}
    {nav}
    {dock(<button className="btn primary grow" onClick={act.nightConfirm} disabled={!can}><span className="t">{okLabel}</span></button>, <button className="btn" onClick={act.nightSkip}>{st.type === "faction" ? "No " + (st.faction === "mafia" ? "kill" : "bite") : "No action"}</button>)}
  </>);
}

function NightSummary({ steps }: { steps: NightStep[] }) {
  const s = A.s; const missing = steps.filter(st => !act.stepState(st) && st.type !== "bluff");
  return (<>
    <h2 className="display">Ready to resolve Night {s.night}.</h2>
    <p className="lead" style={{ marginTop: 10 }}>The engine applies jail, transports, control, roleblocks, protection, attacks and investigations in priority order.</p>
    {s.actions.length ? <ul style={{ margin: "18px 0 0", paddingLeft: 20 }}>{s.actions.map(a => { const forfeit = !a.key.match(/^(mafia|vampire)$/) && s.actions.some(f => (f.key === "mafia" || f.key === "vampire") && f.actor === a.actor); return <li key={a.key} style={{ margin: "6px 0" }}>{act.actionText(a)}{forfeit && <span className="chip blood" style={{ marginLeft: 6, height: 22 }}>won’t happen — carrying the kill</span>}</li>; })}</ul> : <p className="muted" style={{ marginTop: 18 }}>No actions recorded — a quiet night.</p>}
    {missing.length > 0 && <p className="note warn" style={{ marginTop: 16 }}><Icon name="alert" size="sm" /><span>Not yet called: {missing.map(st => st.title).join(", ")}. They count as no action.</span></p>}
    <Dock><div className="row nowrap"><button className="btn" onClick={act.restartNight}><Icon name="refresh" size="sm" />Restart</button><button className="btn primary grow" onClick={act.resolveAsk}><Icon name="moon" />Resolve Night {s.night}</button></div></Dock>
  </>);
}

/* ---------- dawn ---------- */
function Dawn() {
  const s = A.s; const N = s.night; const rep = s.reports[N] || { deaths: [], saves: [], messages: [], lines: [], publicNotes: [] };
  const fmt = A.ui.annFormat || act.defaultFormat();
  const byTo: Record<string, typeof rep.messages> = {}; for (const m of rep.messages) (byTo[m.to] = byTo[m.to] || []).push(m);
  const lastIsResolve = A.hist.length && /^Resolve Night/.test(A.hist[A.hist.length - 1].label);
  return (<>
    <section>
      <h2 className="title">What happened</h2>
      {rep.deaths.length ? <div className="list" style={{ marginTop: 8 }}>{rep.deaths.map(d => (
        <div className="li" key={d.id}><span style={{ color: "var(--blood)" }}><Icon name="skull" /></span>
          <span className="grow"><b>{E.pname(s, d.id)}</b><span>{role(d.role).name}{d.cleaned ? " (hidden by the Janitor)" : ""} · {d.cause[0].toUpperCase() + d.cause.slice(1)}{d.killers.length ? " (" + d.killers.map(k => E.pname(s, k)).join(", ") + ")" : ""}{d.triggers.length ? " · triggered " + d.triggers.join(", ") : ""}</span></span></div>))}
      </div> : <p className="muted" style={{ marginTop: 8 }}>Nobody died tonight.</p>}
      {rep.saves.length > 0 && <div className="stack small muted" style={{ marginTop: 12, gap: 4 }}>{rep.saves.map((sv, i) => <span key={i}>{E.pname(s, sv.target)} survived ({sv.cause}) — {sv.how === "defense" ? "own defense" : sv.how}{sv.by ? " by " + E.pname(s, sv.by) : ""}</span>)}</div>}
      {(rep.why || []).length > 0 && <div className="stack" style={{ marginTop: 12, gap: 8 }}>{(rep.why || []).map((t, i) => <p key={i} className="note"><Icon name="ban" size="sm" /><span>{t[0].toUpperCase() + t.slice(1)}</span></p>)}</div>}
      {rep.publicNotes.length > 0 && <div className="stack" style={{ marginTop: 12 }}>{rep.publicNotes.map((n, i) => <p key={i} className="note"><Icon name="info" size="sm" /><span>{n}</span></p>)}</div>}
      <details style={{ marginTop: 14 }}><summary className="small muted" style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>How the night resolved, step by step ({rep.lines.length})</summary><ol className="small muted" style={{ paddingLeft: 20 }}>{rep.lines.map((l, i) => <li key={i}>{l}</li>)}</ol></details>
      {lastIsResolve ? <button className="btn ghost sm" onClick={undo}><Icon name="undo" size="sm" />Entered something wrong? Undo the resolution</button> : null}
    </section>

    <section className="section">
      <h2 className="title">Private results</h2>
      <p className="small muted" style={{ marginTop: 4 }}>Show each one on a private screen. Results go only to the player named.</p>
      {Object.keys(byTo).length ? <div className="list" style={{ marginTop: 8 }}>{Object.keys(byTo).map(pid => { const p = P(pid); const k = N + ":" + pid; const done = A.ui.delivered[k];
        return (
          <div className="li" key={pid} style={{ alignItems: "flex-start", opacity: done ? 0.55 : 1 }}>
            <span className="grow"><b>{p.name}</b><span>{role(p.roleId).name}{p.alive ? "" : " · dead"}</span>
              {byTo[pid].map((m, i) => <span key={i} style={{ color: "var(--ink)", marginTop: 4 }}>{m.text}</span>)}
              <span className="row" style={{ marginTop: 10 }}><button className="btn sm primary" onClick={() => act.showPrivate(pid)}><Icon name="eye" size="sm" />Show {p.name}</button><button className="btn sm ghost" onClick={() => act.markDelivered(k)}>{done ? "Not told yet" : "Told them"}</button></span>
            </span>
          </div>); })}</div> : <p className="muted" style={{ marginTop: 8 }}>No private results tonight.</p>}
    </section>

    <section className="section">
      <h2 className="title">The announcement</h2>
      <p className="small muted" style={{ marginTop: 4 }}>Choose what the table hears. The announcement screen shows nothing else.</p>
      <div className="targets compact" role="group" aria-label="Announcement format" style={{ marginTop: 12 }}>{[["name", "Names only"], ["role", "Names and roles"], ["cause", "Names and causes"], ["full", "Roles and causes"], ["custom", "Write my own"]].map(([k, l]) => <button key={k} className="tgt" onClick={() => { A.ui.annFormat = k; emit(); }} aria-pressed={fmt === k}><span className="nm">{l}</span></button>)}</div>
      {fmt === "custom" && <label className="field" style={{ marginTop: 12 }}><span>Your announcement</span><textarea value={A.ui.annCustom} onChange={e => { A.ui.annCustom = e.target.value; emit(); }} placeholder="The town wakes to find…" /></label>}
    </section>
    <Dock><button className="btn block primary" onClick={act.startDay} disabled={!!s.pending.length}><Icon name="sun" />Announce and start Day {N}</button>{s.pending.length > 0 && <p className="tiny muted" style={{ textAlign: "center", marginTop: 6 }}>Resolve the prompt above first.</p>}</Dock>
  </>);
}

/* ---------- day ---------- */
function Timer() {
  const mins = A.s.config.dayTimer; if (!mins) return null;
  const t = A.ui.timer; const left = t ? Math.max(0, t.running ? t.endAt - Date.now() : t.left) : mins * 60000;
  const sec = Math.ceil(left / 1000); const urgent = t && t.running && sec <= 30;
  return (
    <section className="well tight" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
      <div className="grow"><p className="small muted">Discussion · {mins} min</p><p className="display num" style={{ fontSize: "2.6rem", color: urgent ? "var(--blood)" : undefined }} aria-live="off">{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}</p></div>
      <button className={`btn ${t && t.running ? "" : "primary"}`} onClick={act.timerToggle}><Icon name={t && t.running ? "pause" : "play"} size="sm" />{t && t.running ? "Pause" : "Start"}</button>
      <button className="iconbtn" onClick={act.timerReset} aria-label="Reset timer"><Icon name="refresh" size="sm" /></button>
    </section>
  );
}

function MayorNote() {
  const s = A.s; const w = E.mayorMultiplier(s);
  return <>{s.players.filter(p => p.alive && p.roleId === "mayor" && p.fx.revealed).map(m => {
    const left = E.mayorBonusLeft(s, m);
    const txt = !s.config.mayorOnce ? `counts as ${w} votes` : left ? `counts as ${w} votes, one time only (not used yet)` : "has used the one-time bonus and counts as 1 vote";
    return <p key={m.id} className="note" style={{ marginTop: 12 }}><Icon name="crown" size="sm" /><span><b>{m.name}</b> (Mayor) {txt}{E.canVote(s, m) ? "" : " — silenced today, cannot vote"}. {s.config.mayorOnce && <button className="linkbtn" onClick={() => act.mayorBonus(m.id)}>{left ? "Mark used" : "Mark available"}</button>}</span></p>;
  })}</>;
}

function Execution() {
  const s = A.s; const ds = s.dayState!; const alive = s.players.filter(p => p.alive);
  if (ds.done) { const r = ds.result || {}; const t = r.target ? E.pname(s, r.target) : "";
    return <section><h2 className="title">Execution</h2><p className="title" style={{ marginTop: 8, color: "var(--ink-2)" }}>{r.type === "execute" ? (r.spared ? `${t} was voted out — but survived.` : `${t} was executed.`) : r.reason || "No execution."}</p></section>; }
  const pick = <div className="targets" style={{ marginTop: 12 }}>{alive.map(p => <button key={p.id} className="tgt" onClick={() => act.execPick(p.id)}><span className="nm">{p.name}</span></button>)}</div>;
  if (!ds.open) {
    const phones = Online.room && Online.status.seats.some(x => x.claimed);
    return (
      <section>
        <h2 className="title">Who does the town execute?</h2>
        <MayorNote />
        {phones ? <><p className="small muted" style={{ marginTop: 8 }}>Players have their phones. Let them vote, or just tap who the town chose.</p><button className="btn primary sm" style={{ marginTop: 12 }} onClick={act.voteOpen}><Icon name="hand" size="sm" />Let phones vote</button></>
          : <p className="small muted" style={{ marginTop: 8 }}>Tap the player the town chose, or skip.</p>}
        {pick}
        <div className="row" style={{ marginTop: 14 }}><button className="btn" onClick={act.voteSkip}><Icon name="forward" size="sm" />Skip execution</button></div>
      </section>
    );
  }
  const t = E.tally(s); const opts = ds.nominees.concat(s.config.allowSkip ? ["skip"] : []);
  const nm = (id: string) => (id === "skip" ? "No execution" : E.pname(s, id));
  const max = Math.max(1, ...Object.values(t.totals)); const r = t.result;
  const preview = r.type === "execute" ? `${nm(r.target)} would be executed.` : r.type === "revote" ? `Tie between ${r.tied.map(nm).join(" and ")} — a revote would follow.` : r.type === "random" ? `Tie between ${r.tied.map(nm).join(" and ")} — one is picked at random.` : r.reason;
  const seats = Online.status.seats || [];
  const noPhone = alive.filter(p => E.canVote(s, p) && !(seats.find(x => x.id === p.id) || { claimed: false }).claimed);
  const shown = opts.filter(o => (t.totals[o] || 0) > 0 || o === "skip");
  return (
    <section>
      <div className="spread"><h2 className="title">Phones are voting{ds.round > 1 ? ` · round ${ds.round}` : ""}</h2><span className="chip num">{t.cast} of {t.totalW} in</span></div>
      <MayorNote />
      <div className="stack" style={{ marginTop: 16, gap: 10 }}>
        {(shown.length ? shown : opts.slice(0, 3)).map(o => (
          <div key={o} style={{ display: "grid", gridTemplateColumns: "minmax(80px, 30%) 1fr 32px", gap: 10, alignItems: "center" }}>
            <span className="small strong" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nm(o)}</span>
            <span style={{ height: 10, borderRadius: 10, background: "color-mix(in oklab, var(--ink) 12%, transparent)", overflow: "hidden" }}><i style={{ display: "block", height: "100%", width: `${((t.totals[o] || 0) / max) * 100}%`, background: o === "skip" ? "var(--ink-2)" : "var(--ink)", borderRadius: 10, transition: "width .5s var(--ease)" }} /></span>
            <b className="num" style={{ textAlign: "right" }}>{t.totals[o] || 0}</b>
          </div>))}
      </div>
      <p className="subtitle" style={{ marginTop: 16 }}>{preview}</p>
      <div className="row" style={{ marginTop: 14 }}><button className="btn primary" onClick={act.voteConfirm}><Icon name="gavel" />Lock in the result</button><button className="btn ghost" onClick={act.voteClose}>Close voting</button></div>
      {noPhone.length > 0 && <div style={{ marginTop: 20 }}><h3 className="label">Players without a phone: enter their vote</h3>
        {noPhone.map(p => <label key={p.id} className="field" style={{ marginTop: 10 }}><span>{p.name}{E.voteWeight(s, p) > 1 ? ` · ${E.voteWeight(s, p)}×` : ""}</span><select data-pid={p.id} value={ds.votes[p.id] || ""} onChange={e => act.voteManual(p.id, e.target.value)}><option value="">No vote yet</option>{opts.map(o => <option key={o} value={o}>{nm(o)}</option>)}</select></label>)}
      </div>}
      <p className="small muted" style={{ marginTop: 20 }}>Or tap a player to execute them now:</p>
      {pick}
    </section>
  );
}

function DayAbilities() {
  const s = A.s; const rows: React.ReactNode[] = [];
  for (const p of s.players.filter(x => x.alive)) {
    if (p.roleId === "mayor" && !p.fx.revealed) rows.push(<div className="li" key={p.id + "m"}><Icon name="crown" /><span className="grow"><b>{p.name} · Mayor</b><span>May reveal; their vote then counts as {E.mayorRuleText(s)}.</span></span><button className="btn sm" onClick={() => act.mayorReveal(p.id)}>Reveal</button></div>);
    if (["goodguesser", "evilguesser"].includes(p.roleId || "")) { const st = E.guessStatus(s, p); rows.push(<div className="li" key={p.id + "g"}><Icon name="dice" /><span className="grow"><b>{p.name} · {role(p.roleId).name}</b><span>{p.uses.guess || 0} shots left{st.ok ? "" : " · " + st.why}</span></span><button className="btn sm" onClick={() => act.openSheet("guess", { id: p.id })} disabled={!st.ok}>Guess</button></div>); }
  }
  if (!rows.length) return null;
  return <section className="section"><h2 className="title">Day abilities</h2><div className="list" style={{ marginTop: 6 }}>{rows}</div></section>;
}

function Day() {
  const s = A.s;
  const bm = s.players.filter(p => p.alive && p.fx.blackmailed === s.day), sl = s.players.filter(p => p.alive && p.fx.silenced === s.day);
  const notes = s.publicNotes.filter(n => n.ph === "D" + s.day);
  return (<>
    {(bm.length || sl.length || notes.length) ? (
      <section style={{ marginBottom: 22 }}>
        <h2 className="label">Read out today</h2>
        <div className="stack" style={{ marginTop: 8 }}>
          {bm.map(p => <p key={p.id} className="note warn"><Icon name="envelope" size="sm" /><span><b>{p.name}</b> has been blackmailed and may not speak.</span></p>)}
          {sl.map(p => <p key={p.id} className="note warn"><Icon name="mute" size="sm" /><span><b>{p.name}</b> has been silenced and may not vote.</span></p>)}
          {notes.map((n, i) => <p key={i} className="note"><Icon name="info" size="sm" /><span>{n.text}</span></p>)}
        </div>
      </section>) : null}
    <Timer />
    <Execution />
    <DayAbilities />
    <div className="row" style={{ marginTop: 26 }}><button className="btn ghost sm" onClick={act.restartDay}><Icon name="restart" size="sm" />Restart Day {s.day}</button></div>
    {s.dayState && s.dayState.done && !s.winPrompt && <Dock><button className="btn block primary" onClick={act.endDay} disabled={!!s.pending.length}><Icon name="moon" />Begin Night {s.day + 1}</button>{s.pending.length > 0 && <p className="tiny muted" style={{ textAlign: "center", marginTop: 6 }}>Resolve the prompt above first.</p>}</Dock>}
  </>);
}

/* ---------- the end ---------- */
/** One tap that teaches "For you" what this group enjoys. */
function Rate() {
  const v = (A.s as { rating?: number }).rating || 0;
  return (
    <div className="well tight">
      <div className="spread" style={{ flexWrap: "wrap", gap: 10 }}>
        <span className="grow" style={{ minWidth: 150 }}><b className="subtitle">How was this game?</b><span className="small muted" style={{ display: "block", marginTop: 2 }}>Your answer shapes the “For you” suggestions.</span></span>
        <span className="row nowrap" style={{ gap: 8 }}>
          <button className="btn sm" aria-pressed={v === 1} style={v === 1 ? { background: "var(--ink)", color: "var(--ground)" } : undefined} onClick={() => act.rate(v === 1 ? 0 : 1)}><Icon name="thumbup" size="sm" />Loved it</button>
          <button className="btn sm" aria-pressed={v === -1} style={v === -1 ? { background: "var(--ink)", color: "var(--ground)" } : undefined} onClick={() => act.rate(v === -1 ? 0 : -1)}><Icon name="thumbdown" size="sm" />Not for us</button>
        </span>
      </div>
    </div>
  );
}

function Ended() {
  const s = A.s; const r = s.result!; const st = E.stats(s); const wins = new Set(r.winners.map(w => w.id));
  const fate = (pid: string, alive: boolean) => { if (alive) return "survived"; const d = s.deaths.slice().reverse().find(x => x.id === pid); return d ? `died ${d.ph}, ${d.cause}` : "died"; };
  return (<>
    <section style={{ margin: "4vh 0 28px" }}>
      <h1 className="mega phase-title">{r.factionName} {r.faction === "draw" || r.faction.startsWith("solo:") ? "wins" : "win"}.</h1>
      <p className="lead" style={{ marginTop: 16 }}>{r.reason}</p>
    </section>
    <Rate />
    <div className="stack" style={{ marginTop: 18 }}>
      <button className="btn block primary" onClick={act.rematch}><Icon name="dice" />Rematch — reshuffle and go</button>
      <button className="btn block" onClick={act.playAgain}><Icon name="refresh" />Play again with these players</button>
    </div>
    <section className="section">
      <h2 className="title">Winners</h2>
      <div className="row" style={{ marginTop: 10, gap: 6 }}>{r.winners.length ? r.winners.map(w => <span key={w.id} className="chip solid">{E.pname(s, w.id)} · {w.why}</span>) : <span className="muted">Nobody won.</span>}</div>
    </section>
    <section className="section">
      <h2 className="title">Every role, revealed</h2>
      <div className="list" style={{ marginTop: 6 }}>{s.players.map(p => { const ir = (s.initialRoles || []).find(x => x.id === p.id); const changed = ir && ir.roleId !== p.roleId;
        return (
          <div className="li" key={p.id}>
            <span className="grow"><b>{p.name}</b><span>{role(p.roleId).name}{changed ? ` (started as ${role(ir!.roleId).name})` : ""} · {fate(p.id, p.alive)}</span></span>
            <span className={`team ${p.team}`}>{teamName(p.team)}</span>
            <span className="small strong" style={{ width: 44, textAlign: "right", color: wins.has(p.id) ? "var(--ink)" : "var(--ink-2)" }}>{wins.has(p.id) ? "Won" : "Lost"}</span>
          </div>); })}</div>
    </section>
    <section className="section">
      <h2 className="title" style={{ marginBottom: 12 }}>The numbers</h2>
      <div className="stats">{([[st.nights, "Nights"], [st.deaths, "Deaths"], [st.mafiaKills, "Mafia kills"], [st.townKills, "Town kills"], [st.saves, "Saves"], [st.executions, "Executions"], [st.voteRounds, "Votes"], [fmtDur(st.duration), "Duration"]] as [number | string, string][]).map(([v, l]) => <div key={l} className="stat"><b>{v}</b><span>{l}</span></div>)}</div>
      <div className="list" style={{ marginTop: 12 }}>
        <div className="li"><span className="grow"><span>Most valuable player</span><b>{st.mvp ? st.mvp.name : "—"}</b></span></div>
        <div className="li"><span className="grow"><span>Most targeted at night</span><b>{st.mostTargeted ? `${st.mostTargeted.name} · ${plural(st.mostTargeted.n, "visit")}` : "—"}</b></span></div>
        <div className="li"><span className="grow"><span>Most kills</span><b>{st.mostKills ? `${st.mostKills.name} · ${st.mostKills.n}` : "—"}</b></span></div>
      </div>
    </section>
    <section className="section row">
      <button className="btn" onClick={act.newGame}><Icon name="plus" size="sm" />New game</button>
      <button className="btn ghost" onClick={() => act.nav("timeline")}><Icon name="clock" size="sm" />Full log</button>
      <button className="btn ghost" onClick={act.exportLog}><Icon name="download" size="sm" />Export log</button>
    </section>
  </>);
}

export function Game() {
  const s = A.s;
  if (s.phase === "ended") return <Ended />;
  const hero = s.phase === "night" ? <Hero big={`Night ${s.night}.`} line="Wake each role in turn and record their choice. Order doesn’t matter — the engine resolves by priority." />
    : s.phase === "dawn" ? <Hero big="Dawn." line="Only you see this. Deliver private results, then announce the night." />
    : s.phase === "day" ? <Hero big={`Day ${s.day}.`} line="Let the town talk. Then decide." /> : null;
  return (<>
    {hero}
    <Banners />
    <Prompts />
    {s.phase === "night" ? <NightConsole /> : s.phase === "dawn" ? <Dawn /> : s.phase === "day" ? <Day /> : null}
    <section className="section">
      <div className="section-head"><h2 className="title">At a glance</h2><button className="btn ghost sm" onClick={() => act.nav("players")}>All players<Icon name="chev" size="sm" /></button></div>
      <StatsStrip />
      <div className="tiles" style={{ marginTop: 10 }}>{s.players.map(p => <PlayerTile key={p.id} p={p} />)}</div>
    </section>
  </>);
}
