"use client";
import { useEffect, useRef, useState } from "react";
import E from "@/lib/engine/engine";
import { A, emit, P, role, teamName, lastHist, toast } from "@/lib/client/store";
import { Online, type Diag } from "@/lib/client/online";
import { Cloud } from "@/lib/client/cloud";
import * as act from "@/lib/client/actions";
import { Icon } from "@/components/ui/Icon";
import { RoleSheet, CustomRoleSheet } from "./Roles";
import { OnlinePanel, ChatLog } from "./OnlinePanel";
import { fxChips } from "./Players";

/* eslint-disable @typescript-eslint/no-explicit-any */
const Head = ({ title, icon }: { title: string; icon?: string }) => (
  <header>{icon && <Icon name={icon} size="lg" />}<h2>{title}</h2><button className="iconbtn" onClick={act.closeSheet} aria-label="Close"><Icon name="x" /></button></header>
);

function Confirm({ sh }: { sh: any }) {
  return (
    <>
      <Head title={sh.title} />
      {sh.body && <p className="muted">{sh.body}</p>}
      {sh.detail && <ul className="small" style={{ paddingLeft: 18, margin: "12px 0 0" }}>{sh.detail.map((d: string, i: number) => <li key={i} style={{ margin: "4px 0" }}>{d}</li>)}</ul>}
      <div className="row" style={{ marginTop: 22 }}>
        <button className={`btn ${sh.danger ? "danger" : "primary"}`} onClick={() => { const fn = sh.onOk; A.ui.sheet = null; emit(); if (fn) fn(); }}>{sh.ok || "Confirm"}</button>
        <button className="btn ghost" onClick={act.closeSheet}>Cancel</button>
      </div>
    </>
  );
}

function MenuRow({ icon, title, desc, onClick, disabled, danger }: { icon: string; title: string; desc: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button className="li" onClick={onClick} disabled={disabled} style={{ border: 0, background: "none", color: danger ? "var(--blood)" : "inherit", textAlign: "left", width: "100%", opacity: disabled ? 0.4 : 1 }}>
      <Icon name={icon} /><span className="grow"><b>{title}</b><span>{desc}</span></span><Icon name="chev" size="sm" />
    </button>
  );
}

function Menu() {
  const s = A.s; const inGame = s.phase !== "setup"; const N = s.phase === "day" ? s.day : s.night;
  return (
    <>
      <Head title="Menu" />
      <div className="list">
        <div className="toggle"><div className="grow"><b id="mnu-snd">Sound</b><span>Night drone, chimes, the heartbeat and the kill.</span></div><button className="switch" role="switch" aria-checked={A.prefs.sound} aria-labelledby="mnu-snd" onClick={act.toggleSound} /></div>
        {Cloud.host ? <MenuRow icon="user" title={Cloud.host.displayName} desc="Your account, saved setups and games" onClick={() => act.openSheet("account")} />
          : Cloud.status === "out" ? <MenuRow icon="user" title="Sign in" desc="Keep setups, groups and games on every device" onClick={() => act.openSheet("signin")} /> : null}
      </div>
      {inGame && <>
        <h3 className="label" style={{ marginTop: 22 }}>Restart</h3>
        <div className="list">
          {s.phase === "night" && <MenuRow icon="moon" title={`Restart Night ${N}`} desc="Clear every action recorded tonight and start from the first role." onClick={act.restartNight} />}
          {s.phase === "dawn" && <MenuRow icon="moon" title={`Restart Night ${N}`} desc="Undo the night’s results and clear tonight’s actions." onClick={act.restartNight} disabled={lastHist(`Resolve Night ${N}`) < 0} />}
          {s.phase === "day" && <MenuRow icon="sun" title={`Restart Day ${N}`} desc="Undo today’s votes, executions and day abilities." onClick={act.restartDay} disabled={lastHist(`Start Day ${N}`) < 0} />}
          <MenuRow icon="restart" title="Restart — same roles" desc="Back to Night 1. Everyone keeps the card they were dealt." onClick={act.restartSame} disabled={!(s.initialRoles && s.initialRoles.length === s.players.length)} />
          <MenuRow icon="dice" title="Reshuffle and restart" desc="Same players and role list, new secret roles, then the reveal." onClick={act.restartReshuffle} />
          <MenuRow icon="settings" title="Back to setup" desc="Same players. Change roles or rules before dealing again." onClick={act.restartSetup} />
        </div>
      </>}
      {Online.avail && <><h3 className="label" style={{ marginTop: 22, marginBottom: 10 }}>Players’ phones</h3><OnlinePanel /></>}
      <h3 className="label" style={{ marginTop: 22 }}>{inGame ? "Start over" : "Setup"}</h3>
      <div className="list">
        <MenuRow icon="plus" title="New game" desc={inGame ? "Clear everything, including the players." : "Clear the players and setup and start again."} onClick={act.newGame} danger />
        <MenuRow icon="mask" title="Home" desc="The start screen, your games and saved setups." onClick={act.goHome} />
      </div>
      <p className="tiny muted" style={{ marginTop: 14 }}>Every restart can be undone with Undo straight afterwards.</p>
    </>
  );
}

