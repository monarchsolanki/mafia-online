"use client";
import { useState } from "react";
import E from "@/lib/engine/engine";
import { A, taste, emit, effN, roleCount, role, plural, teamName } from "@/lib/client/store";
import * as act from "@/lib/client/actions";
import { Online } from "@/lib/client/online";
import { Cloud } from "@/lib/client/cloud";
import { Icon } from "@/components/ui/Icon";
import { Dock as DockBar } from "@/components/ui/Dock";
import { ConfigPanel } from "./Settings";
import { OnlinePanel } from "./OnlinePanel";

const STEPS = ["Players", "Roles", "Rules", "Deal", "Reveal"];
const STYLE_HINT: Record<string, string> = {
  basic: "The classic game: Mafia, Doctor, Police and Villagers, with the counts tuned for your table. Add roles yourself, or try a twist below.",
  beginner: "Only Villagers, Doctor, Police, Bodyguard, Mafia and Jester — ideal for a first game.",
  classic: "The familiar Town investigators against a Godfather and plain Mafia members.",
  balanced: "A mix tuned to sit inside the fair balance band, with a solo killer from 11 players.",
  chaos: "Converters, Witch, Pirate, Cupid and the Drunk. Expect surprises; balance is looser.",
  advanced: "The whole library: Transporter, Poisoner, Hunter, guessers and more.",
  large: "Advanced roles with more Villagers, suited to 15–30 players.",
};

