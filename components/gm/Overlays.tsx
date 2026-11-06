"use client";
import { useEffect, useState } from "react";
import E from "@/lib/engine/engine";
import { A, P, role } from "@/lib/client/store";
import * as act from "@/lib/client/actions";
import { Sound } from "@/lib/client/sound";
import { Icon } from "@/components/ui/Icon";
import { Hold } from "@/components/ui/Hold";
import { RoleCard } from "@/components/fx/RoleCard";
import { DeathScene } from "@/components/fx/DeathScene";

/* eslint-disable @typescript-eslint/no-explicit-any */
function AutoHide({ onHide }: { onHide: () => void }) {
  const [left, setLeft] = useState(20);
  useEffect(() => {
    const i = setInterval(() => setLeft(l => l - 1), 1000);
    const t = setTimeout(onHide, 20000);
    return () => { clearInterval(i); clearTimeout(t); };
  }, [onHide]);
  return <p className="countdown" aria-live="polite">Hides by itself in {left}s</p>;
}

function ReturnToGod({ ov }: { ov: any }) {
  const pin = A.s.config.godPin;
  return (
    <div className="stage" role="dialog" aria-modal="true" aria-label="Return the phone">
      <div className="stage-body">
        <Icon name="phone" size="xl" />
        <h1 className="display">{ov.skipped ? "Reveal closed." : ov.type === "reveal" && ov.queue.length > 1 ? "Everyone has seen their role." : "Card hidden."}</h1>
        <p className="lead">Hand the phone back to the Game Master.</p>
        {pin && <>
          <p className="label" style={{ marginTop: 18 }}>Game Master PIN</p>
          <p className="display num" style={{ letterSpacing: "0.4em", minHeight: 48 }} aria-live="polite">{"•".repeat(A.ui.pin.length)}</p>
          <div className="pinpad" style={{ marginTop: 6 }}>{["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((d, i) => d === "" ? <span key={i} /> : <button key={i} onClick={() => act.pinKey(d)} aria-label={d === "⌫" ? "Delete" : d}>{d}</button>)}</div>
        </>}
      </div>
      {!pin && <div className="stage-foot"><Hold label="Game Master: hold to continue" ms={1200} onDone={act.closeOverlay} /></div>}
    </div>
  );
}

function PrivateFlow({ ov }: { ov: any }) {
  const pid = ov.type === "reveal" ? ov.queue[ov.i] : ov.pid;
  if (ov.stage === "done") return <ReturnToGod ov={ov} />;
  const p = P(pid); if (!p) return null;
  if (ov.stage === "pass") {
    const remaining = ov.type === "reveal" ? ov.queue.length - ov.i : 1;
    return (
      <div className="stage" role="dialog" aria-modal="true" aria-label="Pass the phone">
        <div className="stage-body">
          <p className="kick">Pass the phone to</p>
          <h1 className="mega develop" key={pid}>{p.name}</h1>
          <p className="lead" style={{ marginTop: 6 }}>{ov.type === "reveal" ? "Only you should see the next screen. Shield it, then hold to see your role." : "You have private information from the night. Hold to read it."}</p>
          {ov.type === "reveal" && remaining > 1 && <p className="tiny muted">{remaining} players left to see their role</p>}
        </div>
        <div className="stage-foot">
          <Hold label={ov.type === "reveal" ? "Hold to see your role" : "Hold to read"} onDone={act.overlayShow} />
          <p className="tiny muted" style={{ textAlign: "center", marginTop: 14 }}>Game Master only</p>
          <button className="btn" onClick={act.overlaySkip}><Icon name="forward" size="sm" />{ov.type === "reveal" ? "Skip all reveals and close" : "Close"}</button>
        </div>
      </div>
    );
  }
  if (ov.type === "private") {
    return (
      <div className="stage" role="dialog" aria-modal="true" aria-label="Private result">
        <div className="stage-body">
          <p className="kick">{p.name}{ov.title ? " · " + ov.title : ""}</p>
          <h2 className="display develop">Your night.</h2>
          {ov.messages.length ? <div className="stack" style={{ marginTop: 8 }}>{ov.messages.map((m: any, i: number) => <p key={i} className="title" style={{ fontWeight: 560 }}>{m.text}</p>)}</div> : <p className="lead">Nothing to report tonight.</p>}
          <AutoHide onHide={act.overlayHide} />
        </div>
        <div className="stage-foot"><button className="btn block primary" onClick={act.overlayHide}><Icon name="eyeoff" />Hide</button></div>
      </div>
    );
  }
  return (
    <div className="stage" role="dialog" aria-modal="true" aria-label="Your role">
      <div className="stage-body" style={{ justifyContent: "flex-start", paddingTop: "4vh" }}>
        <RoleCard c={E.playerCard(A.s, pid)} />
        <AutoHide onHide={act.overlayHide} />
      </div>
      <div className="stage-foot"><button className="btn block primary" onClick={act.overlayHide}><Icon name="eyeoff" />Hide and pass the phone</button></div>
    </div>
  );
}

function ResultScreen({ ov }: { ov: any }) {
  const p = P(ov.pid);
  return (
    <div className="stage" role="dialog" aria-modal="true" aria-label="Private result">
      <div className="stage-body">
        <p className="kick">For {p ? p.name : "you"} only</p>
        {ov.roles && ov.roles.length ? <>
          <h2 className="mega develop">{ov.subject || "Your target"}</h2>
          <p className="lead">could be one of</p>
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
            {ov.roles.map((r: any) => { const rr = role(r.id); return <li key={r.id} className="title" style={{ display: "flex", alignItems: "center", gap: 12 }}>{rr && <Icon name={rr.icon} size="lg" />}{r.name}</li>; })}
          </ul>
        </> : <h2 className="display develop">{ov.text}</h2>}
      </div>
      <div className="stage-foot"><button className="btn block primary" onClick={act.closeOverlay}><Icon name="eyeoff" />Done — hide this</button></div>
    </div>
  );
}

function NightFalls({ n }: { n: number }) {
  const line = n === 1 ? "The city sleeps. Somewhere, a family is choosing." : n % 2 === 0 ? "A full moon rises over the city." : "The city sleeps. The Mafia wakes.";
  return (
    <div className="stage phase-card" role="dialog" aria-modal="true" aria-label={`Night ${n}`}>
      <div className="stage-body">
        <h1 className="mega phase-title">Night {n}.</h1>
        <p className="line settle" style={{ animationDelay: ".5s" }}>{line}</p>
        <p className="title settle" style={{ animationDelay: "1.1s", marginTop: 18 }}>Everyone, close your eyes.</p>
      </div>
      <div className="stage-foot"><button className="btn block primary" onClick={act.closeOverlay}><Icon name="moon" />Begin the night</button></div>
    </div>
  );
}

function WinScene() {
  const s = A.s; const r = s.result;
  const [go, setGo] = useState(false);
  useEffect(() => { const t = setTimeout(() => setGo(true), 60); return () => clearTimeout(t); }, []);
  if (!r) return null;
  return (
    <div className="stage" role="dialog" aria-modal="true" aria-label="The game is over">
      <div className={`flood ${go ? "go" : ""}`} aria-hidden="true" />
      <div className="stage-body" style={{ position: "relative", zIndex: 2 }}>
        <h1 className="mega phase-title">{r.factionName} {r.faction === "draw" || r.faction.startsWith("solo:") ? "wins" : "win"}.</h1>
        <p className="lead settle" style={{ animationDelay: ".6s" }}>{r.reason}</p>
        {r.winners.length > 0 && <p className="title settle" style={{ animationDelay: "1s" }}>{r.winners.map(w => E.pname(s, w.id)).join(", ")}</p>}
      </div>
      <div className="stage-foot" style={{ position: "relative", zIndex: 2 }}><button className="btn block primary" onClick={act.closeOverlay}>See every role</button></div>
    </div>
  );
}

export function OverlayHost() {
  const ov = A.ui.overlay; if (!ov) return null;
  if (ov.type === "reveal" || ov.type === "private") return <PrivateFlow ov={ov} />;
  if (ov.type === "result") return <ResultScreen ov={ov} />;
  if (ov.type === "cine") return <NightFalls n={ov.n} />;
  if (ov.type === "win") return <WinScene />;
  if (ov.type === "announce") {
    const ann = E.dawnAnnouncement(A.s, ov.n); const f = ov.format;
    const showRole = f === "role" || f === "full", showCause = f === "cause" || f === "full";
    return <DeathScene heading={`Day ${ov.n}.`} sub={ann.deaths.length ? (ann.deaths.length === 1 ? "The town wakes to find one of its own gone." : "The town wakes to a terrible night.") : "The town wakes."}
      deaths={f === "custom" ? [] : ann.deaths.map(d => ({ name: d.name, role: showRole && !d.cleaned ? d.role : null, hidden: showRole && !!d.cleaned, cause: showCause ? d.cause : null }))}
      notes={ann.notes} custom={f === "custom" ? ov.custom || " " : null} sound={!!A.prefs.sound} onDone={act.closeOverlay} />;
  }
  if (ov.type === "execution") {
    if (ov.spared) return <DeathScene heading="The town has decided." deaths={[]} custom={`${ov.name} was voted out — but survived. They are the Prince.`} sound={false} onDone={act.closeOverlay} />;
    const showRole = !!A.s.config.revealOnDeath;
    return <DeathScene heading="The town has decided." deaths={[{ name: ov.name, role: showRole ? ov.role : null, hidden: showRole && ov.hidden, cause: ov.cause }]} sound={!!A.prefs.sound} onDone={() => { act.closeOverlay(); Sound.tick(); }} />;
  }
  return null;
}