function PlayerSheet({ id }: { id: string }) {
  const s = A.s; const p = E.getP(s, id); if (!p) return null;
  const r = p.roleId ? role(p.roleId) : null; const death = s.deaths.slice().reverse().find(d => d.id === p.id);
  const hist: { N: string; lines: string[]; msgs: string[] }[] = [];
  for (const [N, rep] of Object.entries(s.reports)) {
    const lines = rep.visits.filter(v => v.from === p.id).map(v => `${E.KINDS[v.kind] ? E.KINDS[v.kind].verb : v.kind} → ${E.pname(s, v.to)}`);
    for (const c of rep.cancelled.filter(c => c.actor === p.id)) lines.push(`Action cancelled (${c.why})`);
    const msgs = rep.messages.filter(m => m.to === p.id).map(m => m.text);
    if (lines.length || msgs.length) hist.push({ N, lines, msgs });
  }
  return (
    <>
      <Head title={p.name} icon={r ? r.icon : "user"} />
      {r ? <>
        <div className="row"><span className={`team ${p.team}`}>{teamName(p.team)}</span><span className="chip">{p.alive ? "Alive" : "Dead" + (death ? " · " + death.ph : "")}</span>{fxChips(p).filter(c => !c.t.startsWith("Dead")).map((c, i) => <span key={i} className={`chip ${c.tone || ""}`}>{c.t}</span>)}</div>
        <h3 className="display" style={{ fontSize: "2rem", marginTop: 16 }}>{r.name}</h3>
        {p.roleId === "drunk" && p.meta.fake && <p className="small muted">Believes they are the {role(p.meta.fake).name}</p>}
        <p className="muted" style={{ marginTop: 6 }}>{r.desc}</p>
        {(r.abilities || []).length > 0 && <ul className="small" style={{ paddingLeft: 18, marginTop: 10 }}>{r.abilities.map((a, i) => <li key={i}>{E.describeAbility(s, p, a)}</li>)}{p.uses.execute !== undefined && <li>Execute · {p.uses.execute} left</li>}</ul>}
        {p.meta.target && <p className="small" style={{ marginTop: 8 }}>{p.roleId === "guardian" ? "Ward" : "Target"}: <b>{E.pname(s, p.meta.target)}</b>{p.meta.won ? " · objective complete" : ""}</p>}
        {p.meta.duelWins ? <p className="small">Duels won: {p.meta.duelWins}/2</p> : null}
        {death && <p className="note" style={{ marginTop: 10 }}><Icon name="skull" size="sm" /><span><b>Death:</b> {death.cause}{death.killers.length ? " — by " + death.killers.map(k => E.pname(s, k)).join(", ") : ""}{death.cleaned ? " · role hidden publicly" : ""}</span></p>}
        <h3 className="label" style={{ marginTop: 20 }}>Night history and what they know</h3>
        {hist.length ? <div className="stack" style={{ marginTop: 8, gap: 10 }}>{hist.map(h => <div key={h.N} className="small"><b>Night {h.N}</b>{h.lines.map((l, i) => <div key={i} className="muted">{l}</div>)}{h.msgs.map((m, i) => <div key={"m" + i}>“{m}”</div>)}</div>)}</div> : <p className="small muted" style={{ marginTop: 6 }}>Nothing yet.</p>}
      </> : <p className="muted">Roles have not been dealt yet.</p>}
      <h3 className="label" style={{ marginTop: 20 }}>Game Master tools</h3>
      <div className="row" style={{ marginTop: 10 }}>
        {r && <button className="btn sm" onClick={() => act.openReveal([p.id])}><Icon name="eye" size="sm" />Show their role</button>}
        <button className="btn sm" onClick={() => act.openSheet("rename", { id: p.id })}><Icon name="edit" size="sm" />Rename</button>
        {r && s.phase !== "setup" && s.phase !== "ended" && <>
          <button className="btn sm" onClick={() => act.openSheet("setrole", { id: p.id })}><Icon name="swap" size="sm" />Change role</button>
          {p.alive ? <button className="btn sm danger" onClick={() => act.openSheet("kill", { id: p.id })}><Icon name="skull" size="sm" />Kill</button> : <button className="btn sm" onClick={() => act.revive(p.id)}><Icon name="ankh" size="sm" />Revive</button>}
        </>}
      </div>
    </>
  );
}

