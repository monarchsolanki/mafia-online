"use client";
import E from "@/lib/engine/engine";
import type { Player } from "@/lib/engine/engine";
import { A, role, emit } from "@/lib/client/store";
import * as act from "@/lib/client/actions";
import { Icon } from "@/components/ui/Icon";

export function fxChips(p: Player): { t: string; tone?: "blood" | "solid" | "muted" }[] {
  const s = A.s; const c: { t: string; tone?: "blood" | "solid" | "muted" }[] = [];
  if (!p.alive) { const d = s.deaths.slice().reverse().find(x => x.id === p.id); c.push({ t: `Dead${d ? " · " + d.ph : ""}`, tone: "muted" }); }
  if (p.fx.revealed) c.push({ t: "Revealed" });
  if (p.fx.doused) c.push({ t: "Doused", tone: "blood" });
  if (p.fx.poison) c.push({ t: "Poisoned", tone: "blood" });
  if (p.fx.lover) c.push({ t: `♥ ${E.pname(s, p.fx.lover)}` });
  if (s.phase === "day" && p.fx.blackmailed === s.day) c.push({ t: "Can’t speak", tone: "blood" });
  if (s.phase === "day" && p.fx.silenced === s.day) c.push({ t: "Can’t vote", tone: "blood" });
  if (p.fx.revived !== undefined && p.alive) c.push({ t: "Revived" });
  if (s.phase === "night") { const a = s.actions.find(x => x.actor === p.id && x.key === p.id); if (a && a.targets.length) c.push({ t: `→ ${a.targets.map(t => E.pname(s, t)).join(" & ")}`, tone: "solid" }); }
  const r = role(p.roleId);
  if (r && p.alive) for (const ab of r.abilities || []) { const u = p.uses[ab.id]; if (typeof u === "number") c.push({ t: `${u} ${E.KINDS[ab.kind].verb.toLowerCase()}`, tone: u ? undefined : "muted" }); }
  return c;
}

export function PlayerTile({ p }: { p: Player }) {
  const r = p.roleId ? role(p.roleId) : null;
  const rl = r ? (p.roleId === "drunk" && p.meta.fake ? `Drunk (as ${role(p.meta.fake).name})` : r.name) : "Not dealt";
  const chips = fxChips(p).filter(c => !c.t.startsWith("Dead"));
  return (
    <button className={`tile ${p.alive ? "" : "dead"}`} onClick={() => act.openSheet("player", { id: p.id })} aria-label={`${p.name}, ${r ? r.name : "no role"}, ${p.alive ? "alive" : "dead"}`}>
      <span className="nm">{p.name}</span>
      <span className="rl"><span className={`team ${p.team || ""}`} style={{ fontSize: "inherit" }}>{rl}</span></span>
      {chips.length > 0 && <span className="fx">{chips.map((c, i) => <span key={i} className={`chip ${c.tone || ""}`}>{c.t}</span>)}</span>}
    </button>
  );
}

export function StatsStrip() {
  const s = A.s; const al = s.players.filter(p => p.alive);
  const side = (t: string) => al.filter(p => (E.TEAM_INFO[p.team || "neutral"] || { side: "neutral" }).side === t).length;
  return (
    <div className="stats" role="list">
      <div className="stat" role="listitem"><b>{al.length}</b><span>Alive</span></div>
      <div className="stat" role="listitem"><b>{s.players.length - al.length}</b><span>Dead</span></div>
      <div className="stat" role="listitem"><b>{side("town")}</b><span className="team town">Town</span></div>
      <div className="stat" role="listitem"><b>{side("mafia")}</b><span className="team mafia">Mafia</span></div>
      <div className="stat" role="listitem"><b>{side("neutral")}</b><span className="team neutral">Neutral</span></div>
    </div>
  );
}

export function PlayersView() {
  const s = A.s; const f = A.ui.pfilter;
  const list = s.players.filter(p => f === "all" || (f === "alive" ? p.alive : !p.alive));
  return (
    <>
      <h1 className="display">Players</h1>
      <p className="lead" style={{ marginTop: 10 }}>Your eyes only. Tap a player for their abilities, night history and overrides.</p>
      <div className="seg" role="group" aria-label="Filter" style={{ marginTop: 18 }}>
        {([["all", "Everyone"], ["alive", "Alive"], ["dead", "Dead"]] as const).map(([k, l]) => <button key={k} onClick={() => { A.ui.pfilter = k; emit(); }} aria-pressed={f === k}>{l}</button>)}
      </div>
      {s.phase !== "setup" && <div style={{ marginTop: 16 }}><StatsStrip /></div>}
      <div className="tiles" style={{ marginTop: 16 }}>{list.length ? list.map(p => <PlayerTile key={p.id} p={p} />) : <p className="small muted">No players here.</p>}</div>
    </>
  );
}

export function TimelineView() {
  const s = A.s; const pub = A.ui.tlMode === "public";
  const evs = s.events.filter(e => !pub || !e.secret);
  const groups: { ph: string; evs: typeof evs }[] = [];
  for (const e of evs) { if (!groups.length || groups[groups.length - 1].ph !== e.ph) groups.push({ ph: e.ph, evs: [] }); groups[groups.length - 1].evs.push(e); }
  const phName = (ph: string) => (ph === "Setup" ? "Setup" : (ph[0] === "N" ? "Night " : "Day ") + ph.slice(1));
  const hm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  return (
    <>
      <h1 className="display">Log</h1>
      <p className="lead" style={{ marginTop: 10 }}>Every action, death and vote. Secret lines carry a closed eye — switch to Public before showing anyone.</p>
      <div className="spread" style={{ marginTop: 18, flexWrap: "wrap" }}>
        <div className="seg" role="group" aria-label="Show">
          {([["all", "Everything"], ["public", "Public"]] as const).map(([k, l]) => <button key={k} onClick={() => { A.ui.tlMode = k; emit(); }} aria-pressed={A.ui.tlMode === k}>{l}</button>)}
        </div>
        <button className="btn sm" onClick={act.exportLog}><Icon name="download" size="sm" />Export</button>
      </div>
      {groups.length ? groups.map((g, gi) => (
        <section key={gi} className="section" style={{ marginTop: 26 }}>
          <h2 className="label">{phName(g.ph)}</h2>
          <ol style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
            {g.evs.map((e, i) => (
              <li key={i} style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 10, padding: "7px 0", fontSize: "0.9375rem", color: e.type === "death" || e.type === "win" ? "var(--ink)" : e.secret ? "var(--ink-2)" : "var(--ink)", fontWeight: e.type === "death" || e.type === "win" ? 640 : 420 }}>
                <time className="tiny muted num" style={{ paddingTop: 2 }}>{hm(e.t)}</time>
                <span>{e.secret && !pub && <Icon name="eyeoff" size="sm" className="muted" />} {e.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )) : <p className="small muted" style={{ marginTop: 24 }}>Nothing has happened yet.</p>}
    </>
  );
}
