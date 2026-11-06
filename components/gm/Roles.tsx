"use client";
import { useState } from "react";
import E from "@/lib/engine/engine";
import { A, emit, teamName, toast } from "@/lib/client/store";
import * as act from "@/lib/client/actions";
import { Icon, ROLE_ICONS } from "@/components/ui/Icon";

const FILTERS = [["all", "All"], ["town", "Town"], ["mafia", "Mafia"], ["neutral", "Neutral"], ["killing", "Killing"], ["protective", "Protective"], ["investigative", "Investigative"], ["support", "Support"], ["roleblock", "Roleblock"], ["information", "Information"], ["chaos", "Chaos"], ["custom", "Custom"]];
const DEF_NAMES = ["None", "Basic", "Powerful", "Invincible"];

export function RolesView() {
  const s = A.s; const f = A.ui.libFilter; const q = A.ui.libQuery.trim().toLowerCase();
  const roles = E.allRoles(s).filter(r => {
    if (q && !(r.name + " " + r.short + " " + r.desc).toLowerCase().includes(q)) return false;
    if (f === "all") return true; if (f === "town" || f === "mafia") return r.team === f; if (f === "neutral") return !["town", "mafia"].includes(r.team);
    if (f === "custom") return !!r.custom; return (r.tags || []).includes(f);
  });
  return (
    <>
      <div className="spread" style={{ alignItems: "flex-end" }}><h1 className="display">Roles</h1><button className="btn sm primary" onClick={() => act.openSheet("custom")}><Icon name="plus" size="sm" />Create</button></div>
      <p className="lead" style={{ marginTop: 10 }}>{E.allRoles(s).length} roles. Turn one off to keep it out of suggestions.</p>
      <input className="input" type="search" placeholder="Search by name or ability" value={A.ui.libQuery} onChange={e => { A.ui.libQuery = e.target.value; emit(); }} style={{ marginTop: 16 }} aria-label="Search roles" />
      <div className="seg" style={{ marginTop: 10 }} role="group" aria-label="Filter">{FILTERS.map(([k, l]) => <button key={k} onClick={() => { A.ui.libFilter = k; emit(); }} aria-pressed={f === k}>{l}</button>)}</div>
      <div className="list" style={{ marginTop: 10 }}>
        {roles.length ? roles.map(r => (
          <button key={r.id} className="li" onClick={() => act.openSheet("role", { id: r.id })} style={{ border: 0, background: "none", color: "inherit", textAlign: "left", width: "100%", opacity: A.prefs.disabled.includes(r.id) ? 0.5 : 1 }}>
            <Icon name={r.icon} size="lg" />
            <span className="grow"><b style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{r.name}<span className={`team ${r.team}`}>{teamName(r.team)}</span>{r.custom && <span className="chip" style={{ height: 22 }}>Custom</span>}{A.prefs.disabled.includes(r.id) && <span className="chip muted" style={{ height: 22 }}>Off</span>}</b><span>{r.short}</span></span>
          </button>
        )) : <p className="small muted" style={{ padding: "14px 0" }}>No roles match.</p>}
      </div>
    </>
  );
}

export function RoleSheet({ id }: { id: string }) {
  const s = A.s; const r = E.getRole(s, id); if (!r) return null;
  const sus = r.custom && typeof r.sus === "boolean" ? r.sus : id === "godfather" ? !s.config.godfatherInnocent : r.team === "solo" || r.team === "vampire" ? s.config.nkSuspicious : r.team === "mafia";
  const off = A.prefs.disabled.includes(id);
  const inUse = s.players.some(p => p.roleId === id) || (s.setup.pool[id] || 0) > 0;
  return (
    <>
      <header><Icon name={r.icon} size="lg" /><h2>{r.name}</h2><button className="iconbtn" onClick={act.closeSheet} aria-label="Close"><Icon name="x" /></button></header>
      <div className="row"><span className={`team ${r.team}`}>{teamName(r.team)}</span>{(r.tags || []).map(t => <span key={t} className="chip">{t}</span>)}<span className="chip muted">Difficulty {r.diff}/3</span></div>
      <p style={{ marginTop: 14 }}>{r.desc}</p>
      {(r.abilities || []).length > 0 && <><h3 className="label" style={{ marginTop: 18 }}>Abilities</h3><ul className="small" style={{ paddingLeft: 18, margin: "6px 0 0" }}>{r.abilities.map((a, i) => <li key={i}>{E.describeAbility(s, { uses: {} }, a)}{typeof a.uses === "number" ? ` · ${a.uses} uses` : a.uses === "guessShots" ? ` · ${s.config.guessShots} shots` : ""}{a.viaFaction ? " · used through the Mafia kill" : ""}</li>)}</ul></>}
      <h3 className="label" style={{ marginTop: 18 }}>Wins when</h3><p className="small" style={{ marginTop: 4 }}>{r.winText}</p>
      <h3 className="label" style={{ marginTop: 18 }}>Under investigation</h3>
      <div className="small muted stack" style={{ marginTop: 6, gap: 4 }}>
        <span>Police: {sus ? "thumbs up" : "thumbs down"}{id === "werewolf" && sus ? " (only on full moons)" : ""}</span>
        <span>Investigator clue group “{E.CLUE_NAMES[r.clue] || r.clue}”: {E.rolesInClue(s, r.clue).join(", ")} (only roles in the game are ever shown)</span>
        <span>Gunsmith: {r.gun ? "carries a weapon" : "unarmed"}</span>
        <span>Mafia Investigator: {r.appearsTown ? "Town" : teamName(r.team)}</span>
        <span>Night defense: {DEF_NAMES[r.def || 0]}{r.rbImmune ? " · cannot be roleblocked" : ""}{r.ctrlImmune ? " · cannot be controlled" : ""}{r.trImmune ? " · cannot be transported" : ""}</span>
      </div>
      <div className="toggle" style={{ marginTop: 10 }}><div className="grow"><b id="rt-l">Use in suggestions</b><span>Off keeps this role out of suggested setups. You can still add it by hand.</span></div><button className="switch" role="switch" aria-checked={!off} aria-labelledby="rt-l" onClick={() => act.roleToggle(id)} /></div>
      <div className="row" style={{ marginTop: 12 }}>
        {s.phase === "setup" && <button className="btn sm" onClick={() => act.poolInc(id)}><Icon name="plus" size="sm" />Add to role list ({s.setup.pool[id] || 0})</button>}
        {r.custom && <button className="btn sm danger" onClick={() => act.deleteCustomRole(id)} disabled={inUse} title={inUse ? "In use in this game" : undefined}><Icon name="trash" size="sm" />Delete</button>}
      </div>
    </>
  );
}

