"use client";
import { Fragment, useState } from "react";
import E from "@/lib/engine/engine";
import type { Game } from "@/lib/engine/engine";
import { A, emit } from "@/lib/client/store";
import { Online } from "@/lib/client/online";
import { Cloud } from "@/lib/client/cloud";
import * as act from "@/lib/client/actions";
import { Icon } from "@/components/ui/Icon";
import { OnlinePanel } from "./OnlinePanel";

const rng = (a: number, b: number, f = (x: number) => String(x)) => Array.from({ length: b - a + 1 }, (_, i) => [a + i, f(a + i)] as [number, string]);
const hasMayor = (s: Game) => (s.setup.pool && s.setup.pool.mayor > 0) || s.players.some(p => p.roleId === "mayor") || (s.initialRoles || []).some(r => r.roleId === "mayor");
type Cfg = [key: string, kind: "bool" | "sel", label: string, desc?: string, opts?: [string | number, string][] | null, show?: (s: Game) => boolean];
const CFG: [string, Cfg[]][] = [
  ["Deaths and reveals", [
    ["revealOnDeath", "bool", "Reveal roles on death", "The Janitor can still hide a role."],
    ["showCause", "bool", "Announce the cause of death"],
    ["announceAmnesiac", "bool", "Announce when an Amnesiac takes a role"],
  ]],
  ["Protection", [
    ["selfHeal", "sel", "Doctor self-heal", "", [["never", "Never"], ["once", "Once per game"], ["always", "Every night"]]],
    ["healMode", "sel", "A heal absorbs", "Unstoppable attacks always get through.", [["all", "Every attack up to Powerful"], ["one", "One attack per heal"]]],
    ["doctorNotified", "bool", "Tell the Doctor when their patient was attacked"],
  ]],
  ["Investigations", [
    ["godfatherInnocent", "bool", "Godfather fools the Police", "Off: the Police get a thumbs up on the Godfather like any Mafia."],
    ["nkSuspicious", "bool", "Police also give a thumbs up to killers", "Serial Killer, Arsonist, Werewolf (full moons only) and Vampires. Off: only the Mafia."],
  ]],
  ["Killing", [
    ["mafiaBackup", "bool", "Backup Mafia carrier", "If the carrier is blocked or jailed, another member carries out the kill."],
    ["promote", "bool", "A Mafioso or Mafia member takes over when the Godfather dies"],
    ["vigNight1", "bool", "Vigilante may shoot on Night 1"],
    ["vigTown", "sel", "When the Vigilante kills a Town member", "", [["guilt", "They die of guilt next night"], ["lose", "They lose their bullets"], ["nothing", "Nothing happens"]]],
    ["convertCap", "sel", "Largest size of the Cult or Vampires", "", rng(2, 8)],
  ]],
  ["Neutral roles", [
    ["jesterHaunt", "bool", "An executed Jester haunts one of their voters"],
    ["exeFallback", "sel", "An Executioner whose target dies another way becomes", "", [["jester", "Jester"], ["survivor", "Survivor"]]],
    ["guessShots", "sel", "Guesser shots per game", "Applies to roles dealt after the change.", rng(1, 5)],
    ["guessWrong", "sel", "A wrong guess", "", [["die", "Kills the guesser"], ["lose", "Ends their guessing"], ["nothing", "Has no penalty"]]],
  ]],
  ["Voting", [
    ["voteThreshold", "sel", "An execution needs", "", [["plurality", "The most votes"], ["majority", "A majority of voters"]]],
    ["voteTie", "sel", "On a tie", "", [["none", "Nobody is executed"], ["random", "Pick one at random"], ["revote", "Revote among the tied"]]],
    ["allowSkip", "bool", "Allow a vote for no execution"],
    ["mayorWeight", "sel", "A revealed Mayor's vote counts", "Scaled: 3 votes while more than 7 players are alive, then 2.", [["auto", "Scaled (3, then 2)"], ...rng(1, 5, x => "Always " + x)], hasMayor],
    ["mayorOnce", "bool", "The Mayor's bonus vote works only once", "Only the first vote after the Mayor reveals counts extra. After that the Mayor votes as one.", null, hasMayor],
  ]],
  ["Winning", [
    ["parity", "bool", "A killing faction wins at parity", "When it matches everyone else alive, it controls the vote."],
    ["showdown", "bool", "Showdown for a living Jester or Executioner", "Play one more day after a faction secures the win, so they can still pull it off."],
  ]],
  ["Running the game", [
    ["bluffDead", "bool", "Call dead roles at night as a bluff", "The table cannot tell which roles are gone."],
    ["stalemateCycles", "sel", "Offer a draw after nights with no deaths", "For endless standoffs, such as a Godfather and a Serial Killer who cannot kill each other.", [[0, "Never"], [2, "2 nights"], [3, "3 nights"], [4, "4 nights"], [5, "5 nights"]]],
    ["dayTimer", "sel", "Day discussion timer", "", [[0, "Off"], [2, "2 min"], [3, "3 min"], [5, "5 min"], [8, "8 min"], [10, "10 min"], [15, "15 min"]]],
  ]],
];