function Rename({ id }: { id: string }) {
  const p = P(id); const [v, setV] = useState(p.name);
  return (<>
    <Head title={`Rename ${p.name}`} />
    <form onSubmit={e => { e.preventDefault(); act.renamePlayer(id, v); }}>
      <label className="field"><span>Name</span><input autoFocus value={v} onChange={e => setV(e.target.value)} maxLength={24} /></label>
      <div className="row" style={{ marginTop: 16 }}><button className="btn primary" type="submit">Save</button><button className="btn ghost" type="button" onClick={act.closeSheet}>Cancel</button></div>
    </form>
  </>);
}

function Kill({ id }: { id: string }) {
  const p = P(id); const [cause, setCause] = useState("removed by the Game Master");
  return (<>
    <Head title={`Kill ${p.name}?`} />
    <p className="muted">A Game Master kill bypasses all protection and fires death triggers (lovers, Hunter, promotions). You can undo it.</p>
    <label className="field" style={{ marginTop: 14 }}><span>Cause, for the record</span><input value={cause} onChange={e => setCause(e.target.value)} maxLength={60} /></label>
    <div className="row" style={{ marginTop: 16 }}><button className="btn danger" onClick={() => act.killGo(id, cause)}><Icon name="skull" />Kill {p.name}</button><button className="btn ghost" onClick={act.closeSheet}>Cancel</button></div>
  </>);
}

function SetRole({ id }: { id: string }) {
  const p = P(id); const [r, setR] = useState(p.roleId || "villager"); const [t, setT] = useState("");
  return (<>
    <Head title={`Change ${p.name}`} />
    <p className="small muted">Fix a mistake or apply a house ruling. Uses reset to the new role’s defaults.</p>
    <label className="field" style={{ marginTop: 14 }}><span>Role</span><select value={r} onChange={e => setR(e.target.value)}>{E.allRoles(A.s).map(x => <option key={x.id} value={x.id}>{x.name} ({teamName(x.team)})</option>)}</select></label>
    <label className="field" style={{ marginTop: 12 }}><span>Team</span><select value={t} onChange={e => setT(e.target.value)}><option value="">The role’s own team</option>{["town", "mafia", "cult", "vampire", "solo", "neutral"].map(x => <option key={x} value={x}>{teamName(x)}</option>)}</select></label>
    <div className="row" style={{ marginTop: 16 }}><button className="btn primary" onClick={() => act.setRoleGo(id, r, t)}>Apply</button><button className="btn ghost" onClick={act.closeSheet}>Cancel</button></div>
  </>);
}

