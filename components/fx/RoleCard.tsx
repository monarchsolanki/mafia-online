import type { PlayerCard } from "@/lib/engine/engine";

/** A player's secret: their role develops out of blur. Colour never gives the team away; only the words do. */
export function RoleCard({ c, compact }: { c: PlayerCard; compact?: boolean }) {
  return (
    <div className="rolecard">
      <p className="kick">{c.name}, you are the</p>
      <h2 className="rname develop">{c.roleName}</h2>
      <span className={`team ${c.team}`} style={{ fontSize: "1rem" }}>{c.teamName}</span>
      <p className="lead" style={{ maxWidth: "40ch", color: "var(--ink)" }}>{c.desc}</p>
      <dl>
        {!compact && c.abilities.length > 0 && <div><dt>Abilities</dt><dd><ul>{c.abilities.map((a, i) => <li key={i}>{a}</li>)}</ul></dd></div>}
        <div><dt>You win when</dt><dd>{c.winText}</dd></div>
        {c.teammates.length > 0 && <div><dt>Your allies</dt><dd>{c.teammates.map((t, i) => <div key={i}>{t.name} <span className="muted">· {t.role}{t.alive === false ? " · dead" : ""}</span></div>)}</dd></div>}
        {c.target && <div><dt>Your target</dt><dd className="title">{c.target}</dd></div>}
        {c.lover && <div><dt>Your lover</dt><dd>{c.lover}</dd></div>}
      </dl>
    </div>
  );
}
