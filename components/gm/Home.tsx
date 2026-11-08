"use client";
import { useEffect, useState } from "react";
import E from "@/lib/engine/engine";
import { A, LS, plural } from "@/lib/client/store";
import { Cloud } from "@/lib/client/cloud";
import { playedHistory } from "@/lib/client/history";
import * as act from "@/lib/client/actions";
import { Icon } from "@/components/ui/Icon";

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); return d === 1 ? "yesterday" : `${d} days ago`;
}

/** Players join from here too: a room code takes them to their own phone screen. */
function JoinRoom() {
  const [code, setCode] = useState("");
  const [last, setLast] = useState<{ code: string; name?: string } | null>(null);
  useEffect(() => { const j = LS.get<{ code?: string; name?: string } | null>("omerta.player.v1", null); if (j && j.code) setLast({ code: j.code, name: j.name }); }, []);
  const clean = code.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
  const go = (c: string) => { location.href = "/play?room=" + encodeURIComponent(c); };
  return (
    <section className="section">
      <h2 className="title">Join a game</h2>
      <p className="small muted" style={{ marginTop: 4 }}>Playing, not hosting? Type the room code from the Game Master to get your role on this phone.</p>
      <form className="row nowrap" style={{ marginTop: 14 }} onSubmit={e => { e.preventDefault(); if (clean.length === 5) go(clean); }}>
        <input className="input code-input grow" value={clean} onChange={e => setCode(e.target.value)} placeholder="ROOM CODE" aria-label="Room code"
          autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} inputMode="text" maxLength={5} enterKeyHint="go" />
        <button className="btn primary" type="submit" disabled={clean.length !== 5}>Join<Icon name="chev" size="sm" /></button>
      </form>
      {last && <button className="btn ghost sm" style={{ marginTop: 10, paddingLeft: 0 }} onClick={() => go(last.code)}><Icon name="phone" size="sm" />Back to room {last.code}{last.name ? ` as ${last.name}` : ""}</button>}
    </section>
  );
}

export function Home() {
  const s = A.s; const inProgress = s.phase !== "setup" || s.players.length > 0;
  const where = s.phase === "setup" ? "setup" : s.phase === "ended" ? "the results" : s.phase === "day" ? `Day ${s.day}` : s.phase === "dawn" ? `Dawn ${s.night}` : `Night ${s.night}`;
  const games = Cloud.games();
  const played = playedHistory().filter(h => h.result).length;
  const cur = (s as { cloudId?: string }).cloudId;
  const saved = [A.presets.length && plural(A.presets.length, "setup"), A.groups.length && plural(A.groups.length, "group"), A.customLib.length && plural(A.customLib.length, "custom role")].filter(Boolean).join(" · ");
  return (
    <main className="page no-tabs">
      <header className="topbar" style={{ padding: "calc(var(--safe-t) + 10px) 0 6px", position: "static" }}>
        <span className="wordmark" style={{ flex: 1 }}>Omertà</span>
        {Cloud.host
          ? <button className="btn sm" onClick={() => act.openSheet("account")} aria-label={`Account: ${Cloud.host.displayName}`}><Icon name="user" size="sm" />{Cloud.host.displayName}</button>
          : Cloud.status === "out" ? <button className="btn sm ghost" onClick={() => act.openSheet("signin")}>Sign in</button> : null}
        <button className="iconbtn" onClick={() => act.openSheet("menu")} aria-label="Menu"><Icon name="menu" /></button>
      </header>

      <section style={{ marginTop: "8vh" }}>
        <h1 className="mega phase-title">Omertà.</h1>
        <p className="lead" style={{ marginTop: 18 }}>Run a whole game of Mafia from one phone. Secret roles, guided nights, rulings by the book — while you keep the table guessing.</p>
        <div className="stack" style={{ marginTop: 28 }}>
          {inProgress && s.phase === "ended" && <button className="btn block primary" onClick={act.rematch}><Icon name="dice" />Rematch, same players</button>}
          {inProgress && <button className={`btn block ${s.phase === "ended" ? "" : "primary"}`} onClick={act.resume}><Icon name="play" />Resume {where}</button>}
          <button className={`btn block ${inProgress ? "" : "primary"}`} onClick={act.newGame}><Icon name="plus" />New game</button>
        </div>
      </section>

      <JoinRoom />

      {Cloud.host && games.length > 0 && (
        <section className="section">
          <div className="section-head"><h2 className="title">Your games</h2><span className="small muted">{games.length}</span></div>
          <div className="list">
            {games.slice(0, 12).map(g => (
              <div className="li" key={g.id}>
                <button className="grow" onClick={() => g.id === cur ? act.resume() : Cloud.openGame(g.id)} style={{ border: 0, background: "none", textAlign: "left", padding: 0 }}>
                  <b>{g.meta.line || g.name}{g.id === cur ? <span className="chip solid" style={{ marginLeft: 8, height: 22 }}>Open now</span> : null}</b>
                  <span>{(g.meta.names || []).join(", ")}{g.meta.players > (g.meta.names || []).length ? ` +${g.meta.players - g.meta.names.length}` : ""} · {ago(g.updatedAt)}</span>
                </button>
                <button className="iconbtn" aria-label={`Delete ${g.name}`} onClick={() => act.openSheet("confirm-delete-game", { id: g.id, name: g.meta.line || g.name })}><Icon name="trash" size="sm" /></button>
              </div>
            ))}
          </div>
        </section>
      )}

      {Cloud.status === "out" && (
        <section className="section well">
          <h2 className="subtitle">Keep your setups on every device</h2>
          <p className="small muted" style={{ marginTop: 6 }}>Sign in and your saved setups, player groups, custom roles and games are kept in your account — close the browser or switch phones and they’re still here.</p>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn sm primary" onClick={() => act.openSheet("signup")}>Create an account</button>
            <button className="btn sm" onClick={() => act.openSheet("signin")}>Sign in</button>
          </div>
        </section>
      )}

      <section className="section">
        <div className="list">
          <button className="li" onClick={act.browseRoles} style={{ border: 0, background: "none", color: "inherit", textAlign: "left", width: "100%" }}>
            <Icon name="book" /><span className="grow"><b>Browse {E.allRoles(s).length} roles</b><span>Every role, its abilities and how it shows up under investigation</span></span><Icon name="chev" size="sm" />
          </button>
          {played > 0 && <button className="li" onClick={() => act.openSheet("stats")} style={{ border: 0, background: "none", color: "inherit", textAlign: "left", width: "100%" }}>
            <Icon name="users" /><span className="grow"><b>Your group</b><span>{played} finished game{played === 1 ? "" : "s"} · win rates, records and badges</span></span><Icon name="chev" size="sm" />
          </button>}
                    {saved && <div className="li"><Icon name="save" /><span className="grow"><b>Saved {Cloud.host ? "in your account" : "on this device"}</b><span>{saved}</span></span></div>}
        </div>
      </section>
    </main>
  );
}
