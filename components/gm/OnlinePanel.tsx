"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { A, confirmSheet, toast } from "@/lib/client/store";
import { Online, phoneMode, chatMode } from "@/lib/client/online";
import * as act from "@/lib/client/actions";
import { Icon } from "@/components/ui/Icon";

function Qr({ text }: { text: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => { let live = true; QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } }).then(s => { if (live) setSvg(s); }).catch(() => {}); return () => { live = false; }; }, [text]);
  return <div role="img" aria-label="QR code to join this room" style={{ width: 132, height: 132, borderRadius: 16, overflow: "hidden", background: "#fff", flex: "none", padding: 6 }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

async function check() { Online.checking = true; act.closeSheet(); const d = await Online.diagnose(); Online.checking = false; act.openSheet("diag", { data: d }); }

/** What players may do on their own phones. Lives with the room because it only matters online. */
function PhoneRules() {
  const s = A.s; const pm = phoneMode(s), cm = chatMode(s);
  const sel = (id: string, label: string, desc: string, value: string, opts: [string, string][], onChange: (v: string) => void) => (
    <div className="toggle" style={{ flexWrap: "wrap" }}>
      <div className="grow" style={{ minWidth: 180 }}><b><label htmlFor={id}>{label}</label></b><span>{desc}</span></div>
      <select id={id} className="input" style={{ width: "auto", maxWidth: 220, minHeight: 44, fontSize: 15 }} value={value} onChange={e => onChange(e.target.value)}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
  return (
    <div className="list" style={{ marginTop: 6 }}>
      {sel("cf-phoneActions", "Night choices on phones", pm === "off" ? "You call every role and tap their choice here." : pm === "mafia" ? "The Mafia pick their victim on their phones. You still call the other roles." : "Every role picks on their own phone. You only resolve the night.",
        pm, [["off", "Off"], ["mafia", "Mafia kill only"], ["all", "Every role"]], v => act.cfgSet("phoneActions", v))}
      {sel("cf-mafiaChat", "Silent Mafia chat", "When two or more of the Mafia (or Vampires) are alive, they can message each other on their phones.",
        cm, [["off", "Off"], ["night", "At night"], ["always", "Day and night"]], v => act.cfgSet("mafiaChat", v))}
      {cm !== "off" && s.phase !== "setup" && <div className="toggle"><div className="grow"><b>Read along</b><span>See what the factions are saying. Only on this phone.</span></div><button className="btn sm" onClick={() => { Online.readChat = true; Online.refresh(); act.openSheet("chatlog"); }}><Icon name="eye" size="sm" />Open</button></div>}
    </div>
  );
}

export function ChatLog() {
  const msgs = Online.status.chat || [];
  useEffect(() => { Online.readChat = true; Online.refresh(); const t = setInterval(() => Online.refresh(), 4000); return () => { clearInterval(t); Online.readChat = false; }; }, []);
  const label = (ch: string) => (ch.endsWith(":vampire") ? "Vampires" : "Mafia");
  return (
    <>
      <p className="small muted">Read-only. Players can’t tell you’re reading.</p>
      {msgs.length ? <ol className="chat-log" style={{ marginTop: 12 }}>{msgs.map(m => <li key={m.id}><b>{m.name}</b><span className="tiny muted"> · {label(m.channel)}</span><p>{m.body}</p></li>)}</ol>
        : <p className="muted" style={{ marginTop: 16 }}>Nothing yet.</p>}
    </>
  );
}

export function OnlinePanel() {
  const O = Online; if (!O.avail) return null;
  const errLine = O.err ? <p className="note warn" style={{ marginTop: 12 }}><Icon name="alert" size="sm" /><span>{O.err}</span></p> : null;
  const checkBtn = <button className="btn sm" onClick={check} disabled={O.checking}><Icon name="refresh" size="sm" />{O.checking ? "Checking…" : "Check connection"}</button>;
  if (O.avail === "unconfigured") return (
    <div className="well"><h2 className="subtitle">Play on everyone’s phones</h2><p className="small muted" style={{ marginTop: 6 }}>Online play isn’t switched on for this site yet. Add the Supabase keys in Vercel (see the README), then redeploy.</p>{errLine}<div className="row" style={{ marginTop: 12 }}>{checkBtn}</div></div>
  );
  if (!O.room) return (
    <div className="well">
      <h2 className="subtitle">Play on everyone’s phones</h2>
      <p className="small muted" style={{ marginTop: 6 }}>Players open the link, tap their own name, and see their role, private results and votes on their own phone. Nobody passes this phone around.</p>
      <div className="row" style={{ marginTop: 14 }}><button className="btn primary sm" onClick={() => O.host()} disabled={O.busy}><Icon name="phone" size="sm" />{O.busy ? "Opening the room…" : "Host an online room"}</button>{O.err && checkBtn}</div>
      {errLine}
    </div>
  );
  const joined = O.joined(); const link = O.link();
  return (
    <div className="well">
      <div className="spread"><h2 className="subtitle">Online room</h2><span className={`chip ${joined === A.s.players.length && joined ? "solid" : ""}`}>{joined} of {A.s.players.length} joined</span></div>
      <div className="row nowrap" style={{ marginTop: 14, alignItems: "flex-start", gap: 16 }}>
        <Qr text={link} />
        <div style={{ minWidth: 0 }}>
          <div className="small muted">Room code</div>
          <div className="display num" style={{ letterSpacing: "0.08em", fontSize: "2.4rem" }}>{O.room.code}</div>
          <div className="tiny muted" style={{ wordBreak: "break-all", marginTop: 4 }}>{link}</div>
          <button className="btn sm" style={{ marginTop: 10 }} onClick={() => { (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast("Link copied"), () => act.openSheet("copytext", { title: "Join link", text: link })); }}><Icon name="copy" size="sm" />Copy link</button>
        </div>
      </div>
      <div className="list" style={{ marginTop: 12 }}>
        {A.s.players.map(p => { const st = O.status.seats.find(x => x.id === p.id) || { claimed: false, seen: false };
          return (
            <div className="li" key={p.id} style={{ minHeight: 48, padding: "6px 0" }}>
              <span className="dot" style={{ ["--c" as string]: st.claimed ? "var(--team-town)" : "color-mix(in oklab, var(--ink) 25%, transparent)" }} />
              <span className="grow"><b>{p.name}</b><span>{st.claimed ? (st.seen ? "Joined · has looked at their role" : "Joined") : "Not joined yet"}</span></span>
              {st.claimed && <button className="btn xs" onClick={() => confirmSheet({ title: `Reset ${p.name}’s phone?`, body: "Whoever joined as this player is disconnected, and the name can be claimed again. Use this if the wrong person tapped the name or a phone changed.", ok: "Reset seat", danger: true, onOk: () => O.resetSeat(p.id) })}>Reset</button>}
            </div>
          ); })}
        {!A.s.players.length && <p className="small muted" style={{ padding: "10px 0" }}>Add players and they appear here to be claimed.</p>}
      </div>
      <h3 className="label" style={{ marginTop: 18 }}>On their phones</h3>
      <PhoneRules />
      {errLine}
      <div className="row" style={{ marginTop: 12 }}>{O.err && checkBtn}<button className="btn sm ghost" onClick={() => confirmSheet({ title: "Close the online room?", body: "Every phone is disconnected. The game itself continues on this phone.", ok: "Close the room", danger: true, onOk: () => O.close() })}>Close the room</button></div>
    </div>
  );
}