function Progress() {
  const st = A.ui.setupStep;
  return (
    <nav aria-label="Setup steps" style={{ margin: "4px 0 26px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
        {STEPS.map((l, i) => {
          const b = act.setupBlocked(i);
          return (
            <button key={l} onClick={() => act.setStep(i)} disabled={!!b && i > st} aria-current={st === i ? "step" : undefined} title={b && i > st ? b : undefined}
              style={{ border: 0, background: "none", padding: "6px 0", textAlign: "left", color: st === i ? "var(--ink)" : "var(--ink-2)", cursor: b && i > st ? "not-allowed" : undefined }}>
              <span style={{ display: "block", height: 4, borderRadius: 4, background: i <= st ? "var(--ink)" : "color-mix(in oklab, var(--ink) 16%, transparent)", transition: "background-color .4s" }} />
              <span className="tiny" style={{ display: "block", marginTop: 7, fontWeight: st === i ? 700 : 560 }}>{l}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function Dock({ left, children }: { left?: React.ReactNode; children: React.ReactNode }) {
  const st = A.ui.setupStep;
  return (
    <DockBar>
      <div>
        {left && <p className="small muted" style={{ textAlign: "center", marginBottom: 8 }}>{left}</p>}
        <div className="row nowrap">
          <button className="btn back-sm" onClick={() => (st === 0 ? act.goHome() : act.setStep(st - 1))} aria-label={st === 0 ? "Home" : "Back"}><Icon name="back" size="sm" /><span className="hide-sm">{st === 0 ? "Home" : "Back"}</span></button>
          {children}
        </div>
      </div>
    </DockBar>
  );
}

export function RoleChips({ pool }: { pool: Record<string, number> }) {
  const ids = Object.keys(pool).filter(k => pool[k] > 0);
  return (
    <div className="row" style={{ gap: 6 }}>
      {ids.map(id => { const r = role(id); return r ? <span key={id} className="chip"><span className={`team ${r.team}`} style={{ fontSize: "inherit", color: "inherit", gap: 5 }}>{pool[id] > 1 ? `${pool[id]}× ` : ""}{r.name}</span></span> : null; })}
    </div>
  );
}

export function Balance({ pool }: { pool: Record<string, number> }) {
  const b = E.balanceOf(A.s, pool); const n = b.n || 1;
  const bar = (w: number, c: string) => <i style={{ display: "block", width: `${(w / n) * 100}%`, background: c, height: "100%" }} />;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", height: 8, borderRadius: 8, overflow: "hidden", gap: 2 }} role="img" aria-label={`Town ${b.counts.town}, Mafia ${b.counts.mafia}, Neutral ${b.counts.neutral}`}>
        {bar(b.counts.town, "var(--team-town)")}{bar(b.counts.mafia, "var(--team-mafia)")}{bar(b.counts.neutral, "var(--team-neutral)")}
      </div>
      <div className="spread small" style={{ marginTop: 8 }}>
        <span className="row" style={{ gap: 12 }}><span className="team town">Town {b.counts.town}</span><span className="team mafia">Mafia {b.counts.mafia}</span><span className="team neutral">Neutral {b.counts.neutral}</span></span>
        <b style={{ color: b.fair ? "var(--ink)" : "var(--accent)" }}>{b.label}</b>
      </div>
    </div>
  );
}

function Recommend() {
  const s = A.s; const n = s.phase === "setup" && A.ui.setupStep === 0 ? effN() : Math.max(5, s.players.length);
  const st = s.setup.style; const rec = E.recommend(n, st, s.setup.seed, s, taste.history());
  const k = (o: Record<string, number>) => JSON.stringify(Object.keys(o).filter(x => o[x] > 0).sort().map(x => [x, o[x]]));
  const inUse = k(rec.pool) === k(s.setup.pool);
  return (
    <div className="well">
      <div className="spread"><h2 className="subtitle">Suggested for {n} players</h2>{inUse && <span className="chip solid"><Icon name="check" size="sm" />In use</span>}</div>
      <div className="seg" role="group" aria-label="Setup style" style={{ margin: "14px 0" }}>
        {Object.keys(E.STYLE_NAMES).map(sk => <button key={sk} onClick={() => act.recStyle(sk)} aria-pressed={st === sk}>{E.STYLE_NAMES[sk]}</button>)}
      </div>
      <RoleChips pool={rec.pool} />
      <Balance pool={rec.pool} />
      <p className={st === "foryou" ? "small" : "tiny muted"} style={{ marginTop: 12 }}>{st === "foryou" ? rec.note : STYLE_HINT[st]}</p>
      {st === "basic" && rec.tuned && <p className="note" style={{ marginTop: 10 }}><Icon name="spiral" size="sm" /><span>{rec.tuned}</span></p>}
      <div className="row" style={{ marginTop: 14 }}>
        {!inUse && <button className="btn sm primary" onClick={act.recUse}><Icon name="check" size="sm" />Use this</button>}
        {st !== "basic" && <button className="btn sm" onClick={act.recReroll}><Icon name="dice" size="sm" />Shuffle</button>}
      </div>
    </div>
  );
}

/** One small change per game, picked from roles the group hasn't played lately. Never forced. */
function Twist() {
  const s = A.s; if (!roleCount()) return null;
  const list = act.twists(); if (!list.length) return null;
  const t = list[(A.ui.twistIdx || 0) % list.length];
  return (
    <div className="well">
      <div className="spread"><h2 className="subtitle">Tonight’s twist</h2><span className="small muted">Optional</span></div>
      <p className="title" style={{ marginTop: 10 }}>Swap one {t.removeName} for the {t.addName}</p>
      <p className="small" style={{ marginTop: 6 }}>{t.short}</p>
      <p className="small muted" style={{ marginTop: 4 }}>{t.why} Balance after the swap: {t.balance.label.toLowerCase()}.</p>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn sm primary" onClick={() => act.twistApply(t)}><Icon name="swap" size="sm" />Swap it in</button>
        {list.length > 1 && <button className="btn sm" onClick={act.twistNext}><Icon name="refresh" size="sm" />Another idea</button>}
      </div>
      {s.setup.style !== "basic" && <p className="tiny muted" style={{ marginTop: 10 }}>Changes exactly one role in your list, so nobody has a new rulebook to learn.</p>}
    </div>
  );
}

function StepPlayers() {
  const s = A.s; const named = s.players.length; const N = effN();
  const [name, setName] = useState(""); const [bulk, setBulk] = useState("");
  const add = () => { if (act.addPlayer(name)) setName(""); };
  return (
    <>
      <h1 className="display">How many players?</h1>
      <div className="row nowrap" style={{ justifyContent: "space-between", margin: "22px 0 8px" }}>
        <button className="iconbtn" style={{ width: 60, height: 60, background: "color-mix(in oklab, var(--ink) 9%, transparent)" }} onClick={() => act.targetStep(-1)} disabled={N <= Math.max(5, named)} aria-label="One fewer player"><Icon name="minus" size="lg" /></button>
        <div style={{ textAlign: "center" }}><div className="mega num" aria-live="polite" style={{ fontSize: "clamp(5rem, 30vw, 8.5rem)" }}>{N}</div><div className="small muted">players</div></div>
        <button className="iconbtn" style={{ width: 60, height: 60, background: "color-mix(in oklab, var(--ink) 9%, transparent)" }} onClick={() => act.targetStep(1)} disabled={N >= 40} aria-label="One more player"><Icon name="plus" size="lg" /></button>
      </div>
      <div className="row" style={{ justifyContent: "center", gap: 6 }}>
        {[6, 8, 10, 12, 15, 20, 25].map(q => <button key={q} className="btn xs" style={q === N ? { background: "var(--ink)", color: "var(--ground)" } : undefined} disabled={q < named} onClick={() => act.targetSet(q)} aria-pressed={q === N}>{q}</button>)}
      </div>

      <section className="section"><Recommend /></section>

      <section className="section">
        <div className="section-head"><h2 className="title">Names</h2><span className="small muted">{named} of {N} · optional</span></div>
        <form className="row nowrap" onSubmit={e => { e.preventDefault(); add(); }}>
          <label className="sr" htmlFor="pname">Player name</label>
          <input id="pname" className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Add a name" autoComplete="off" maxLength={24} enterKeyHint="done" />
          <button className="btn primary" type="submit" aria-label="Add player"><Icon name="plus" /></button>
        </form>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="linkbtn" onClick={() => { A.ui.bulk = !A.ui.bulk; emit(); }} aria-expanded={A.ui.bulk}>{A.ui.bulk ? "Hide the list box" : "Paste a list of names"}</button>
        </div>
        {A.ui.bulk && (
          <div className="stack" style={{ marginTop: 6 }}>
            <label className="field"><span>One name per line, or separated by commas</span><textarea value={bulk} onChange={e => setBulk(e.target.value)} placeholder="Monarch, Rahul, Priya, Arjun, Aman" /></label>
            <div><button className="btn sm" onClick={() => { if (act.bulkAdd(bulk)) setBulk(""); }}>Add all</button></div>
          </div>
        )}
        {named > 0 ? (
          <div className="list" style={{ marginTop: 10 }}>
            {s.players.map((p, i) => (
              <div className="li" key={p.id} style={{ minHeight: 52, padding: "6px 0" }}>
                <span className="dot" style={{ ["--c" as string]: p.color }} />
                <span className="grow"><b>{p.name}</b></span>
                <button className="iconbtn" onClick={() => act.openSheet("rename", { id: p.id })} aria-label={`Rename ${p.name}`}><Icon name="edit" size="sm" /></button>
                <button className="iconbtn" onClick={() => act.movePlayer(p.id, -1)} disabled={i === 0} aria-label={`Move ${p.name} up`}><Icon name="up" size="sm" /></button>
                <button className="iconbtn" onClick={() => act.removePlayer(p.id)} aria-label={`Remove ${p.name}`}><Icon name="x" size="sm" /></button>
              </div>
            ))}
          </div>
        ) : <p className="small muted" style={{ marginTop: 12 }}>Unnamed seats become Player 1, Player 2… and can be renamed any time.</p>}
      </section>

      <section className="section">
        <div className="section-head"><h2 className="title">Saved groups</h2>{named >= 2 && <button className="btn sm" onClick={act.saveGroup}><Icon name="save" size="sm" />Save these names</button>}</div>
        {A.groups.length ? (
          <div className="list">
            {A.groups.map((g, i) => (
              <div className="li" key={g.id || i}>
                <span className="grow"><b>{g.name}</b><span>{plural(g.players.length, "player")}</span></span>
                <button className="btn sm" onClick={() => act.loadGroup(i)}>Load</button>
                <button className="iconbtn" onClick={() => act.deleteGroup(i)} aria-label={`Delete group ${g.name}`}><Icon name="trash" size="sm" /></button>
              </div>
            ))}
          </div>
        ) : <p className="small muted">Save a group of names to reuse next time.{!Cloud.host && " Sign in to keep them on every device."}</p>}
      </section>

      {Online.avail && <section className="section"><OnlinePanel /></section>}

      <Dock><button className="btn primary grow" onClick={act.playersContinue}><span className="t">Continue with {N} players</span><Icon name="chev" size="sm" /></button></Dock>
    </>
  );
}

function StepRoles() {
  const s = A.s; const n = s.players.length; const R = roleCount(); const diff = R - n;
  const tab = A.ui.poolTab; const q = A.ui.poolQuery.trim().toLowerCase();
  const [preset, setPreset] = useState("");
  const inTab = (r: { team: string; custom?: boolean }) => tab === "town" ? r.team === "town" : tab === "mafia" ? r.team === "mafia" : tab === "custom" ? !!r.custom : r.team !== "town" && r.team !== "mafia";
  const roles = E.allRoles(s).filter(r => r.id !== "cultist" || s.setup.pool.cultist).filter(r => (q ? (r.name + " " + r.short).toLowerCase().includes(q) : inTab(r)));
  return (
    <>
      <h1 className="display">Choose the roles</h1>
      <p className="lead" style={{ marginTop: 10 }}>Start from the suggestion or build your own. Balance is advice only.</p>
      <section className="section"><Recommend /></section>
      <section className="section"><Twist /></section>

      <section className="section">
        <div className="section-head"><h2 className="title">Your role list</h2><span className="small num" style={{ color: diff === 0 ? "var(--ink)" : "var(--accent)", fontWeight: 650 }}>{R} of {n}{E.drunkCards(s.setup.pool) ? ` · +${E.drunkCards(s.setup.pool)} Drunk` : ""}</span></div>
        {R ? <><RoleChips pool={s.setup.pool} /><Balance pool={s.setup.pool} /></> : <p className="small muted">Empty — add roles below or use the suggestion.</p>}
        {E.setupWarnings(s).length > 0 && <div className="stack" style={{ marginTop: 14 }}>{E.setupWarnings(s).map((w, i) => <p key={i} className="note warn"><Icon name="alert" size="sm" /><span>{w}</span></p>)}</div>}
      </section>

      <section className="section">
        <div className="seg" role="group" aria-label="Team">
          {[["town", "Town"], ["mafia", "Mafia"], ["neutral", "Neutral"], ["custom", "Custom"]].map(([k, l]) => <button key={k} onClick={() => { A.ui.poolTab = k; A.ui.poolQuery = ""; emit(); }} aria-pressed={tab === k && !q}>{l}</button>)}
        </div>
        <input className="input" type="search" placeholder="Search all roles" value={A.ui.poolQuery} onChange={e => { A.ui.poolQuery = e.target.value; emit(); }} style={{ marginTop: 12 }} aria-label="Search roles" />
        <div className="list" style={{ marginTop: 6 }}>
          {roles.length ? roles.map(r => { const c = s.setup.pool[r.id] || 0; return (
            <div className="li" key={r.id} style={{ alignItems: "center" }}>
              <button className="grow" onClick={() => act.openSheet("role", { id: r.id })} style={{ border: 0, background: "none", textAlign: "left", padding: 0, color: "inherit" }}>
                <b style={{ display: "flex", alignItems: "center", gap: 8 }}><Icon name={r.icon} size="sm" />{r.name}{A.prefs.disabled.includes(r.id) && <span className="chip muted" style={{ height: 22 }}>Off</span>}</b>
                <span>{r.short}</span>
              </button>
              <div className="stepper">
                <button className="iconbtn" onClick={() => act.poolDec(r.id)} disabled={!c} aria-label={`One fewer ${r.name}`}><Icon name="minus" size="sm" /></button>
                <b aria-label={`${c} ${r.name}`} style={{ color: c ? "var(--ink)" : "var(--ink-2)" }}>{c}</b>
                <button className="iconbtn" onClick={() => act.poolInc(r.id)} aria-label={`One more ${r.name}`}><Icon name="plus" size="sm" /></button>
              </div>
            </div>); }) : <p className="small muted" style={{ padding: "14px 0" }}>{tab === "custom" && !q ? "No custom roles yet. Create one in the Roles tab." : "No roles match."}</p>}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="title">Saved setups</h2></div>
        <form className="row nowrap" onSubmit={e => { e.preventDefault(); act.savePreset(preset); setPreset(""); }}>
          <input className="input" value={preset} onChange={e => setPreset(e.target.value)} placeholder="Name this setup" maxLength={40} aria-label="Setup name" />
          <button className="btn" type="submit" disabled={!R}><Icon name="save" size="sm" />Save</button>
        </form>
        {A.presets.length ? (
          <div className="list" style={{ marginTop: 8 }}>
            {A.presets.map((p, i) => (
              <div className="li" key={p.id || i}>
                <span className="grow"><b>{p.name}</b><span>{plural(p.n, "player")} · {E.STYLE_NAMES[p.style] || "Custom"}</span></span>
                <button className="btn sm" onClick={() => act.loadPreset(i)}>Load</button>
                <button className="iconbtn" onClick={() => act.openSheet("share-setup", { i })} aria-label={`Share setup ${p.name}`}><Icon name="share" size="sm" /></button>
                <button className="iconbtn" onClick={() => act.deletePreset(i)} aria-label={`Delete setup ${p.name}`}><Icon name="trash" size="sm" /></button>
              </div>
            ))}
          </div>
        ) : <p className="small muted" style={{ marginTop: 10 }}>Saved setups appear here{Cloud.host ? " and in your account" : ". Sign in to keep them on every device"}.</p>}
      </section>

      <Dock left={diff === 0 ? `${R} roles for ${plural(n, "player")}` : diff > 0 ? `${R} roles for ${n} players — remove ${diff}` : `${R} roles for ${n} players — add ${-diff}`}>
        {diff < 0 && <button className="btn" onClick={act.poolFill}>Fill with Villagers</button>}
        {diff > 0 && <button className="btn" onClick={act.poolTrim}>Trim Villagers</button>}
        <button className="btn primary grow" onClick={() => act.setStep(2)} disabled={!!act.setupBlocked(2)}><span className="t">Rules</span><Icon name="chev" size="sm" /></button>
      </Dock>
    </>
  );
}

function StepRules() {
  return (
    <>
      <h1 className="display">House rules</h1>
      <p className="lead" style={{ marginTop: 10 }}>Sensible defaults are set. Change anything your group plays differently — most can change mid-game too.</p>
      <div className="row" style={{ marginTop: 14 }}><button className="btn sm" onClick={act.cfgReset}><Icon name="refresh" size="sm" />Restore defaults</button></div>
      <ConfigPanel />
      <Dock><button className="btn primary grow" onClick={() => act.setStep(3)} disabled={!!act.setupBlocked(3)}><span className="t">Deal the roles</span><Icon name="chev" size="sm" /></button></Dock>
    </>
  );
}

function StepDeal() {
  const s = A.s; const show = A.ui.showAssign; const pool = s.setup.pool; const ids = Object.keys(pool).filter(k => pool[k] > 0 && k !== "drunk");
  const drunks = s.players.filter(p => p.meta.drunk); const cards = E.drunkCards(pool);
  return (
    <>
      <h1 className="display">Deal the roles</h1>
      <p className="lead" style={{ marginTop: 10 }}>Deal at random, or hand-pick a role for someone — hand-picked roles stay put when you reshuffle. Keep this screen to yourself.</p>
      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn primary" onClick={act.deal}><Icon name="dice" />{s.setup.dealt ? "Reshuffle" : "Deal at random"}</button>
        {s.setup.dealt && <button className="btn" onClick={() => { A.ui.showAssign = !show; emit(); }} aria-pressed={show}><Icon name={show ? "eyeoff" : "eye"} />{show ? "Hide all" : "Show all"}</button>}
      </div>
      <div className="list" style={{ marginTop: 16 }}>
        {s.players.map(p => {
          const r = p.roleId ? role(p.roleId) : null; const vis = show || A.ui.peek[p.id];
          const extra: string[] = [];
          if (s.setup.dealt && vis) {
            if (p.roleId === "executioner" && p.meta.target) extra.push(`Target: ${E.pname(s, p.meta.target)}`);
            if (p.roleId === "guardian" && p.meta.target) extra.push(`Ward: ${E.pname(s, p.meta.target)}`);
            if (p.roleId === "drunk" && p.meta.fake) extra.push(`Believes they are the ${role(p.meta.fake).name}`);
            if (p.meta.drunk) extra.push("Drunk");
          }
          return (
            <div className="li" key={p.id}>
              <span className="dot" style={{ ["--c" as string]: p.color }} />
              <span className="grow">
                <b>{p.name}{p.lock && <Icon name="lock" size="sm" className="muted" />}</b>
                <span>{r ? (vis ? `${r.name} · ${teamName(p.team || r.team)}` : "Hidden") : "Not dealt"}{extra.length ? " · " + extra.join(" · ") : ""}</span>
              </span>
              {r && !show && <button className="iconbtn" onClick={() => { A.ui.peek[p.id] = !A.ui.peek[p.id]; emit(); }} aria-label={`${A.ui.peek[p.id] ? "Hide" : "Show"} ${p.name}'s role`}><Icon name={A.ui.peek[p.id] ? "eyeoff" : "eye"} size="sm" /></button>}
              <select className="input" aria-label={`Hand-pick a role for ${p.name}`} value={p.lock && p.roleId ? p.roleId : ""} onChange={e => act.manualRole(p.id, e.target.value)} style={{ width: 132, minHeight: 40, fontSize: 14, padding: "0 30px 0 12px" }}>
                <option value="">{p.lock ? "Unlock" : "Random"}</option>
                {ids.map(id => <option key={id} value={id}>{role(id).name}</option>)}
              </select>
            </div>
          );
        })}
      </div>
      {cards > 0 && s.setup.dealt && (
        <section className="section well">
          <h2 className="subtitle">The Drunk card</h2>
          <p className="small muted" style={{ marginTop: 4 }}>Dealt at random onto a Town power role. They keep their role and never learn they are drunk: 80% of nights their action fails and their information is wrong. Move it to anyone you like.</p>
          {Array.from({ length: Math.max(cards, drunks.length) }, (_, k) => drunks[k] || null).map((d, k) => (
            <label key={k} className="field" style={{ marginTop: 12 }}><span>{cards > 1 || drunks.length > 1 ? `Drunk ${k + 1}` : "Drunk"}</span>
              <select value={d ? d.id : ""} onChange={e => act.moveDrunk(d ? d.id : null, e.target.value)}>
                {!d && <option value="">Nobody yet</option>}
                {s.players.map(p => <option key={p.id} value={p.id} disabled={!!p.meta.drunk && (!d || p.id !== d.id)}>{p.name}{show || A.ui.peek[p.id] ? ` — ${p.roleId ? role(p.roleId).name : "no role"}` : ""}</option>)}
              </select>
            </label>
          ))}
        </section>
      )}
      <Dock left={s.setup.dealt ? "Dealt. Hide the roles before handing the phone over." : "Deal before revealing."}>
        <button className="btn primary grow" onClick={() => act.setStep(4)} disabled={!!act.setupBlocked(4)}><span className="t">Reveal</span><Icon name="chev" size="sm" /></button>
      </Dock>
    </>
  );
}

function StepReveal() {
  const s = A.s; const done = s.setup.revealed;
  const [one, setOne] = useState(s.players[0] ? s.players[0].id : "");
  const showOne = <div className="row nowrap" style={{ marginTop: 10 }}><select className="input" value={one} onChange={e => setOne(e.target.value)} aria-label="Player">{s.players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="btn" onClick={() => one && act.openReveal([one])}>Show</button></div>;
  if (Online.room) {
    const seats = Online.status.seats; const st = (id: string) => seats.find(x => x.id === id) || { claimed: false, seen: false };
    const seen = s.players.filter(p => st(p.id).seen).length; const notJoined = s.players.filter(p => !st(p.id).claimed);
    return (
      <>
        <h1 className="display">Roles are on their phones</h1>
        <p className="lead" style={{ marginTop: 10 }}>Each player holds the button on their own phone to see their role.</p>
        <div className="well" style={{ marginTop: 20 }}>
          <p className="title num">{seen} of {s.players.length} have looked</p>
          {notJoined.length ? <p className="note warn" style={{ marginTop: 10 }}><Icon name="alert" size="sm" /><span>Not joined yet: {notJoined.map(p => p.name).join(", ")}. Show them their role on this phone instead.</span></p> : <p className="small muted" style={{ marginTop: 6 }}>Everyone has joined.</p>}
        </div>
        <section className="section"><h2 className="subtitle">Show one player on this phone</h2><p className="small muted">For anyone without a phone, or whose phone died.</p>{showOne}</section>
        <section className="section"><OnlinePanel /></section>
        <Dock><button className="btn primary grow" onClick={act.startGame}><Icon name="moon" />Begin Night 1</button></Dock>
      </>
    );
  }
  return (
    <>
      <h1 className="display">{done ? "Everyone has seen their role" : "Pass the phone around"}</h1>
      <p className="lead" style={{ marginTop: 10 }}>In seat order, each player holds the button to see only their own role, then hides it before passing on.</p>
      <ol className="small muted" style={{ marginTop: 18, paddingLeft: 22, columns: 2 }}>{s.players.map(p => <li key={p.id}>{p.name}</li>)}</ol>
      <section className="section"><h2 className="subtitle">Show one player again</h2><p className="small muted">If someone missed their card or the phone went to the wrong person.</p>{showOne}</section>
      <Dock left={done ? undefined : <button className="linkbtn" onClick={act.startGame}>Skip — roles were shared another way</button>}>
        {done ? <><button className="btn" onClick={act.revealAll}>Reveal again</button><button className="btn primary grow" onClick={act.startGame}><Icon name="moon" />Begin Night 1</button></>
          : <button className="btn primary grow" onClick={act.revealAll}><Icon name="phone" />Start the reveal</button>}
      </Dock>
    </>
  );
}

export function Setup() {
  const st = A.ui.setupStep;
  return (
    <>
      <Progress />
      <div key={st} className="settle">{[<StepPlayers key={0} />, <StepRoles key={1} />, <StepRules key={2} />, <StepDeal key={3} />, <StepReveal key={4} />][st]}</div>
    </>
  );
}