export function ConfigPanel() {
  const c = A.s.config;
  return (
    <>
      {CFG.map(([group, all]) => [group, all.filter(it => !it[5] || it[5](A.s))] as [string, Cfg[]]).filter(([, items]) => items.length).map(([group, items]) => (
        <section className="section" key={group}>
          <h2 className="label" style={{ marginBottom: 2 }}>{group}</h2>
          <div className="list">
            {items.map(([k, t, label, desc, opts]) => t === "bool" ? (
              <div className="toggle" key={k}>
                <div className="grow"><b id={`cl-${k}`}>{label}</b>{desc && <span>{desc}</span>}</div>
                <button className="switch" role="switch" aria-checked={!!c[k]} aria-labelledby={`cl-${k}`} onClick={() => act.cfgToggle(k)} />
              </div>
            ) : (
              <div className="toggle" key={k} style={{ flexWrap: "wrap" }}>
                <div className="grow" style={{ minWidth: 180 }}><b><label htmlFor={`cf-${k}`}>{label}</label></b>{desc && <span>{desc}</span>}</div>
                <select id={`cf-${k}`} className="input" style={{ width: "auto", maxWidth: 240, minHeight: 44, fontSize: 15 }} value={String(c[k])} onChange={e => act.cfgSet(k, e.target.value)}>
                  {opts!.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
                </select>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export function SettingsView() {
  const s = A.s; const inGame = !["setup", "ended"].includes(s.phase);
  const [pin, setPin] = useState("");
  const w = s.phase === "setup" ? null : E.evaluateWin(s);
  const facs: Record<string, { alive: number; total: number }> = {};
  for (const p of s.players) { const k = E.factionKey(p); if (k === "neutral") continue; (facs[k] = facs[k] || { alive: 0, total: 0 }); facs[k].total++; if (p.alive) facs[k].alive++; }
  return (
    <>
      <h1 className="display">Rules</h1>
      <p className="lead" style={{ marginTop: 10 }}>Rule changes apply from the next action.</p>
      <div className="row" style={{ marginTop: 14 }}><button className="btn sm" onClick={act.cfgReset}><Icon name="refresh" size="sm" />Restore defaults</button></div>
      <ConfigPanel />

      {Online.avail && <section className="section"><h2 className="title" style={{ marginBottom: 12 }}>Players’ phones</h2><OnlinePanel /></section>}

      <section className="section">
        <h2 className="title" style={{ marginBottom: 6 }}>This device</h2>
        <div className="list">
          <div className="toggle"><div className="grow"><b id="snd-l">Sound</b><span>Night drone, phase chimes, the heartbeat and the kill. Made on the device.</span></div><button className="switch" role="switch" aria-checked={A.prefs.sound} aria-labelledby="snd-l" onClick={act.toggleSound} /></div>
          <div className="toggle" style={{ flexWrap: "wrap" }}>
            <div className="grow" style={{ minWidth: 200 }}><b>Game Master PIN</b><span>Needed to leave a player’s private screen. {s.config.godPin ? "A PIN is set." : "No PIN set."}</span></div>
            <form className="row nowrap" onSubmit={e => { e.preventDefault(); if (act.pinSet(pin)) setPin(""); }}>
              <input className="input" style={{ width: 110 }} type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value)} placeholder="4 digits" aria-label="PIN" />
              <button className="btn sm" type="submit">Set</button>
              {s.config.godPin && <button className="btn sm ghost" type="button" onClick={act.pinClear}>Remove</button>}
            </form>
          </div>
          <div className="toggle" style={{ flexWrap: "wrap" }}>
            <div className="grow" style={{ minWidth: 200 }}><b>Save file</b><span>{Cloud.host ? "Games already save to your account. A file is a backup you can carry." : "Move a game to another device, or keep a backup."}</span></div>
            <div className="row"><button className="btn sm" onClick={act.exportSave}><Icon name="download" size="sm" />Save file</button><button className="btn sm" onClick={() => act.openSheet("import")}>Import</button></div>
          </div>
          <div className="toggle"><div className="grow"><b>Engine state</b><span>For checking a ruling mid-game.</span></div><button className="btn sm" onClick={() => { A.ui.debug = !A.ui.debug; emit(); }} aria-expanded={A.ui.debug}><Icon name="bug" size="sm" />{A.ui.debug ? "Hide" : "Show"}</button></div>
        </div>
      </section>

      {A.ui.debug && (
        <section className="section well tight small">
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", margin: 0 }}>
            <dt className="muted">Phase</dt><dd style={{ margin: 0 }}>{s.phase} · night {s.night} · day {s.day}</dd>
            <dt className="muted">Alive</dt><dd style={{ margin: 0 }}>{s.players.filter(p => p.alive).length} of {s.players.length}</dd>
            <dt className="muted">Actions tonight</dt><dd style={{ margin: 0 }}>{s.actions.length}</dd>
            <dt className="muted">Scheduled</dt><dd style={{ margin: 0 }}>{s.scheduled.map(x => `${x.type} on ${E.pname(s, x.target)} (N${x.night})`).join(", ") || "None"}</dd>
            <dt className="muted">Prompts</dt><dd style={{ margin: 0 }}>{s.pending.map(q => `${q.type} · ${E.pname(s, q.actor)}`).join(", ") || "None"}</dd>
            <dt className="muted">Showdown</dt><dd style={{ margin: 0 }}>{s.showdown ? "until end of Day " + s.showdown.endsAfterDay : "No"}</dd>
            <dt className="muted">Win check</dt><dd style={{ margin: 0 }}>{w ? w.status + (w.faction ? " · " + E.factionName(s, w.faction) : "") : "—"}</dd>
            {Object.entries(facs).map(([k, v]) => <Fragment key={k}><dt className="muted">{E.factionName(s, k)}</dt><dd style={{ margin: 0 }}>{v.alive} alive of {v.total}{w && w.faction === k ? " · has secured the win" : v.alive ? "" : " · eliminated"}</dd></Fragment>)}
            <dt className="muted">Undo history</dt><dd style={{ margin: 0 }}>{A.hist.length} steps</dd>
          </dl>
        </section>
      )}

      <section className="section">
        <h2 className="title" style={{ marginBottom: 12 }}>Start over</h2>
        <div className="row">{inGame && <button className="btn danger" onClick={act.endGameNow}><Icon name="flag" />End the game now</button>}<button className="btn" onClick={act.newGame}><Icon name="plus" />New game</button></div>
      </section>
    </>
  );
}
