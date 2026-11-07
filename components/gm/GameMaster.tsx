"use client";
import { useEffect, useState } from "react";
import E from "@/lib/engine/engine";
import { A, useStore, boot, onSave, undo, toast, actOf, emit, top0, type View } from "@/lib/client/store";
import { Sound, soundSetup } from "@/lib/client/sound";
import { Online } from "@/lib/client/online";
import { Cloud } from "@/lib/client/cloud";
import { decodeSetup } from "@/lib/client/share";
import * as act from "@/lib/client/actions";
import { Icon } from "@/components/ui/Icon";
import { Home } from "./Home";
import { Setup } from "./Setup";
import { Game } from "./Game";
import { PlayersView, TimelineView } from "./Players";
import { RolesView } from "./Roles";
import { SettingsView } from "./Settings";
import { SheetHost } from "./Sheets";
import { OverlayHost } from "./Overlays";

const META_THEME = () => document.querySelector('meta[name="theme-color"]');

function phaseLabel(): { title: string; sub: string } {
  const s = A.s;
  if (s.phase === "setup") return { title: "Setup", sub: `${s.players.length || "No"} player${s.players.length === 1 ? "" : "s"}` };
  if (s.phase === "night" || s.phase === "reveal-done") return { title: `Night ${s.night}`, sub: `${s.players.filter(p => p.alive).length} alive` };
  if (s.phase === "dawn") return { title: `Dawn ${s.night}`, sub: `${s.players.filter(p => p.alive).length} alive` };
  if (s.phase === "day") return { title: `Day ${s.day}`, sub: `${s.players.filter(p => p.alive).length} alive` };
  if (s.phase === "ended") return { title: "Game over", sub: !s.result ? "" : s.result.faction === "draw" ? "Nobody won" : `${s.result.factionName} won` };
  return { title: "", sub: "" };
}

function Topbar() {
  const u = A.ui; const last = A.hist[A.hist.length - 1];
  const showBack = u.view !== "command" || (A.s.phase === "setup" && u.setupStep > 0);
  const { title, sub } = phaseLabel();
  const view = { players: "Players", timeline: "Timeline", roles: "Roles", settings: "Rules" }[u.view as string];
  return (
    <header className="topbar">
      {showBack
        ? <button className="iconbtn" onClick={() => goBack()} aria-label="Go back"><Icon name="back" /></button>
        : <button className="iconbtn" onClick={act.goHome} aria-label="Omertà home"><Icon name="mask" /></button>}
      <div className="where">
        <b>{view || title}</b>
        <span>{view ? title : sub}{Online.room ? ` · Room ${Online.room.code}` : ""}</span>
      </div>
      <button className="iconbtn" onClick={undo} disabled={!last} aria-label={last ? "Undo: " + last.label : "Nothing to undo"} title={last ? "Undo: " + last.label : "Nothing to undo"}><Icon name="undo" /></button>
      <button className="iconbtn" onClick={() => act.openSheet("menu")} aria-label="Game menu: restart, sound, new game" aria-haspopup="dialog"><Icon name="menu" /></button>
    </header>
  );
}

function Tabs() {
  const s = A.s; const v = A.ui.view;
  const alert = (s.winPrompt || s.pending.length) && v !== "command";
  const items: [View, string, string][] = [["command", s.phase === "setup" ? "Setup" : "Game", "command"], ["players", "Players", "users"], ["timeline", "Log", "clock"], ["roles", "Roles", "book"], ["settings", "Rules", "settings"]];
  return (
    <nav className="tabs" aria-label="Main">
      {items.map(([k, l, ic]) => (
        <button key={k} onClick={() => act.nav(k)} aria-current={v === k ? "page" : undefined} className={k === "command" && alert ? "dot-alert" : ""}>
          <Icon name={ic} /><span>{l}</span>
        </button>
      ))}
    </nav>
  );
}

