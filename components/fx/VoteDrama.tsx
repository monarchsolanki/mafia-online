"use client";
// The vote, told one ballot at a time, and the accused's last words. Shared by the Game Master's phone and every player's phone.
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { haptic } from "@/lib/client/sound";

export interface Ballot { from: string; to: string; w?: number }
const reduced = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Reveals ballots one by one while the tally grows, then says what the town decided. */
export function VoteReveal({ ballots, outcome, onDone, doneLabel = "Continue", round }: { ballots: Ballot[]; outcome: string; onDone: () => void; doneLabel?: string; round?: number }) {
  const [shown, setShown] = useState(reduced() ? ballots.length : 0);
  useEffect(() => {
    if (shown >= ballots.length) return;
    const t = setTimeout(() => { setShown(n => n + 1); haptic(12); }, shown === 0 ? 900 : 750);
    return () => clearTimeout(t);
  }, [shown, ballots.length]);
  const done = shown >= ballots.length;
  const order = useMemo(() => { const o: string[] = []; for (const b of ballots) if (!o.includes(b.to)) o.push(b.to); return o; }, [ballots]);
  const totals: Record<string, number> = {}; for (const b of ballots.slice(0, shown)) totals[b.to] = (totals[b.to] || 0) + (b.w || 1);
  const max = Math.max(1, ...ballots.reduce((acc, b) => { acc[order.indexOf(b.to)] = (acc[order.indexOf(b.to)] || 0) + (b.w || 1); return acc; }, [] as number[]));
  const last = shown > 0 ? ballots[shown - 1] : null;
  return (
    <div className="stage" role="dialog" aria-modal="true" aria-label="The vote">
      <div className="stage-body" style={{ justifyContent: "flex-start", paddingTop: "6vh" }}>
        <h1 className="display phase-title">The vote{round && round > 1 ? `, round ${round}` : ""}.</h1>
        <p className="lead" aria-live="polite" style={{ minHeight: "3em", marginTop: 6 }}>
          {last ? <span key={shown} className="settle" style={{ display: "inline-block" }}><b style={{ color: "var(--ink)" }}>{last.from}</b>{last.w && last.w > 1 ? ` (×${last.w})` : ""} votes for <b style={{ color: "var(--ink)" }}>{last.to}</b></span> : ballots.length ? "Counting…" : "Nobody voted."}
        </p>
        <div className="stack" style={{ gap: 12, marginTop: 10 }}>
          {order.map(name => (
            <div key={name} className="tally-row">
              <span className="strong">{name}</span>
              <span className="tally-bar"><i style={{ width: `${((totals[name] || 0) / max) * 100}%` }} /></span>
              <b className="num">{totals[name] || 0}</b>
            </div>
          ))}
        </div>
        {done && <p className="title settle" style={{ marginTop: 22 }}>{outcome}</p>}
      </div>
      <div className="stage-foot">
        {!done && <button className="btn block ghost" onClick={() => setShown(ballots.length)}>Show all</button>}
        {done && <button className="btn block primary" onClick={onDone}>{doneLabel}</button>}
      </div>
    </div>
  );
}

function useCountdown(endsAt: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(i); }, []);
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}
/** The accused speaks. A ring drains with the time; at zero the town falls silent. */
export function LastWords({ name, endsAt, total, me, onDone, doneLabel, onCancel }: { name: string; endsAt: number; total: number; me?: boolean; onDone?: () => void; doneLabel?: string; onCancel?: () => void }) {
  const left = useCountdown(endsAt);
  useEffect(() => { if (left > 0 && left <= 5) haptic(20); if (left === 0) haptic([60, 40, 60]); }, [left]);
  const frac = total > 0 ? left / total : 0; const R = 54, C = 2 * Math.PI * R;
  return (
    <div className="stage" role="dialog" aria-modal="true" aria-label={`${name}'s last words`}>
      <div className="stage-body" style={{ alignItems: "center", textAlign: "center" }}>
        <p className="lead">{me ? "The town has chosen you." : "The town has chosen."}</p>
        <h1 className="mega phase-title" style={{ marginTop: 6 }}>{me ? "Your last words." : name}</h1>
        {!me && <p className="title" style={{ marginTop: 4 }}>Last words.</p>}
        <div className="lw-ring" aria-live="polite" aria-label={`${left} seconds left`}>
          <svg viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r={R} className="track" /><circle cx="64" cy="64" r={R} className="left" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - frac) }} /></svg>
          <b className="num">{left}</b>
        </div>
        <p className="small muted">{left ? (me ? "Speak now. Make it count." : "Everyone else stays silent.") : "Time is up."}</p>
      </div>
      {(onDone || onCancel) && <div className="stage-foot">
        {onDone && <button className={`btn block ${left ? "" : "primary"}`} onClick={onDone}><Icon name="gavel" />{doneLabel || (left ? "Done — continue" : "Continue")}</button>}
        {onCancel && <button className="btn block ghost" onClick={onCancel}>Cancel the execution</button>}
      </div>}
    </div>
  );
}
