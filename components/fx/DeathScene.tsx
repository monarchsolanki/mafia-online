"use client";
// The announcement of a death, shared by the Game Master's phone and every player's phone:
// the name arrives, a heartbeat draws and flatlines, the colour drains out of the room from the name, then the
// role and cause are told. A night with no deaths warms up instead.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Sound } from "@/lib/client/sound";

export interface DeathLine { name: string; role?: string | null; cause?: string | null; hidden?: boolean }

const PATH = "M0 60 H150 L162 60 L172 18 L186 104 L197 46 L205 60 H262 L272 60 L281 30 L292 92 L301 60 H600";
const reduced = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Flatline({ go }: { go: boolean }) {
  return (
    <svg className={`flatline ${go ? "go" : ""}`} viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden="true">
      <path d={PATH} pathLength={1} />
    </svg>
  );
}

function OneDeath({ d, onStage, sound }: { d: DeathLine; onStage: (s: number) => void; sound: boolean }) {
  const [stage, setStage] = useState(0); // 0 name · 1 heartbeat · 2 drain · 3 told
  const nameRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState({ x: "50%", y: "40%" });
  useLayoutEffect(() => {
    const el = nameRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: `${Math.round(r.left + r.width / 2)}px`, y: `${Math.round(r.top + r.height / 2)}px` });
  }, [d.name]);
  useEffect(() => {
    const fast = reduced();
    const t = [
      setTimeout(() => { setStage(1); if (sound) Sound.heartbeat(); }, fast ? 200 : 700),
      setTimeout(() => { setStage(2); if (sound) { Sound.kill(); Sound.flatline(); } }, fast ? 600 : 2500),
      setTimeout(() => setStage(3), fast ? 900 : 3700),
    ];
    return () => t.forEach(clearTimeout);
  }, [sound]);
  useEffect(() => { onStage(stage); }, [stage, onStage]);
  return (
    <div className={`death ${stage >= 2 ? "drained" : ""} ${stage >= 3 ? "told-in" : ""}`}>
      <div className="drain-anchor" style={{ ["--dx" as string]: pos.x, ["--dy" as string]: pos.y }}>
        <div className={`drain ${stage >= 2 ? "go" : ""}`} />
      </div>
      <h2 className="mega develop" style={{ position: "relative", zIndex: 3 }}>
        <span className="who" ref={nameRef}>{d.name}<i className="strike" aria-hidden="true" /></span>
      </h2>
      <div style={{ position: "relative", zIndex: 3 }}><Flatline go={stage >= 1} /></div>
      <div style={{ position: "relative", zIndex: 3 }} className="stack">
        {d.hidden ? <p className="told title">Their role could not be determined.</p> : d.role ? <p className="told title">was the {d.role}.</p> : null}
        {d.cause ? <p className="told lead">{d.cause[0].toUpperCase() + d.cause.slice(1)}.</p> : null}
      </div>
    </div>
  );
}

/** Steps through every death; `onDone` fires on the final Continue. */
export function DeathScene({ heading, sub, deaths, notes, custom, onDone, doneLabel = "Continue", sound = true }: {
  heading: string; sub?: string; deaths: DeathLine[]; notes?: string[]; custom?: string | null; onDone: () => void; doneLabel?: string; sound?: boolean;
}) {
  const [i, setI] = useState(-1); // -1 = the heading card
  const [stage, setStage] = useState(0);
  const quiet = !custom && deaths.length === 0;
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { if (custom || quiet) setWarm(true); else setI(0); }, reduced() ? 300 : 1500);
    return () => clearTimeout(t);
  }, [custom, quiet]);
  const last = i === deaths.length - 1;
  const showNotes = (quiet || custom || (last && stage >= 3)) && notes && notes.length > 0;
  const canGo = custom || quiet ? warm : last && stage >= 3;
  return (
    <div className="stage death-stage" role="dialog" aria-modal="true" aria-label={heading} aria-live="polite">
      {quiet && <div className={`sunrise ${warm ? "go" : ""}`} aria-hidden="true" />}
      <div className="stage-body">
        {i < 0 ? (
          <div className="phase-card">
            <h1 className="mega phase-title">{heading}</h1>
            {sub && <p className="line settle" style={{ animationDelay: ".4s" }}>{sub}</p>}
            {custom && warm && <p className="title settle" style={{ whiteSpace: "pre-wrap", marginTop: 18 }}>{custom}</p>}
            {quiet && warm && <p className="display settle" style={{ marginTop: 22 }}>Everyone survived the night.</p>}
          </div>
        ) : (
          <OneDeath key={i} d={deaths[i]} onStage={setStage} sound={sound} />
        )}
        {showNotes && <div className="stack settle" style={{ marginTop: 18 }}>{notes!.map((n, k) => <p key={k} className="note"><span>{n}</span></p>)}</div>}
      </div>
      <div className="stage-foot">
        {i >= 0 && !last && <button className="btn block primary" onClick={() => { setStage(0); setI(i + 1); }} disabled={stage < 3}>Next</button>}
        {(i < 0 ? custom || quiet : last) && <button className="btn block primary" onClick={onDone} disabled={!canGo}>{doneLabel}</button>}
        {i >= 0 && deaths.length > 1 && <p className="tiny muted" style={{ textAlign: "center" }}>{i + 1} of {deaths.length}</p>}
      </div>
    </div>
  );
}