/* ---------- going back: the Back buttons and the phone's own Back ---------- */
let backArmed = 0;
// Leaving with a single stray swipe is easy to do by accident, so the exits ask twice.
function confirmBackTwice(msg: string) { const now = Date.now(); if (now - backArmed < 2500) { backArmed = 0; return true; } backArmed = now; toast(msg); return false; }
export function goBack(): "handled" | "exit" {
  const u = A.ui, s = A.s, ov = u.overlay;
  if (ov) {
    if (["cine", "announce", "result", "execution", "win"].includes(ov.type)) { act.closeOverlay(); return "handled"; }
    if (ov.stage === "card") { act.overlayHide(); return "handled"; } // hide a private card; never expose the Game Master's screen
    toast("Use the buttons on this screen."); return "handled";
  }
  if (u.sheet) { u.sheet = null; emit(); return "handled"; }
  if (u.view === "home") return confirmBackTwice("Press Back again to leave Omertà") ? "exit" : "handled";
  if (u.view !== "command") { u.view = u.backTo || "command"; u.backTo = null; top0(); emit(); return "handled"; }
  if (s.phase === "setup") { if (u.setupStep > 0) u.setupStep--; else u.view = "home"; top0(); emit(); return "handled"; }
  if (s.phase === "night" && u.nightIdx > 0) { u.nightIdx--; u.draft = null; emit(); return "handled"; }
  if (confirmBackTwice("Press Back again to go to the home screen")) { u.view = "home"; emit(); }
  return "handled";
}

function Toast() {
  if (!A.ui.toast) return null;
  return <div className="toast-wrap"><div className="toast" role="status" key={A.ui.toast}>{A.ui.toast}</div></div>;
}

export default function GameMaster() {
  const [ready, setReady] = useState(false);
  useStore();
  useEffect(() => {
    boot();
    (window as unknown as { __omerta: unknown }).__omerta = { A, E, emit, act, Cloud, Online }; // for tests and debugging on the device
    soundSetup(() => !!A.prefs.sound);
    onSave(() => { if (Online.room) Online.schedule(); });
    try { // a setup shared by another host: /?setup=...
      const q = new URL(location.href).searchParams.get("setup");
      if (q) { const sh = decodeSetup(q); history.replaceState(null, "", location.pathname); if (sh) { A.ui.sheet = { type: "import-setup", data: sh }; emit(); } else toast("That setup link is broken or incomplete."); }
    } catch { /* not a setup link */ }
    Online.init(); Cloud.init();
    try { history.replaceState({ omerta: "root" }, ""); history.pushState({ omerta: "app" }, ""); } catch { /* history blocked */ }
    const onPop = () => { if (goBack() === "exit") { try { history.back(); } catch { /* gone */ } return; } try { history.pushState({ omerta: "app" }, ""); } catch { /* blocked */ } };
    window.addEventListener("popstate", onPop);
    const unlock = () => Sound.unlock(); window.addEventListener("pointerdown", unlock, { once: true });
    const onHide = () => { if (document.hidden && A.ready) { try { localStorage.setItem("omerta.game.v1", JSON.stringify({ s: A.s, hist: A.hist.slice(-25) })); } catch { /* full */ } } };
    document.addEventListener("visibilitychange", onHide);
    if ("serviceWorker" in navigator && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") navigator.serviceWorker.register("/sw.js").catch(() => {});
    setReady(true);
    return () => { window.removeEventListener("popstate", onPop); document.removeEventListener("visibilitychange", onHide); };
  }, []);

  const ov = ready ? A.ui.overlay : null;
  const theAct = !ready ? "dusk" : ov && ov.act ? ov.act : ov && ov.type === "announce" ? "dawn" : ov && ov.type === "execution" ? "vote" : ov && ov.type === "cine" ? "night" : actOf(A.s, A.ui.view);
  useEffect(() => {
    document.documentElement.dataset.act = theAct;
    const m = META_THEME(); if (m) m.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--ground").trim() || "#2b1e40");
    const t = setTimeout(() => { const m2 = META_THEME(); if (m2) m2.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--ground").trim()); }, 1300);
    return () => clearTimeout(t);
  }, [theAct]);
  useEffect(() => { if (ready) Sound.ambience(A.s.phase === "night" && !A.ui.overlay); });
  useEffect(() => { // the day timer
    const i = setInterval(() => {
      const t = A.ui.timer; if (!t || !t.running) return;
      if (t.endAt - Date.now() <= 0) { t.running = false; t.left = 0; Sound.end(); toast("Time is up — move to the vote."); }
      emit();
    }, 500);
    return () => clearInterval(i);
  }, []);

  if (!ready) return <main className="shell" aria-busy="true" />;
  if (ov) return <><OverlayHost /><Toast /></>;
  const v = A.ui.view;
  if (v === "home") return <div className="shell"><Home /><SheetHost /><Toast /></div>;
  return (
    <div className="shell with-rail">
      <Topbar />
      <main className="page" id="main">
        {v === "players" ? <PlayersView /> : v === "timeline" ? <TimelineView /> : v === "roles" ? <RolesView /> : v === "settings" ? <SettingsView /> : A.s.phase === "setup" ? <Setup /> : <Game />}
      </main>
      <Tabs />
      <SheetHost />
      <Toast />
    </div>
  );
}