function Guess({ id }: { id: string }) {
  const s = A.s; const g = P(id); const poolIds = Object.keys(s.setup.pool).filter(k => s.setup.pool[k] > 0);
  const targets = s.players.filter(p => p.alive && p.id !== g.id);
  const [t, setT] = useState(targets[0] ? targets[0].id : ""); const [r, setR] = useState(poolIds[0] || "");
  return (<>
    <Head title={`${g.name} makes a guess`} />
    <p className="small muted">Right: the target is shot (Unstoppable). Wrong: {s.config.guessWrong === "die" ? "the guesser dies" : s.config.guessWrong === "lose" ? "the guesser loses their guesses" : "nothing happens"}. {g.uses.guess || 0} shot{g.uses.guess === 1 ? "" : "s"} left.</p>
    <label className="field" style={{ marginTop: 14 }}><span>Target</span><select value={t} onChange={e => setT(e.target.value)}>{targets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label className="field" style={{ marginTop: 12 }}><span>Guessed role</span><select value={r} onChange={e => setR(e.target.value)}>
      <optgroup label="In this game’s role list">{poolIds.map(x => <option key={x} value={x}>{role(x).name}</option>)}</optgroup>
      <optgroup label="Other roles">{E.allRoles(s).filter(x => !poolIds.includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
    </select></label>
    <div className="row" style={{ marginTop: 16 }}><button className="btn danger" onClick={() => act.guessGo(id, t, r)}><Icon name="dice" />Lock in the guess</button><button className="btn ghost" onClick={act.closeSheet}>Cancel</button></div>
  </>);
}

function Import() {
  const [v, setV] = useState("");
  return (<>
    <Head title="Import a save" />
    <p className="small muted">Paste the contents of an Omertà save file. This replaces the current game.</p>
    <label className="sr" htmlFor="imp">Save data</label><textarea id="imp" className="input" style={{ marginTop: 12, minHeight: 160 }} value={v} onChange={e => setV(e.target.value)} placeholder='{"v":1, …}' />
    <div className="row" style={{ marginTop: 16 }}><button className="btn primary" onClick={() => act.importSave(v)}>Import</button><button className="btn ghost" onClick={act.closeSheet}>Cancel</button></div>
  </>);
}

function Diagnose({ d }: { d: Diag }) {
  return (<>
    <Head title="Online room check" />
    <p className="small muted" style={{ marginBottom: 8 }}>{d.ok ? "Everything looks right. Close this and try hosting again." : "Something needs fixing before rooms and accounts can work:"}</p>
    <div className="list">{d.steps.map((st, i) => (
      <div className="li" key={i} style={{ alignItems: "flex-start" }}>
        <span style={{ color: st.ok ? "var(--team-town)" : "var(--blood)", marginTop: 2 }}><Icon name={st.ok ? "check" : "alert"} /></span>
        <span className="grow"><b>{st.name}</b><span>{st.detail}</span>{st.fix && <span style={{ color: "var(--ink)", marginTop: 4 }}>{st.fix}</span>}</span>
      </div>))}
    </div>
    <div className="row" style={{ marginTop: 16 }}><button className="btn primary" onClick={async () => { const nd = await Online.diagnose(); act.openSheet("diag", { data: nd }); }}><Icon name="refresh" />Check again</button><button className="btn ghost" onClick={act.closeSheet}>Close</button></div>
  </>);
}

/* ---------- host account ---------- */
function useBusy() { const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); return { busy, err, setErr, run: async (f: () => Promise<void>) => { setBusy(true); setErr(""); try { await f(); } catch (e: any) { setErr(e.message); } setBusy(false); } }; }

function SignIn() {
  const [u, setU] = useState(""); const [p, setP] = useState(""); const b = useBusy();
  return (<>
    <Head title="Sign in" />
    <p className="small muted">Your saved setups, groups, custom roles and games, on any device.</p>
    <form className="stack" style={{ marginTop: 16 }} onSubmit={e => { e.preventDefault(); b.run(async () => { await Cloud.login(u, p); act.closeSheet(); }); }}>
      <label className="field"><span>Username</span><input autoFocus value={u} onChange={e => setU(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={24} /></label>
      <label className="field"><span>Password</span><input type="password" value={p} onChange={e => setP(e.target.value)} autoComplete="current-password" /></label>
      {b.err && <p className="note warn" role="alert"><Icon name="alert" size="sm" /><span>{b.err}</span></p>}
      <button className="btn block primary" type="submit" disabled={b.busy || !u || !p}>{b.busy ? "Signing in…" : "Sign in"}</button>
    </form>
    <div className="row" style={{ marginTop: 14, justifyContent: "space-between" }}>
      <button className="linkbtn" onClick={() => act.openSheet("signup")}>Create an account</button>
      <button className="linkbtn" onClick={() => act.openSheet("recover")}>Forgot password?</button>
    </div>
  </>);
}

function SignUp() {
  const [u, setU] = useState(""); const [p, setP] = useState(""); const b = useBusy();
  return (<>
    <Head title="Create an account" />
    <p className="small muted">Pick a username and a password. No email needed — you’ll get a recovery code instead.</p>
    <form className="stack" style={{ marginTop: 16 }} onSubmit={e => { e.preventDefault(); b.run(async () => { const code = await Cloud.signup(u, p); act.openSheet("recovery-code", { code, fresh: true }); }); }}>
      <label className="field"><span>Username</span><input autoFocus value={u} onChange={e => setU(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={24} placeholder="3 to 24 letters or numbers" /></label>
      <label className="field"><span>Password</span><input type="password" value={p} onChange={e => setP(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" /></label>
      {b.err && <p className="note warn" role="alert"><Icon name="alert" size="sm" /><span>{b.err}</span></p>}
      <button className="btn block primary" type="submit" disabled={b.busy || u.length < 3 || p.length < 8}>{b.busy ? "Creating…" : "Create account"}</button>
    </form>
    {(A.presets.length + A.groups.length + A.customLib.length) > 0 && <p className="small muted" style={{ marginTop: 14 }}>The setups and groups saved on this device move into your new account.</p>}
    <div className="row" style={{ marginTop: 12 }}><button className="linkbtn" onClick={() => act.openSheet("signin")}>I already have an account</button></div>
  </>);
}

function Recover() {
  const [u, setU] = useState(""); const [c, setC] = useState(""); const [p, setP] = useState(""); const b = useBusy();
  return (<>
    <Head title="Reset your password" />
    <p className="small muted">Use the recovery code you saved when you made the account. Every other device is signed out.</p>
    <form className="stack" style={{ marginTop: 16 }} onSubmit={e => { e.preventDefault(); b.run(async () => { const code = await Cloud.recover(u, c, p); act.openSheet("recovery-code", { code }); }); }}>
      <label className="field"><span>Username</span><input autoFocus value={u} onChange={e => setU(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} /></label>
      <label className="field"><span>Recovery code</span><input value={c} onChange={e => setC(e.target.value.toUpperCase())} autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX" style={{ letterSpacing: "0.12em" }} /></label>
      <label className="field"><span>New password</span><input type="password" value={p} onChange={e => setP(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" /></label>
      {b.err && <p className="note warn" role="alert"><Icon name="alert" size="sm" /><span>{b.err}</span></p>}
      <button className="btn block primary" type="submit" disabled={b.busy || !u || c.length < 12 || p.length < 8}>{b.busy ? "Resetting…" : "Reset password"}</button>
    </form>
  </>);
}

function RecoveryCode({ code, fresh }: { code: string; fresh?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (<>
    <header><h2>{fresh ? "Save your recovery code" : "Your new recovery code"}</h2></header>
    <p className="muted">There’s no email reset. If you forget your password, this code is the only way back in. Write it down or keep a screenshot somewhere safe — it won’t be shown again.</p>
    <div className="well" style={{ marginTop: 16, textAlign: "center" }}><div className="display num" style={{ letterSpacing: "0.1em", fontSize: "clamp(1.8rem, 8vw, 2.6rem)", userSelect: "all" }}>{code}</div></div>
    <div className="row" style={{ marginTop: 16 }}>
      <button className="btn" onClick={() => { navigator.clipboard?.writeText(code).then(() => setCopied(true), () => {}); }}><Icon name="copy" size="sm" />{copied ? "Copied" : "Copy"}</button>
      <button className="btn primary grow" onClick={act.closeSheet}>I’ve saved it</button>
    </div>
  </>);
}

function Account() {
  const h = Cloud.host; if (!h) return null;
  const n = (k: string) => Cloud.items.filter(i => i.kind === k).length;
  return (<>
    <Head title={h.displayName} icon="user" />
    <p className="small muted">Signed in as @{h.username}. Everything below is kept in your account and on this device.</p>
    <div className="stats" style={{ marginTop: 16 }}>
      <div className="stat"><b>{n("game")}</b><span>Games</span></div>
      <div className="stat"><b>{n("setup")}</b><span>Setups</span></div>
      <div className="stat"><b>{n("group")}</b><span>Groups</span></div>
      <div className="stat"><b>{n("role")}</b><span>Custom roles</span></div>
    </div>
    <p className="small muted" style={{ marginTop: 14 }}>Games save themselves as you play. Find them on the home screen under Your games.</p>
    <div className="row" style={{ marginTop: 18 }}>
      <button className="btn" onClick={() => { Cloud.refresh(); toast("Refreshed"); }}><Icon name="refresh" size="sm" />Refresh</button>
      <button className="btn ghost" onClick={async () => { await Cloud.logout(); act.closeSheet(); }}>Sign out</button>
    </div>
  </>);
}

function DeleteGame({ id, name }: { id: string; name: string }) {
  return (<>
    <Head title={`Delete “${name}”?`} />
    <p className="muted">The saved game is removed from your account. The game open on this phone isn’t affected.</p>
    <div className="row" style={{ marginTop: 20 }}><button className="btn danger" onClick={() => { Cloud.deleteGame(id); act.closeSheet(); }}>Delete</button><button className="btn ghost" onClick={act.closeSheet}>Cancel</button></div>
  </>);
}

function CopyText({ title, text }: { title: string; text: string }) {
  return (<><Head title={title} /><p className="small muted">Saving files isn’t available here, so select this text and copy it.</p><textarea className="input" readOnly style={{ marginTop: 12, minHeight: 200, fontSize: 13 }} value={text} /></>);
}

export function SheetHost() {
  const sh = A.ui.sheet; const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sh) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") act.closeSheet(); };
    window.addEventListener("keydown", onKey);
    const el = ref.current && ref.current.querySelector<HTMLElement>("input:not([type=hidden]), textarea, .btn, button");
    if (el && !(el as HTMLInputElement).autofocus) el.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [sh && sh.type, sh && sh.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sh) return null;
  const body = (() => {
    switch (sh.type) {
      case "confirm": return <Confirm sh={sh} />;
      case "menu": return <Menu />;
      case "player": return <PlayerSheet id={sh.id} />;
      case "role": return <RoleSheet id={sh.id} />;
      case "custom": return <CustomRoleSheet />;
      case "rename": return <Rename id={sh.id} />;
      case "kill": return <Kill id={sh.id} />;
      case "setrole": return <SetRole id={sh.id} />;
      case "guess": return <Guess id={sh.id} />;
      case "import": return <Import />;
      case "copytext": return <CopyText title={sh.title} text={sh.text} />;
      case "diag": return <Diagnose d={sh.data} />;
      case "chatlog": return <><Head title="Faction chat" icon="mask" /><ChatLog /></>;
      case "signin": return <SignIn />;
      case "signup": return <SignUp />;
      case "recover": return <Recover />;
      case "recovery-code": return <RecoveryCode code={sh.code} fresh={sh.fresh} />;
      case "account": return <Account />;
      case "confirm-delete-game": return <DeleteGame id={sh.id} name={sh.name} />;
      default: return null;
    }
  })();
  const blocking = sh.type === "recovery-code"; // the code must be acknowledged, not dismissed by a stray tap
  return (
    <div className="scrim" onClick={blocking ? undefined : act.closeSheet}>
      <div className="sheet" role="dialog" aria-modal="true" ref={ref} onClick={e => e.stopPropagation()}>
        <div className="grab" aria-hidden="true" />
        {body}
      </div>
    </div>
  );
}