export function CustomRoleSheet() {
  const [f, setF] = useState({ name: "", icon: "star", team: "town", kind: "heal", uses: "0", attack: "1", def: "0", rb: "0", sus: "auto", clue: "common", nights: "all", desc: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(Object.assign({}, f, { [k]: e.target.value }));
  const sel = (k: keyof typeof f, label: string, opts: [string | number, string][]) => <label className="field"><span>{label}</span><select value={f[k]} onChange={set(k)}>{opts.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}</select></label>;
  const kinds: [string, string][] = [["none", "No night ability"], ...E.CUSTOM_KINDS.map(k => [k, E.KINDS[k].verb + (E.KINDS[k].info ? " (information)" : "")] as [string, string])];
  const save = () => {
    const name = f.name.trim(); if (!name) { toast("Give the role a name."); return; }
    const def: Record<string, unknown> = { name, icon: f.icon, team: f.team, kind: f.kind, uses: +f.uses, attack: +f.attack, def: +f.def, rbImmune: f.rb === "1", clue: f.clue, nights: f.nights,
      desc: f.desc.trim() || `A custom ${teamName(f.team)} role.`, win: f.team === "neutral" ? "survivor" : f.team, winText: f.team === "neutral" ? "Be alive when the game ends." : undefined };
    if (f.sus !== "auto") def.sus = f.sus === "1";
    act.createCustomRole(def);
  };
  return (
    <>
      <header><Icon name="star" size="lg" /><h2>Create a role</h2><button className="iconbtn" onClick={act.closeSheet} aria-label="Close"><Icon name="x" /></button></header>
      <p className="small muted">Custom roles plug into the same rules engine: priority, roleblocks, protection and win conditions all apply.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 14 }}>
        <label className="field"><span>Name</span><input value={f.name} onChange={set("name")} maxLength={28} placeholder="e.g. Nurse" /></label>
        {sel("icon", "Icon", ROLE_ICONS.map(k => [k, k]))}
        {sel("team", "Team", [["town", "Town"], ["mafia", "Mafia"], ["solo", "Solo killer"], ["neutral", "Neutral (survive to win)"]])}
        {sel("kind", "Night ability", kinds)}
        {sel("uses", "Uses per game", [[0, "Unlimited"], [1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"]])}
        {sel("attack", "Attack (if it kills)", [[1, "Basic"], [2, "Powerful"], [3, "Unstoppable"]])}
        {sel("def", "Night defense", [[0, "None"], [1, "Basic"], [2, "Powerful"], [3, "Invincible"]])}
        {sel("rb", "Roleblock", [[0, "Can be roleblocked"], [1, "Immune"]])}
        {sel("sus", "Police answer", [["auto", "By team — thumbs up only if Mafia"], [1, "Always thumbs up"], [0, "Always thumbs down"]])}
        {sel("clue", "Investigator clue group", Object.entries(E.CLUE_NAMES))}
        {sel("nights", "Nights", [["all", "Every night"], ["notFirst", "From Night 2"], ["even", "Even nights only"]])}
      </div>
      <label className="field" style={{ marginTop: 12 }}><span>Description (shown on their role card)</span><textarea value={f.desc} onChange={set("desc")} maxLength={300} placeholder="What the role does, in a sentence or two." /></label>
      <div className="row" style={{ marginTop: 16 }}><button className="btn primary" onClick={save}><Icon name="check" />Create role</button><button className="btn ghost" onClick={act.closeSheet}>Cancel</button></div>
    </>
  );
}
