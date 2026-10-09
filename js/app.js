/* Omertà — application core (state, persistence, sound, icons, overlays, events) */
'use strict';
const E = window.Engine;
const $ = sel => document.querySelector(sel);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'omerta.game.v1', PKEY = 'omerta.prefs.v1', PRKEY = 'omerta.presets.v1', CRKEY = 'omerta.customroles.v1', GKEY = 'omerta.groups.v1';
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

/* ---------- store ---------- */
const A = {
  s: null, hist: [],
  prefs: Object.assign({ sound: true, disabled: [] }, LS.get(PKEY, {})),
  presets: LS.get(PRKEY, []), customLib: LS.get(CRKEY, []), groups: LS.get(GKEY, []),
  ui: { view: 'home', setupStep: 0, nightIdx: 0, draft: null, sheet: null, overlay: null, libQuery: '', libFilter: 'all', poolTab: 'town', poolQuery: '',
    tlMode: 'all', pfilter: 'all', voteNominee: null, annFormat: null, annCustom: '', showAssign: false, peek: {}, delivered: {}, timer: null, pin: '', bulk: false, quickN: 10 },
};
function boot() {
  const saved = LS.get(KEY, null);
  if (saved && saved.s && saved.s.v === 1) { A.s = saved.s; A.hist = saved.hist || []; A.ui.view = A.s.phase === 'setup' && !A.s.players.length ? 'home' : 'command'; }
  else { A.s = E.newGame(); A.ui.view = 'home'; }
  for (const r of A.customLib) if (!A.s.customRoles[r.id]) A.s.customRoles[r.id] = r;
  A.s.setup.disabled = A.prefs.disabled.slice();
  if ((A.s.config.cfgv || 1) < 2) { A.s.config.godfatherInnocent = false; A.s.config.nkSuspicious = false; A.s.config.cfgv = 2; } // Police: thumbs up only for Mafia
}
function save() {
  if (window.Online && Online.room) Online.schedule();
  if (LS.set(KEY, { s: A.s, hist: A.hist.slice(-25) })) return;
  if (LS.set(KEY, { s: A.s, hist: A.hist.slice(-5) })) return;
  LS.set(KEY, { s: A.s, hist: [] });
}
function savePrefs() { LS.set(PKEY, A.prefs); }
function cmd(label, fn) {
  const snap = JSON.stringify(A.s);
  let r;
  try { r = fn(A.s); }
  catch (err) { console.error(err); A.s = JSON.parse(snap); toast(err && err.message ? err.message : 'That action could not be completed.'); render(); return false; }
  if (r && typeof r === 'object' && Array.isArray(r.players) && r !== A.s) A.s = r;
  A.hist.push({ label, snap, t: Date.now() }); if (A.hist.length > 80) A.hist.shift();
  save(); render(); return true;
}
function undo() {
  const h = A.hist.pop(); if (!h) return;
  A.s = JSON.parse(h.snap); A.ui.sheet = null; A.ui.draft = null; save(); toast('Undone: ' + h.label); render();
}
let toastT = null;
function toast(msg) { A.ui.toast = msg; renderToast(); clearTimeout(toastT); toastT = setTimeout(() => { A.ui.toast = null; renderToast(); }, 2600); }
function renderToast() { const el = $('#toast'); el.innerHTML = A.ui.toast ? `<div class="toast" role="status">${esc(A.ui.toast)}</div>` : ''; }

/* ---------- sound (Web Audio, synthesized, no external files) ---------- */
const Sound = {
  ctx: null, amb: null,
  get on() { return !!A.prefs.sound; },
  init() { if (this.ctx) return true; try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); return true; } catch (e) { return false; } },
  tone(f, d, type = 'sine', g = 0.06, at = 0, f2 = null) {
    if (!this.on || !this.init()) return; const c = this.ctx; const t = c.currentTime + at;
    const o = c.createOscillator(), v = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    v.gain.setValueAtTime(0.0001, t); v.gain.exponentialRampToValueAtTime(g, t + 0.02); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(v).connect(c.destination); o.start(t); o.stop(t + d + 0.05);
  },
  tick() { this.tone(880, 0.07, 'triangle', 0.025); },
  confirm() { this.tone(660, 0.12, 'triangle', 0.04); this.tone(990, 0.18, 'triangle', 0.035, 0.08); },
  kill() { this.tone(110, 0.6, 'sine', 0.14, 0, 38); this.tone(70, 0.9, 'triangle', 0.08, 0.05, 30); },
  night() { [196, 233, 294, 392].forEach((f, i) => this.tone(f, 1.6, 'sine', 0.04, i * 0.18)); },
  day() { [262, 330, 392, 523].forEach((f, i) => this.tone(f, 1.1, 'triangle', 0.035, i * 0.12)); },
  end() { [262, 330, 392, 523, 659, 784].forEach((f, i) => this.tone(f, 1.4, 'triangle', 0.045, i * 0.14)); },
  ambience(on) {
    if (!on || !this.on) { if (this.amb) { const a = this.amb; this.amb = null; try { a.g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4); setTimeout(() => { a.nodes.forEach(n => { try { n.stop(); } catch (e) {} }); }, 1500); } catch (e) {} } return; }
    if (this.amb || !this.init()) return; const c = this.ctx;
    const g = c.createGain(); g.gain.value = 0.0001; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340;
    const o1 = c.createOscillator(), o2 = c.createOscillator(); o1.type = 'sawtooth'; o2.type = 'sawtooth'; o1.frequency.value = 55; o2.frequency.value = 55.6;
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 140; lfo.connect(lg).connect(lp.frequency);
    o1.connect(lp); o2.connect(lp); lp.connect(g).connect(c.destination); [o1, o2, lfo].forEach(n => n.start());
    g.gain.setTargetAtTime(0.022, c.currentTime, 1.5); this.amb = { g, nodes: [o1, o2, lfo] };
  },
  sync() { this.ambience(A.s && A.s.phase === 'night' && !A.ui.overlay); },
};

/* ---------- icons (hand-drawn 24px stroke set) ---------- */
const IC = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.6c2 .6 3.5 2.3 3.5 5.4"/>',
  cross: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  badge: '<circle cx="12" cy="12" r="9"/><path d="M12 7l1.5 3 3.3.5-2.4 2.3.6 3.3L12 14.5l-3 1.6.6-3.3-2.4-2.3 3.3-.5z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  crosshair: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/>',
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  footprints: '<path d="M8 3c2 0 3 2 3 4.5S10 12 8 12 5 10 5 7.5 6 3 8 3zM6 14.5h4V17a2 2 0 0 1-4 0zM16 7c2 0 3 2 3 4.5S18 16 16 16s-3-2-3-4.5S14 7 16 7zM14 18.5h4V21a2 2 0 0 1-4 0z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.3 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  telescope: '<path d="M3 14l14-6 2 4-14 6zM14 9.5l1.5 3.5M10 17l-2 4M12 16l2 5"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  medal: '<circle cx="12" cy="15" r="6"/><path d="M8.5 3l3.5 6 3.5-6"/><path d="M12 12.5l.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z"/>',
  candle: '<path d="M9 10h6v11H9z"/><path d="M12 3c1.5 2 2 3 2 4a2 2 0 0 1-4 0c0-1 .5-2 2-4z"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  gun: '<path d="M3 9h16l1 3h-9l-1 2H7l-1 6H3l1.5-7H3z"/><path d="M11 12v2"/>',
  orb: '<circle cx="12" cy="10" r="7"/><path d="M7 20h10M9 17l-1 3M15 17l1 3M9 8a3 3 0 0 1 3-2"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/>',
  swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  ear: '<path d="M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-6 0"/><path d="M10 9a2 2 0 0 1 4 0"/>',
  ankh: '<path d="M12 11c-3-2-3.5-8 0-8s3 6 0 8zM12 11v10M7 13h10"/>',
  bow: '<path d="M5 3c8 3 8 15 0 18M5 3v18M3 12h17M17 9l3 3-3 3"/>',
  heart: '<path d="M12 20s-8-4.7-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.3 12 20 12 20z"/>',
  twins: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5M10.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/>',
  tiara: '<path d="M4 17c0-6 4-9 8-9s8 3 8 9z"/><path d="M12 8V4M8 9.5L6.5 6M16 9.5L17.5 6"/><circle cx="12" cy="13" r="1.3"/>',
  bottle: '<path d="M10 2h4v4l2 3v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9l2-3z"/><path d="M8 13h8"/>',
  knife: '<path d="M4 20l9-9M13 11l7-7c1 3-1 7-4 9z"/><path d="M6 15l3 3"/>',
  fedora: '<path d="M2 16c3 2 17 2 20 0"/><path d="M5 16c0-5 2-9 7-9s7 4 7 9"/><path d="M7 12.5c3 1 7 1 10 0"/>',
  fist: '<path d="M7 11V7a1.5 1.5 0 0 1 3 0v3M10 10V6a1.5 1.5 0 0 1 3 0v4M13 10V7a1.5 1.5 0 0 1 3 0v4M16 11V9a1.5 1.5 0 0 1 3 0v5c0 4-3 7-7 7s-7-3-7-7v-3h5"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l4 6M21 9l-4 6"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  envelope: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  scroll: '<path d="M6 3h12v15a3 3 0 0 1-3 3H6a3 3 0 0 1 0-6h9"/><path d="M9 7h6M9 11h6"/>',
  frame: '<rect x="3" y="3" width="18" height="18" rx="1"/><rect x="7" y="7" width="10" height="10"/>',
  mask: '<path d="M2 8c3-1 6-1 10 1 4-2 7-2 10-1 0 6-3 9-6 9-2 0-3-2-4-2s-2 2-4 2c-3 0-6-3-6-9z"/><path d="M6 11.5c1-1 2.5-1 3.5 0M14.5 11.5c1-1 2.5-1 3.5 0"/>',
  broom: '<path d="M19 3l-7 9"/><path d="M12 12c-3-1-6 1-7 4l-2 5c3 0 7-1 9-3 2-2 2-4 0-6z"/><path d="M7 16l3 3"/>',
  spiral: '<path d="M12 12a1 1 0 0 1 1 1 2 2 0 0 1-2 2 3 3 0 0 1-3-3 4 4 0 0 1 4-4 5 5 0 0 1 5 5 6 6 0 0 1-6 6 7 7 0 0 1-7-7 8 8 0 0 1 8-8"/>',
  dagger: '<path d="M12 2l2 4v9h-4V6z"/><path d="M7 15h10M12 15v4M10 21h4"/>',
  vial: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7 15h10"/>',
  jester: '<path d="M5 18h14l-1 3H6z"/><path d="M5 18L3 6l5 4 4-7 4 7 5-4-2 12"/><circle cx="3" cy="5" r="1"/><circle cx="12" cy="2.5" r="1"/><circle cx="21" cy="5" r="1"/>',
  noose: '<path d="M12 2v6"/><circle cx="12" cy="14" r="5"/><path d="M10 9h4"/>',
  vest: '<path d="M8 3l4 3 4-3 4 3-2 5v10H6V11L4 6z"/><path d="M12 6v15"/>',
  wings: '<path d="M12 9c-2-4-6-6-10-5 1 5 4 9 10 10M12 9c2-4 6-6 10-5-1 5-4 9-10 10"/><path d="M12 14v6"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1A3.5 3.5 0 0 0 7 18z"/>',
  podium: '<path d="M4 21h16M6 21V11h12v10M9 11V7h6v4M12 3v4"/>',
  cauldron: '<path d="M4 10h16a8 8 0 0 1-16 0z"/><path d="M3 10h18M7 21l1-3M17 21l-1-3M9 6c0-1 1-2 2-2M14 7c0-1.5 1-3 2.5-3"/>',
  skullbones: '<path d="M12 3a6 6 0 0 0-6 6c0 2 1 3 2 4v2h8v-2c1-1 2-2 2-4a6 6 0 0 0-6-6z"/><circle cx="9.5" cy="9" r="1.2"/><circle cx="14.5" cy="9" r="1.2"/><path d="M4 17l16 4M20 17L4 21"/>',
  skull: '<path d="M12 3a7 7 0 0 0-7 7c0 2.5 1.2 4 2.5 5v3h9v-3c1.3-1 2.5-2.5 2.5-5a7 7 0 0 0-7-7z"/><circle cx="9.5" cy="10.5" r="1.3"/><circle cx="14.5" cy="10.5" r="1.3"/><path d="M10 18v3M14 18v3"/>',
  flame: '<path d="M12 21c-4 0-7-3-7-7 0-4 4-6 4-11 3 2 5 5 5 8 1-1 1.5-2 1.5-3 2 2 3.5 4 3.5 6 0 4-3 7-7 7z"/>',
  wolf: '<path d="M4 3l4 5h8l4-5v8c0 5-4 10-8 10S4 16 4 11z"/><path d="M9 12h.01M15 12h.01M10 16l2 1.5 2-1.5"/>',
  eye3: '<path d="M12 3l9 16H3z"/><path d="M8 14s1.5-2.5 4-2.5 4 2.5 4 2.5-1.5 2.5-4 2.5-4-2.5-4-2.5z"/><circle cx="12" cy="14" r="1"/>',
  hood: '<path d="M12 3C7 3 4 8 4 13v8h16v-8c0-5-3-10-8-10z"/><path d="M8 21v-6a4 4 0 0 1 8 0v6"/>',
  fang: '<path d="M3 5h18l-2 5H5z"/><path d="M7 10l1.5 6L10 10M14 10l1.5 6L17 10"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  command: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  book: '<path d="M12 6c-2-1.5-5-2-8-1.5V19c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V4.5c-3-.5-6 0-8 1.5z"/><path d="M12 6v14"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>', check: '<path d="M5 12.5l4.5 4.5L19 7"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M7 4l13 8-13 8z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-5L4 8M4 4v4h4M4 13a8 8 0 0 0 14 5l2-2M20 20v-4h-4"/>', chev: '<path d="M9 6l6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  gavel: '<path d="M14 4l6 6M11 7l6 6M12.5 5.5l-5 5M15.5 8.5l-5 5"/><path d="M9 12l-6 6 2 2 6-6M4 21h9"/>',
  hand: '<path d="M9 11V5a1.5 1.5 0 0 1 3 0v5M12 9V4a1.5 1.5 0 0 1 3 0v6M15 9.5V6a1.5 1.5 0 0 1 3 0v8c0 4-3 7-6.5 7-2.5 0-4-1-5.5-3l-3-4.5a1.5 1.5 0 0 1 2.4-1.8L9 14"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>', flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  bug: '<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M12 7v13M3 12h4M17 12h4M4 7l3 2M20 7l-3 2M4 19l3-2M20 19l-3-2M9 4l1.5 2M15 4l-1.5 2"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  restart: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || IC.star}</svg>`;
const ROLE_ICONS = Object.keys(IC).filter(k => !['undo','command','clock','book','settings','plus','minus','trash','edit','up','down','check','x','play','pause','download','copy','refresh','chev','info','alert','save','flag','bug','hourglass','phone','eyeoff','volume','users','menu','restart'].includes(k));

/* ---------- small helpers ---------- */
const S = () => A.s;
const role = id => E.getRole(A.s, id);
const P = id => E.getP(A.s, id);
const teamCls = t => 't-' + (t || 'neutral');
const teamName = t => ({ town: 'Town', mafia: 'Mafia', cult: 'Cult', vampire: 'Vampire', solo: 'Solo killer', neutral: 'Neutral' }[t] || 'Neutral');
const teamVar = t => ({ town: 'var(--town)', mafia: 'var(--mafia)', cult: 'var(--cult)', vampire: 'var(--vamp)', solo: 'var(--solo)', neutral: 'var(--neutral)' }[t] || 'var(--neutral)');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function moonShadeTransform(n) {
  // even nights = full moon (Werewolf's nights). odd nights wax toward full.
  if (n % 2 === 0) return 'translateX(110%)';
  const k = Math.min(1, 0.25 + ((n - 1) / 2) * 0.22); return `translateX(${Math.round(k * 82)}%)`;
}
const moonHTML = n => `<div class="moon" role="img" aria-label="${n % 2 === 0 ? 'Full moon' : 'Waxing moon'}"><div class="shade" style="transform:${moonShadeTransform(n)}"></div></div>`;
function fmtDur(ms) { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; }
function phaseKey() { if (A.ui.view === 'home') return 'setup'; const p = A.s.phase; return p === 'reveal-done' ? 'night' : p; }

/* ---------- downloads (published-page capability, with fallbacks) ---------- */
let downloadsCap = null;
(async () => { try { if (window.claude && window.claude.use) downloadsCap = await window.claude.use('downloads'); } catch (e) { downloadsCap = null; } })();
async function offerFile(filename, text) {
  if (downloadsCap) {
    try { await downloadsCap.save({ filename, data: text }); toast('Saved ' + filename); return; }
    catch (e) { if (e && e.code === 'declined') { toast('Save cancelled'); return; } }
  }
  // outside Claude (e.g. on Vercel) a normal browser download works
  if (!(window.claude && window.claude.use)) {
    try {
      const blob = new Blob([text], { type: filename.endsWith('.json') ? 'application/json' : 'text/plain' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000); toast('Downloaded ' + filename); return;
    } catch (e) {}
  }
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); return; } catch (e) {}
  A.ui.sheet = { type: 'copytext', title: filename, text }; render();
}

/* ---------- hold-to-confirm buttons ---------- */
let holdTimer = null;
function bindHolds() {
  document.querySelectorAll('[data-hold]').forEach(el => {
    if (el._bound) return; el._bound = true;
    const ms = +(el.dataset.ms || 600); el.style.setProperty('--hold', ms + 'ms');
    const start = e => { if (e.type === 'keydown' && !(e.key === ' ' || e.key === 'Enter')) return; if (e.repeat) return; e.preventDefault(); el.classList.add('holding'); clearTimeout(holdTimer); holdTimer = setTimeout(() => { el.classList.remove('holding'); dispatch(el.dataset.hold, el.dataset.v, el); }, ms); };
    const stop = () => { el.classList.remove('holding'); clearTimeout(holdTimer); };
    el.addEventListener('pointerdown', start); el.addEventListener('keydown', start);
    ['pointerup', 'pointerleave', 'pointercancel', 'keyup', 'blur'].forEach(t => el.addEventListener(t, stop));
    el.addEventListener('contextmenu', e => e.preventDefault());
  });
}

/* ---------- overlays: role reveal, private results, cinematics, announcement ---------- */
let autoHideT = null, autoHideI = null;
function clearAutoHide() { clearTimeout(autoHideT); clearInterval(autoHideI); }
function openReveal(ids, label) { A.ui.overlay = { type: 'reveal', queue: ids, i: 0, stage: 'pass', label }; A.ui.sheet = null; render(); }
function openPrivate(pid, messages, title) { A.ui.overlay = { type: 'private', pid, messages, title, stage: 'pass' }; A.ui.sheet = null; render(); }
function closeOverlay() { clearAutoHide(); const ov = A.ui.overlay; A.ui.overlay = null; A.ui.pin = ''; render(); if (ov && ov.after) ov.after(); }
function renderOverlay(ov) {
  if (ov.type === 'reveal' || ov.type === 'private') return renderPrivateFlow(ov);
  if (ov.type === 'cine') return renderCine(ov);
  if (ov.type === 'announce') return renderAnnounce(ov);
  return '';
}
function renderPrivateFlow(ov) {
  const pid = ov.type === 'reveal' ? ov.queue[ov.i] : ov.pid;
  if (ov.stage === 'done') return renderReturnToGod(ov);
  const p = P(pid); if (!p) return '';
  if (ov.stage === 'pass') {
    const remaining = ov.type === 'reveal' ? ov.queue.length - ov.i : 1;
    return `<div class="full" role="dialog" aria-modal="true" aria-label="Pass the phone">
      ${icon('phone', 'xl')}
      <div class="who" style="margin-top:14px">Pass the phone to</div>
      <div class="bigname">${esc(p.name)}</div>
      <p class="ash" style="max-width:34ch;margin:0 0 26px">${ov.type === 'reveal' ? 'Only you should see the next screen. Hold the button to reveal your role.' : 'You have private information from the night. Hold the button to read it.'}</p>
      <button class="hold" data-hold="ov-show" data-ms="600" aria-label="Hold to reveal"><i class="fillbar"></i><span>Hold to reveal</span></button>
      ${ov.type === 'reveal' ? `<p class="tiny muted" style="margin-top:22px">${plural(remaining, 'player')} left to see their role</p>` : ''}
      <button class="btn ghost sm" style="margin-top:24px" data-hold="ov-exit" data-ms="1500" aria-label="Game Master: hold to exit"><span>Game Master: hold to exit</span></button>
    </div>`;
  }
  // stage: card
  if (ov.type === 'private') {
    const r = E.playerCard(A.s, pid);
    return `<div class="full" role="dialog" aria-modal="true" aria-label="Private result">
      <div class="rolecard" style="--team:var(--moon)">
        <div class="who">${esc(r.name)}${ov.title ? ' · ' + esc(ov.title) : ''}</div>
        <h2 class="display" style="font-size:30px">Your night</h2>
        ${(ov.messages || []).length ? ov.messages.map(m => `<div class="msg ${m.tag || 'result'}">${esc(m.text)}</div>`).join('') : '<p class="ash">Nothing to report tonight.</p>'}
        <div class="timer-ring" id="autohide" aria-live="polite"></div>
      </div>
      <button class="btn primary big" style="margin-top:22px" data-a="ov-hide">${icon('eyeoff')} Hide</button>
    </div>`;
  }
  const c = E.playerCard(A.s, pid);
  return `<div class="full" role="dialog" aria-modal="true" aria-label="Your role">
    <div class="rolecard" style="--team:${teamVar(c.team)}">
      <div class="row between"><div class="sig">${icon(c.icon, 'xl')}</div><span class="chip ${c.team}">${esc(c.teamName)}</span></div>
      <div class="who" style="margin-top:12px">${esc(c.name)}, you are the</div>
      <h2 class="display">${esc(c.roleName)}</h2>
      <p style="margin:6px 0 0;color:var(--bone)">${esc(c.desc)}</p>
      ${c.abilities.length ? `<div class="blk"><h4>Abilities</h4><ul>${c.abilities.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
      <div class="blk"><h4>You win when</h4><div>${esc(c.winText)}</div></div>
      ${c.teammates.length ? `<div class="blk"><h4>Your allies</h4>${c.teammates.map(t => `<div>${esc(t.name)} <span class="muted">· ${esc(t.role)}</span></div>`).join('')}</div>` : ''}
      ${c.target ? `<div class="blk"><h4>Your target</h4><div class="display" style="font-size:24px">${esc(c.target)}</div></div>` : ''}
      ${c.lover ? `<div class="blk"><h4>Your lover</h4><div>${esc(c.lover)}</div></div>` : ''}
      <div class="timer-ring" id="autohide" aria-live="polite"></div>
    </div>
    <button class="btn primary big" style="margin-top:22px" data-a="ov-hide">${icon('eyeoff')} Hide and pass the phone</button>
  </div>`;
}
function renderReturnToGod(ov) {
  const pin = A.s.config.godPin;
  return `<div class="full" role="dialog" aria-modal="true" aria-label="Return the phone">
    ${icon('phone', 'xl')}
    <div class="bigname" style="font-size:clamp(34px,8vw,60px)">${ov.type === 'reveal' && ov.queue.length > 1 ? 'Everyone has seen their role' : 'Card hidden'}</div>
    <p class="ash" style="max-width:36ch;margin:0 0 24px">Hand the phone back to the Game Master.</p>
    ${pin ? `<div class="who">Game Master PIN</div><div class="display" style="font-size:34px;letter-spacing:.4em;min-height:44px" aria-live="polite">${'•'.repeat(A.ui.pin.length)}</div>
      <div class="pin-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(d => d === '' ? '<span></span>' : `<button data-a="pin" data-v="${d}" aria-label="${d === '⌫' ? 'Delete' : d}">${d}</button>`).join('')}</div>`
      : `<button class="hold" data-hold="ov-exit" data-ms="1500"><i class="fillbar"></i><span>Game Master: hold to continue</span></button>`}
  </div>`;
}
function renderCine(ov) {
  const n = ov.n;
  if (ov.kind === 'night') return `<div class="full cine" role="dialog" aria-modal="true" aria-label="Night ${n}">
      ${moonHTML(n)}<div class="phase-big">Night ${n}</div>
      <div class="tagline">${n === 1 ? 'The city sleeps. Somewhere, a family is choosing.' : n % 2 === 0 ? 'A full moon rises over the city.' : 'The city sleeps. The Mafia awakens.'}</div>
      <p class="ash" style="margin-top:22px">Everyone close your eyes.</p>
      <button class="btn primary big" style="margin-top:28px" data-a="ov-close">${icon('moon')} Begin the night</button></div>`;
  return '';
}
function renderAnnounce(ov) {
  const ann = E.dawnAnnouncement(A.s, ov.n); const f = ov.format;
  const showRole = f === 'role' || f === 'full', showCause = f === 'cause' || f === 'full';
  const deaths = ann.deaths.map(d => `<div class="ann"><div class="n">${esc(d.name)}</div>
      ${showRole ? `<div class="r">${d.cleaned ? 'Their role could not be determined.' : d.role ? 'was the ' + esc(d.role) : 'Their role remains a secret.'}</div>` : ''}
      ${showCause && d.cause ? `<div class="r">${esc(d.cause[0].toUpperCase() + d.cause.slice(1))}.</div>` : ''}</div>`).join('');
  return `<div class="full cine" role="dialog" aria-modal="true" aria-label="Day ${ov.n} announcement">
    <div class="sun" aria-hidden="true"></div>
    <div class="phase-big">Day ${ov.n}</div>
    <div class="tagline">${ann.deaths.length ? (ann.deaths.length === 1 ? 'The town wakes to find one of its own gone.' : 'The town wakes to a terrible night.') : 'The town wakes. Everyone survived the night.'}</div>
    ${f === 'custom' ? `<div class="ann-list"><div class="ann"><div class="r" style="font-size:20px;color:var(--bone);white-space:pre-wrap">${esc(ov.custom || '')}</div></div></div>` : `<div class="ann-list">${deaths}${ann.notes.map(t => `<div class="ann"><div class="r" style="color:var(--bone)">${esc(t)}</div></div>`).join('')}</div>`}
    <button class="btn primary big" style="margin-top:22px" data-a="ov-close">${icon('sun')} Continue</button></div>`;
}
function startAutoHide() {
  clearAutoHide();
  const ov = A.ui.overlay; if (!ov || ov.stage !== 'card') return;
  let left = 20; const tick = () => { const el = document.getElementById('autohide'); if (el) el.textContent = `Hides automatically in ${left}s`; };
  tick(); autoHideI = setInterval(() => { left--; tick(); }, 1000);
  autoHideT = setTimeout(() => dispatch('ov-hide'), 20000);
}

/* ---------- action dispatch ---------- */
const H = {}; // handlers registered by views
function dispatch(a, v, el, ev) {
  const ov = A.ui.overlay;
  if (a === 'ov-show') { ov.stage = 'card'; Sound.tick(); render(); startAutoHide(); return; }
  if (a === 'ov-hide') {
    clearAutoHide();
    if (ov.type === 'reveal' && ov.i < ov.queue.length - 1) { ov.i++; ov.stage = 'pass'; }
    else ov.stage = 'done';
    render(); return;
  }
  if (a === 'ov-exit') { closeOverlay(); return; }
  if (a === 'ov-close') { closeOverlay(); return; }
  if (a === 'pin') {
    if (v === '⌫') A.ui.pin = A.ui.pin.slice(0, -1); else if (A.ui.pin.length < 4) A.ui.pin += v;
    if (A.ui.pin.length === 4) { if (A.ui.pin === String(A.s.config.godPin)) { closeOverlay(); return; } toast('Wrong PIN'); A.ui.pin = ''; }
    render(); return;
  }
  if (H[a]) { H[a](v, el, ev); return; }
  console.warn('No handler', a);
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]'); if (!el || el.disabled) return;
  if (el.closest('[data-hold]') && !el.dataset.a) return;
  e.preventDefault(); dispatch(el.dataset.a, el.dataset.v, el, e);
});
document.addEventListener('change', e => { const el = e.target.closest('[data-c]'); if (el && H[el.dataset.c]) H[el.dataset.c](el.value, el, e); });
document.addEventListener('input', e => { const el = e.target.closest('[data-i]'); if (el && H[el.dataset.i]) H[el.dataset.i](el.value, el, e); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && A.ui.sheet) { A.ui.sheet = null; render(); }
  const el = e.target.closest && e.target.closest('[data-enter]'); if (el && e.key === 'Enter') { e.preventDefault(); H[el.dataset.enter](el.value, el, e); }
});

/* ---------- render root ---------- */
function render() {
  document.body.dataset.phase = phaseKey();
  const app = $('#app'), ov = $('#ov'), sh = $('#sheet');
  if (A.ui.overlay) {
    app.innerHTML = ''; app.hidden = true; sh.innerHTML = ''; document.body.classList.remove('lock');
    ov.innerHTML = renderOverlay(A.ui.overlay); bindHolds();
    const f = ov.querySelector('button'); if (f) f.focus({ preventScroll: true });
  } else {
    ov.innerHTML = ''; app.hidden = false;
    const ae = document.activeElement; const fid = ae && ae.id; let ss = null; try { ss = ae && ae.selectionStart; } catch (e) {}
    app.innerHTML = renderApp();
    if (fid) { const el = document.getElementById(fid); if (el) { el.focus({ preventScroll: true }); try { if (ss != null) el.setSelectionRange(ss, ss); } catch (e) {} } }
    sh.innerHTML = A.ui.sheet ? renderSheet(A.ui.sheet) : '';
    document.body.classList.toggle('lock', !!A.ui.sheet);
    bindHolds(); afterRender();
  }
  Sound.sync(); renderToast();
}

/* Omertà — views part 1: shell, home, setup */
'use strict';

/* ---------- shell ---------- */
function renderApp() {
  if (A.ui.view === 'home') return viewHome();
  return `${topbar()}<div class="layout">${nav()}<main id="main">${viewBody()}</main></div>`;
}
function phaseLabel() {
  const s = A.s;
  if (s.phase === 'setup') return `${icon('users', 'sm')} Setup`;
  if (s.phase === 'night') return `${icon('moon', 'sm')} Night ${s.night}`;
  if (s.phase === 'dawn') return `${icon('moon', 'sm')} Dawn ${s.night}`;
  if (s.phase === 'day') return `${icon('sun', 'sm')} Day ${s.day}`;
  if (s.phase === 'ended') return `${icon('flag', 'sm')} Game over`;
  return '';
}
function topbar() {
  const last = A.hist[A.hist.length - 1];
  return `<header class="top">
    <button class="brand" data-a="go-home" aria-label="Omertà home">Omertà <small>Game Master</small></button>
    <span class="phasechip">${phaseLabel()}</span>${window.Online && Online.room ? `<span class="chip ok onlychip" title="Online room">${icon('phone', 'sm')} ${esc(Online.room.code)}</span>` : ''}
    <button class="iconbtn" data-a="undo" ${last ? '' : 'disabled'} aria-label="${last ? 'Undo: ' + esc(last.label) : 'Nothing to undo'}" title="${last ? 'Undo: ' + esc(last.label) : 'Nothing to undo'}">${icon('undo')}<span class="lbl">Undo</span></button>
    <button class="iconbtn" data-a="open-menu" aria-label="Game menu: restart, sound, new game" aria-haspopup="dialog">${icon('menu')}<span class="lbl">Menu</span></button>
  </header>`;
}
function nav() {
  const s = A.s; const v = A.ui.view;
  const alert = (s.winPrompt || s.pending.length) && v !== 'command';
  const items = [['command', s.phase === 'setup' ? 'Setup' : 'Game', 'command'], ['players', 'Players', 'users'], ['timeline', 'Timeline', 'clock'], ['roles', 'Roles', 'book'], ['settings', 'Rules', 'settings']];
  return `<nav class="nav" aria-label="Main">${items.map(([k, l, ic]) => `<button data-a="nav" data-v="${k}" ${v === k ? 'aria-current="page"' : ''} class="${k === 'command' && alert ? 'badge-dot' : ''}">${icon(ic)}<span>${l}</span></button>`).join('')}</nav>`;
}
function viewBody() {
  switch (A.ui.view) {
    case 'players': return viewPlayers();
    case 'timeline': return viewTimeline();
    case 'roles': return viewRoles();
    case 'settings': return viewSettings();
    default: return A.s.phase === 'setup' ? viewSetup() : viewGame();
  }
}

/* ---------- home ---------- */
function viewHome() {
  const s = A.s; const inProgress = s.phase !== 'setup' || s.players.length > 0;
  return `<header class="top"><span class="brand">Omertà <small>Game Master</small></span>
      <button class="iconbtn" data-a="open-menu" aria-label="Game menu: restart, sound, new game" aria-haspopup="dialog">${icon('menu')}<span class="lbl">Menu</span></button></header>
    <main><section class="home-hero">
      <div class="moonrow">${moonHTML(2)}</div>
      <h1 class="display">Omertà</h1>
      <p class="lead">Run a whole Mafia night from one phone. Deal roles in secret, record every night action, and let the rules engine resolve kills, heals, roleblocks and win conditions — while you keep the table guessing.</p>
      <div class="row" style="margin-top:6px">
        ${inProgress ? `<button class="btn primary big" data-a="resume">${icon('play')} Resume ${s.phase === 'setup' ? 'setup' : s.phase === 'ended' ? 'results' : (s.phase === 'day' ? 'Day ' + s.day : 'Night ' + s.night)}</button>
          ${s.phase === 'ended' ? `<button class="btn big" data-a="rematch">${icon('dice')} Rematch</button>` : ''}
          <button class="btn big" data-a="new-game">${icon('plus')} New game</button>`
        : `<button class="btn primary big" data-a="new-game">${icon('plus')} New game</button>`}
        <button class="btn ghost big" data-a="home-roles">${icon('book')} Browse ${E.allRoles(s).length} roles</button>
      </div>
    </section>
    <section class="grid g2" style="margin-bottom:60px">
      <div class="panel tight"><h3>1 · Add the players</h3><p class="ash small" style="margin:0">Type the names, or just a count. A balanced role list appears for that many players.</p></div>
      <div class="panel tight"><h3>2 · Pass the phone</h3><p class="ash small" style="margin:0">Each player holds to see their own role, then hides it. Nobody sees anyone else's.</p></div>
      <div class="panel tight"><h3>3 · Run the night</h3><p class="ash small" style="margin:0">Wake each role in order and tap their target. The engine resolves the night by the rules.</p></div>
    </section></main>`;
}

/* ---------- setup wizard ---------- */
const SETUP_STEPS = ['Players', 'Roles', 'Rules', 'Deal', 'Reveal'];
function roleCount() { return E.poolList(A.s.setup.pool).length; }
function setupBlocked(i) {
  const s = A.s; const n = s.players.length;
  if (i >= 1 && n < 5) return 'Add at least 5 players';
  if (i >= 3 && roleCount() !== n) return `Role list has ${roleCount()} roles for ${n} players`;
  if (i >= 4 && !s.setup.dealt) return 'Deal the roles first';
  return '';
}
function viewSetup() {
  const st = A.ui.setupStep;
  const wiz = `<div class="wizard" role="list">${SETUP_STEPS.map((l, i) => { const b = setupBlocked(i); return `<button role="listitem" data-a="setup-step" data-v="${i}" ${st === i ? 'aria-current="step"' : ''} class="${i < st ? 'done' : ''}" ${b && i > st ? 'disabled title="' + esc(b) + '"' : ''}><span class="n">${i < st ? '✓' : i + 1}</span>${l}</button>`; }).join('')}</div>`;
  const body = [stepPlayers, stepRoles, stepRules, stepDeal, stepReveal][st]();
  return wiz + body;
}
function footer(left, right) { return `<div class="footerbar"><div class="small ash">${left}</div><div class="row">${right}</div></div>`; }
function nextBtn(i, label) { const b = setupBlocked(i); return `<button class="btn primary" data-a="setup-step" data-v="${i}" ${b ? 'disabled' : ''}>${label} ${icon('chev', 'sm')}</button>`; }

function effN() { const s = A.s; return Math.max(5, Math.min(40, Math.max(s.players.length, s.setup.targetN || 10))); }
function autoPool(s) { if (!s.setup.poolTouched) s.setup.pool = E.recommend(Math.max(5, Math.min(40, Math.max(s.players.length, s.setup.targetN || 10))), s.setup.style, s.setup.seed, s).pool; }
function stepPlayers() {
  const s = A.s; const named = s.players.length; const N = effN();
  const list = s.players.map((p, i) => `<div class="prow">
      <span class="dot" style="--c:${p.color}"></span>
      <div><div style="font-weight:650">${esc(p.name)}</div></div>
      <div class="acts">
        <button class="iconbtn" data-a="rename-player" data-v="${p.id}" aria-label="Rename ${esc(p.name)}">${icon('edit', 'sm')}</button>
        <button class="iconbtn" data-a="move-player" data-v="${p.id}|-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(p.name)} up">${icon('up', 'sm')}</button>
        <button class="iconbtn" data-a="move-player" data-v="${p.id}|1" ${i === named - 1 ? 'disabled' : ''} aria-label="Move ${esc(p.name)} down">${icon('down', 'sm')}</button>
        <button class="iconbtn" data-a="del-player" data-v="${p.id}" aria-label="Remove ${esc(p.name)}">${icon('trash', 'sm')}</button>
      </div></div>`).join('');
  const quick = [6, 8, 10, 12, 15, 20, 25, 30];
  return `<h1 class="display" style="font-size:clamp(32px,7vw,54px)">How many players?</h1>
    <p class="lead">Pick a number and the best role mix for that size appears instantly. Names are optional.</p>
    <div class="setup0">
        <div class="panel a-count">
          <div class="row" style="justify-content:center;gap:18px">
            <button class="iconbtn" style="width:56px;height:56px;border-radius:16px" data-a="target-step" data-v="-1" ${N <= Math.max(5, named) ? 'disabled' : ''} aria-label="One fewer player">${icon('minus', 'lg')}</button>
            <div style="text-align:center;min-width:120px"><div class="display" style="font-size:88px;line-height:1;font-weight:600" aria-live="polite">${N}</div><div class="ash small">players</div></div>
            <button class="iconbtn" style="width:56px;height:56px;border-radius:16px" data-a="target-step" data-v="1" ${N >= 40 ? 'disabled' : ''} aria-label="One more player">${icon('plus', 'lg')}</button>
          </div>
          <label class="sr" for="tn">Number of players</label>
          <input id="tn" type="range" min="5" max="40" value="${N}" data-i="target-n" style="width:100%;margin-top:14px;accent-color:var(--ember);min-height:32px">
          <div class="chips-scroll" style="justify-content:safe center;margin-top:10px">${quick.map(q => `<button class="chip" style="cursor:pointer;min-height:36px" data-a="target-set" data-v="${q}" ${q < named ? 'disabled' : ''} aria-pressed="${q === N}">${q}</button>`).join('')}</div>
        </div>
        <div class="a-rec">${recommendCard()}</div>
        <div class="a-names stack"><div class="panel">
          <div class="row between"><h3>Names <span class="muted small">· optional</span></h3><span class="small ash">${named} of ${N} named</span></div>
          <div class="row" style="flex-wrap:nowrap;margin-top:8px"><label class="sr" for="pname">Player name</label><input id="pname" type="text" placeholder="e.g. Priya" data-enter="add-player" autocomplete="off" maxlength="24"><button class="btn primary" data-a="add-player">${icon('plus')} Add</button></div>
          <button class="btn ghost sm" style="margin-top:10px" data-a="toggle-bulk" aria-expanded="${A.ui.bulk}">${icon('copy', 'sm')} Paste a list of names</button>
          ${A.ui.bulk ? `<label class="field" style="margin-top:10px" for="bulk"><span>One name per line, or separated by commas</span><textarea id="bulk" placeholder="Monarch, Rahul, Priya, Arjun, Aman"></textarea></label><button class="btn sm" style="margin-top:8px" data-a="bulk-add">Add all</button>` : ''}
          <div style="margin-top:12px">${named ? list : `<p class="small muted" style="margin:0">Unnamed seats become Player 1, Player 2… and can be renamed any time.</p>`}</div>
        </div>
        <div class="panel">
          <div class="row between"><h3>${icon('users', 'sm')} Saved groups</h3>${named >= 2 ? `<button class="btn sm" data-a="group-save">${icon('save', 'sm')} Save current</button>` : ''}</div>
          ${A.groups.length ? `<div style="margin-top:8px">${A.groups.map((g, i) => `<div class="prow" style="grid-template-columns:minmax(0,1fr) auto"><div><b>${esc(g.name)}</b> <span class="muted small">· ${g.players.length} players</span></div><div class="acts"><button class="btn sm" data-a="group-load" data-v="${i}">Load</button><button class="iconbtn" data-a="group-del" data-v="${i}" aria-label="Delete group ${esc(g.name)}">${icon('trash', 'sm')}</button></div></div>`).join('')}</div>` : `<p class="small muted" style="margin:8px 0 0">Save a group of names to reuse next time.</p>`}
        </div>
        ${window.Online ? onlinePanel() : ''}</div>
    </div>
    ${footer(`${N} players${named ? ` · ${named} named` : ''}`, `<button class="btn primary" data-a="players-continue">Continue with ${N} players ${icon('chev', 'sm')}</button>`)}`;
}

function warnBlock() {
  const w = E.setupWarnings(A.s); if (!w.length) return '';
  return `<div class="panel tight section" role="status" style="border-color:color-mix(in srgb,var(--warn) 50%,transparent)"><h3 style="color:var(--warn)">${icon('alert', 'sm')} Check this setup</h3>${w.map(t => `<p class="small" style="margin:6px 0 0">${esc(t)}</p>`).join('')}<p class="tiny muted" style="margin:8px 0 0">These are warnings only — you can still play.</p></div>`;
}
function poolEq(a, b) { const k = o => JSON.stringify(Object.keys(o).filter(x => o[x] > 0).sort().map(x => [x, o[x]])); return k(a) === k(b); }
function roleChips(pool) {
  return Object.keys(pool).filter(k => pool[k] > 0).map(id => { const r = role(id); return r ? `<span class="chip ${r.team}">${icon(r.icon, 'sm')}${pool[id] > 1 ? pool[id] + '× ' : ''}${esc(r.name)}</span>` : ''; }).join(' ');
}
function balanceViz(pool) {
  const b = E.balanceOf(A.s, pool); const n = b.n || 1;
  const pct = Math.max(2, Math.min(98, ((b.score + 12) / 24) * 100));
  return `<div style="margin-top:14px">
    <div class="meter" role="img" aria-label="Town ${b.counts.town}, Mafia ${b.counts.mafia}, Neutral ${b.counts.neutral}">
      <i class="m-town" style="width:${b.counts.town / n * 100}%"></i><i class="m-mafia" style="width:${b.counts.mafia / n * 100}%"></i><i class="m-neutral" style="width:${b.counts.neutral / n * 100}%"></i></div>
    <div class="row small" style="margin-top:8px;gap:14px"><span style="color:var(--town)">Town ${b.counts.town}</span><span style="color:var(--mafia)">Mafia ${b.counts.mafia}</span><span style="color:var(--neutral)">Neutral ${b.counts.neutral}</span></div>
    <div class="scale" aria-label="Balance ${b.label}, score ${b.score}"><div class="line"></div><div class="band"></div><div class="pin" style="left:${pct}%"></div></div>
    <div class="row between small"><span class="muted">Evil-favored</span><b>${esc(b.label)} <span class="muted">(${b.score > 0 ? '+' : ''}${b.score})</span></b><span class="muted">Town-favored</span></div>
  </div>`;
}
function recommendCard() {
  const s = A.s; const n = s.phase === 'setup' && A.ui.setupStep === 0 ? effN() : Math.max(5, s.players.length);
  const st = s.setup.style; const rec = E.recommend(n, st, s.setup.seed, s); const inUse = poolEq(rec.pool, s.setup.pool);
  return `<div class="panel glow">
    <div class="row between"><div><div class="small" style="color:var(--accent);font-weight:700">Recommended for ${n} players</div><h3 class="display" style="font-size:24px">${E.STYLE_NAMES[st]} setup</h3></div>
      ${inUse ? `<span class="chip ok">${icon('check', 'sm')} In use</span>` : ''}</div>
    <div class="seg scroll" role="group" aria-label="Setup style" style="margin:12px 0">${Object.keys(E.STYLE_NAMES).map(k => `<button data-a="rec-style" data-v="${k}" aria-pressed="${st === k}">${E.STYLE_NAMES[k]}</button>`).join('')}</div>
    <div class="row" style="gap:6px">${roleChips(rec.pool)}</div>
    ${balanceViz(rec.pool)}
    <div class="row" style="margin-top:14px">
      ${inUse ? '' : `<button class="btn primary" data-a="rec-use">${icon('check')} Use this setup</button>`}
      <button class="btn" data-a="rec-reroll">${icon('dice')} Reroll</button>
      ${A.ui.setupStep === 0 ? `<button class="btn ghost" data-a="players-continue">Customize roles</button>` : ''}
    </div>
    <p class="tiny muted" style="margin:10px 0 0">${STYLE_HINT[st]}</p>
  </div>`;
}
const STYLE_HINT = {
  beginner: 'Only Villagers, Doctor, Police, Bodyguard, Mafia and Jester — ideal for a first game.',
  classic: 'The familiar Town investigators against a Godfather and plain Mafia members.',
  balanced: 'A mix tuned to sit inside the fair balance band, with a solo killer from 11 players.',
  chaos: 'Converters, Witch, Pirate, Cupid and the Drunk. Expect surprises; balance is looser.',
  advanced: 'The whole library: Transporter, Poisoner, Hunter, guessers and more.',
  large: 'Advanced roles with more Villagers, suited to 15–30 players.',
};

function stepRoles() {
  const s = A.s; const n = s.players.length; const R = roleCount();
  const tab = A.ui.poolTab; const q = A.ui.poolQuery.trim().toLowerCase();
  const inTab = r => tab === 'town' ? r.team === 'town' : tab === 'mafia' ? r.team === 'mafia' : tab === 'custom' ? r.custom : r.team !== 'town' && r.team !== 'mafia';
  const roles = E.allRoles(s).filter(r => r.id !== 'cultist' || s.setup.pool.cultist).filter(r => q ? (r.name + ' ' + r.short).toLowerCase().includes(q) : inTab(r));
  const rows = roles.map(r => { const c = s.setup.pool[r.id] || 0; return `<div class="poolrow ${c ? 'has' : ''}" style="--team:${teamVar(r.team)}">
      <div class="sig">${icon(r.icon)}</div>
      <div><div class="nm">${esc(r.name)} ${A.prefs.disabled.includes(r.id) ? '<span class="chip tiny">Off in library</span>' : ''}</div><div class="sh">${esc(r.short)}</div></div>
      <div class="counter"><button class="iconbtn" data-a="open-role" data-v="${r.id}" aria-label="About ${esc(r.name)}">${icon('info', 'sm')}</button>
        <button class="iconbtn" data-a="pool-dec" data-v="${r.id}" ${c ? '' : 'disabled'} aria-label="One fewer ${esc(r.name)}">${icon('minus', 'sm')}</button><b aria-label="${c} ${esc(r.name)}">${c}</b>
        <button class="iconbtn" data-a="pool-inc" data-v="${r.id}" aria-label="One more ${esc(r.name)}">${icon('plus', 'sm')}</button></div></div>`; }).join('');
  const diff = R - n;
  return `<h1 class="display" style="font-size:clamp(36px,7vw,54px)">Choose the roles</h1>
    <p class="lead">Start from the recommendation or build your own. The balance meter is advice only — chaotic games are allowed.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:16px;margin-top:18px">
      <div>${recommendCard()}
        <div class="panel" style="margin-top:16px"><h3>Your role list</h3>
          <div class="row" style="gap:6px;margin-top:8px">${R ? roleChips(s.setup.pool) : '<span class="muted">Empty.</span>'}</div>
          ${R ? balanceViz(s.setup.pool) : ''}
          <div class="divider"></div>
          <h3>Presets</h3>
          <div class="row" style="flex-wrap:nowrap;margin-top:8px"><input id="presetName" type="text" placeholder="Name this setup" maxlength="30" aria-label="Preset name"><button class="btn" data-a="preset-save" ${R ? '' : 'disabled'}>${icon('save')} Save</button></div>
          ${A.presets.length ? `<div style="margin-top:10px">${A.presets.map((p, i) => `<div class="prow" style="grid-template-columns:1fr auto"><div><b>${esc(p.name)}</b> <span class="muted small">· ${p.n} players</span></div><div class="acts"><button class="btn sm" data-a="preset-load" data-v="${i}">Load</button><button class="iconbtn" data-a="preset-del" data-v="${i}" aria-label="Delete preset ${esc(p.name)}">${icon('trash', 'sm')}</button></div></div>`).join('')}</div>` : '<p class="small muted" style="margin:8px 0 0">Saved setups appear here.</p>'}
        </div>
      </div>
      <div class="panel">
        <div class="row between"><div class="seg scroll" role="group" aria-label="Team">${[['town', 'Town'], ['mafia', 'Mafia'], ['neutral', 'Neutral'], ['custom', 'Custom']].map(([k, l]) => `<button data-a="pool-tab" data-v="${k}" aria-pressed="${tab === k && !q}">${l}</button>`).join('')}</div></div>
        <input id="poolq" type="search" placeholder="Search all roles" value="${esc(A.ui.poolQuery)}" data-i="poolq" style="margin-top:12px" aria-label="Search roles">
        <div style="margin-top:6px">${rows || `<div class="empty" style="margin-top:12px">${tab === 'custom' && !q ? 'No custom roles yet. Create one in the Roles tab.' : 'No roles match.'}</div>`}</div>
      </div>
    </div>
    ${warnBlock()}
    ${footer(`<b style="color:${diff === 0 ? 'var(--ok)' : 'var(--warn)'}">${R} roles</b> for ${plural(n, 'player')}${diff ? ` · ${diff > 0 ? 'remove ' + diff : 'add ' + -diff}` : ' ✓'}`,
      `${diff < 0 ? `<button class="btn" data-a="pool-fill">Fill with Villagers</button>` : ''}${diff > 0 ? `<button class="btn" data-a="pool-trim">Trim Villagers</button>` : ''}${nextBtn(2, 'Rules')}`)}`;
}

/* ---------- rules (shared by setup + settings) ---------- */
const rng = (a, b, f = x => String(x)) => Array.from({ length: b - a + 1 }, (_, i) => [a + i, f(a + i)]);
const CFG = [
  ['Deaths and reveals', [
    ['revealOnDeath', 'bool', 'Reveal roles on death', 'The Janitor can still hide a role.'],
    ['showCause', 'bool', 'Announce the cause of death'],
    ['announceAmnesiac', 'bool', 'Announce when an Amnesiac takes a role'],
  ]],
  ['Protection', [
    ['selfHeal', 'sel', 'Doctor self-heal', '', [['never', 'Never'], ['once', 'Once per game'], ['always', 'Every night']]],
    ['healMode', 'sel', 'A heal absorbs', 'Unstoppable attacks always get through.', [['all', 'Every attack up to Powerful'], ['one', 'One attack per heal']]],
    ['doctorNotified', 'bool', 'Tell the Doctor when their patient was attacked'],
  ]],
  ['Investigations', [
    ['godfatherInnocent', 'bool', 'Godfather fools the Police', 'Off: the Police get a thumbs up on the Godfather like any Mafia.'],
    ['nkSuspicious', 'bool', 'Police also give a thumbs up to killers', 'Serial Killer, Arsonist, Werewolf (full moons only) and Vampires. Off: only the Mafia.'],
  ]],
  ['Killing', [
    ['mafiaBackup', 'bool', 'Backup Mafia carrier', 'If the carrier is blocked or jailed, another member carries out the kill.'],
    ['promote', 'bool', 'A Mafioso or Mafia member takes over when the Godfather dies'],
    ['vigNight1', 'bool', 'Vigilante may shoot on Night 1'],
    ['vigTown', 'sel', 'When the Vigilante kills a Town member', '', [['guilt', 'They die of guilt next night'], ['lose', 'They lose their bullets'], ['nothing', 'Nothing happens']]],
    ['convertCap', 'sel', 'Largest size of the Cult or Vampires', '', rng(2, 8)],
  ]],
  ['Neutral roles', [
    ['jesterHaunt', 'bool', 'An executed Jester haunts one of their voters'],
    ['exeFallback', 'sel', 'An Executioner whose target dies another way becomes', '', [['jester', 'Jester'], ['survivor', 'Survivor']]],
    ['guessShots', 'sel', 'Guesser shots per game', 'Applies to roles dealt after the change.', rng(1, 5)],
    ['guessWrong', 'sel', 'A wrong guess', '', [['die', 'Kills the guesser'], ['lose', 'Ends their guessing'], ['nothing', 'Has no penalty']]],
  ]],
  ['Voting', [
    ['voteThreshold', 'sel', 'An execution needs', '', [['plurality', 'The most votes'], ['majority', 'A majority of voters']]],
    ['voteTie', 'sel', 'On a tie', '', [['none', 'Nobody is executed'], ['random', 'Pick one at random'], ['revote', 'Revote among the tied']]],
    ['allowSkip', 'bool', 'Allow a vote for no execution'],
    ['mayorWeight', 'sel', "A revealed Mayor's vote counts", '', rng(1, 5, x => x + '×')],
  ]],
  ['Winning', [
    ['parity', 'bool', 'A killing faction wins at parity', 'When it matches everyone else alive, it controls the vote.'],
    ['showdown', 'bool', 'Showdown for a living Jester or Executioner', 'Play one more day after a faction secures the win, so they can still pull it off.'],
  ]],
  ['Running the game', [
    ['bluffDead', 'bool', 'Call dead roles at night as a bluff', 'The table cannot tell which roles are gone.'],
    ['stalemateCycles', 'sel', 'Offer a draw after nights with no deaths', 'For endless standoffs, such as a Godfather and a Serial Killer who cannot kill each other.', [[0, 'Never'], [2, '2 nights'], [3, '3 nights'], [4, '4 nights'], [5, '5 nights']]],
    ['dayTimer', 'sel', 'Day discussion timer', '', [[0, 'Off'], [2, '2 min'], [3, '3 min'], [5, '5 min'], [8, '8 min'], [10, '10 min'], [15, '15 min']]],
  ]],
];
function configPanel() {
  const c = A.s.config;
  return CFG.map(([group, items]) => `<div class="panel tight" style="margin-top:12px"><h3>${group}</h3>${items.map(([k, t, label, desc, opts]) => t === 'bool'
    ? `<div class="toggle"><div><div class="t" id="cl-${k}">${label}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div><button class="switch" role="switch" aria-checked="${!!c[k]}" aria-labelledby="cl-${k}" data-a="cfg-toggle" data-v="${k}"></button></div>`
    : `<div class="toggle"><div style="flex:1"><label class="t" for="cf-${k}">${label}</label>${desc ? `<div class="d">${desc}</div>` : ''}</div><select id="cf-${k}" style="max-width:260px" data-c="cfg-set" data-key="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(c[k]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`).join('')}</div>`).join('');
}
function stepRules() {
  return `<h1 class="display" style="font-size:clamp(36px,7vw,54px)">House rules</h1>
    <p class="lead">Sensible defaults are already set. Change anything your group plays differently — you can adjust most of these mid-game too.</p>
    <div class="row" style="margin-top:12px"><button class="btn sm" data-a="cfg-reset">${icon('refresh', 'sm')} Restore defaults</button></div>
    ${configPanel()}
    ${footer('Rules saved automatically', nextBtn(3, 'Deal roles'))}`;
}

function stepDeal() {
  const s = A.s; const show = A.ui.showAssign; const pool = s.setup.pool; const ids = Object.keys(pool).filter(k => pool[k] > 0);
  const rows = s.players.map(p => {
    const r = p.roleId ? role(p.roleId) : null; const vis = show || A.ui.peek[p.id];
    const extra = [];
    if (s.setup.dealt && vis) {
      if (p.roleId === 'executioner' && p.meta.target) extra.push(`Target: ${esc(E.pname(s, p.meta.target))}`);
      if (p.roleId === 'guardian' && p.meta.target) extra.push(`Ward: ${esc(E.pname(s, p.meta.target))}`);
      if (p.roleId === 'drunk' && p.meta.fake) extra.push(`Believes they are the ${esc(role(p.meta.fake).name)}`);
    }
    return `<div class="prow"><span class="dot" style="--c:${p.color}"></span>
      <div><div style="font-weight:650">${esc(p.name)} ${p.lock ? `<span class="chip tiny" title="Hand-picked">${icon('lock', 'sm')} Locked</span>` : ''}</div>
        <div class="small ${r && vis ? '' : 'muted'}" style="${r && vis ? 'color:' + teamVar(p.team || r.team) : ''}">${r ? (vis ? esc(r.name) : 'Hidden') : 'Not dealt'}${extra.length ? ' · ' + extra.join(' · ') : ''}</div></div>
      <div class="acts" style="align-items:center">
        ${r && !show ? `<button class="iconbtn" data-a="peek" data-v="${p.id}" aria-label="${A.ui.peek[p.id] ? 'Hide' : 'Show'} ${esc(p.name)}'s role">${icon(A.ui.peek[p.id] ? 'eyeoff' : 'eye', 'sm')}</button>` : ''}
        <select aria-label="Hand-pick a role for ${esc(p.name)}" data-c="manual-role" data-pid="${p.id}" style="min-height:40px;max-width:150px;font-size:14px">
          <option value="">${p.lock ? 'Unlock' : 'Random'}</option>${ids.map(id => `<option value="${id}" ${p.lock && p.roleId === id ? 'selected' : ''}>${esc(role(id).name)}</option>`).join('')}</select></div></div>`;
  }).join('');
  return `<h1 class="display" style="font-size:clamp(36px,7vw,54px)">Deal the roles</h1>
    <p class="lead">Deal at random, or hand-pick a role for someone — hand-picked roles stay locked when you reshuffle. Keep this screen to yourself.</p>
    <div class="panel" style="margin-top:16px">
      <div class="row between"><div class="row">
        <button class="btn primary" data-a="deal">${icon('dice')} ${s.setup.dealt ? 'Reshuffle' : 'Deal at random'}</button>
        ${s.setup.dealt ? `<button class="btn" data-a="toggle-assign" aria-pressed="${show}">${icon(show ? 'eyeoff' : 'eye')} ${show ? 'Hide all' : 'Show all'}</button>` : ''}</div>
        ${s.setup.dealt ? `<span class="chip ok">${icon('check', 'sm')} Dealt</span>` : ''}</div>
      <div style="margin-top:10px">${rows}</div>
    </div>
    ${warnBlock()}
    ${footer(s.setup.dealt ? 'Roles are dealt. Hide them before handing the phone over.' : 'Deal before revealing.', nextBtn(4, 'Reveal'))}`;
}
function stepReveal() {
  const s = A.s; const done = s.setup.revealed;
  if (window.Online && Online.room) {
    const seats = Online.status.seats || []; const st = id => seats.find(x => x.id === id) || {};
    const seen = s.players.filter(p => st(p.id).seen).length; const notJoined = s.players.filter(p => !st(p.id).claimed);
    return `<h1 class="display" style="font-size:clamp(32px,7vw,54px)">Roles are on their phones</h1>
      <p class="lead">Each player holds the button on their own phone to see their role. Nobody needs to pass this phone around.</p>
      <div class="grid g2" style="margin-top:16px">
        <div class="panel glow"><h3>${seen} of ${s.players.length} have seen their role</h3>
          ${notJoined.length ? `<p class="small" style="color:var(--warn)">${icon('alert', 'sm')} Not joined yet: ${notJoined.map(p => esc(p.name)).join(', ')}. Show them their role on this phone instead.</p>` : '<p class="small ash">Everyone has joined.</p>'}
          <div class="row" style="margin-top:12px"><button class="btn primary big" data-a="start-game">${icon('moon')} Begin Night 1</button></div></div>
        <div class="panel"><h3>Show one player on this phone</h3><p class="ash small">For anyone without a phone, or whose phone died.</p>
          <div class="row" style="flex-wrap:nowrap"><select id="reveal-one" aria-label="Player">${s.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button class="btn" data-a="reveal-one">Show</button></div></div>
      </div><div class="section">${onlinePanel()}</div>`;
  }
  return `<h1 class="display" style="font-size:clamp(36px,7vw,54px)">Reveal the roles</h1>
    <p class="lead">Pass the phone around in seat order. Each player holds the button to see only their own role, then hides it before passing on. Mafia members also see their teammates.</p>
    <div class="grid g2" style="margin-top:16px">
      <div class="panel glow"><h3>${done ? 'Everyone has seen their role' : 'Reveal order'}</h3>
        <ol class="ash" style="margin:8px 0 16px;padding-left:22px;columns:2">${s.players.map(p => `<li>${esc(p.name)}</li>`).join('')}</ol>
        <div class="row">${done ? `<button class="btn primary big" data-a="start-game">${icon('moon')} Begin Night 1</button><button class="btn" data-a="reveal-all">Run the reveal again</button>`
          : `<button class="btn primary big" data-a="reveal-all">${icon('phone')} Start the reveal</button><button class="btn ghost" data-a="start-game">Skip — roles were shared another way</button>`}</div></div>
      <div class="panel"><h3>Show one player again</h3><p class="ash small">If someone missed their card or the phone went to the wrong person.</p>
        <div class="row" style="flex-wrap:nowrap"><select id="reveal-one" aria-label="Player">${s.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button class="btn" data-a="reveal-one">Show</button></div></div>
    </div>`;
}

/* Omertà — views part 2: the running game */
'use strict';

function hero() {
  const s = A.s;
  if (s.phase === 'night') return `<section class="hero">${moonHTML(s.night)}<div><div class="kicker">${s.night % 2 === 0 ? 'Full moon — the Werewolf hunts' : 'Waxing moon'}</div><h1 class="display">Night ${s.night}</h1><p>Wake each role in turn and record their choice. Order of entry doesn't matter — the engine resolves by priority.</p></div></section>`;
  if (s.phase === 'dawn') return `<section class="hero">${moonHTML(s.night)}<div><div class="kicker">Before the town wakes</div><h1 class="display">Dawn of Day ${s.night}</h1><p>Only you see this. Deliver private results, then announce the night to the table.</p></div></section>`;
  if (s.phase === 'day') return `<section class="hero"><div class="sun" aria-hidden="true"></div><div><div class="kicker">Discussion, accusations, a vote</div><h1 class="display">Day ${s.day}</h1><p>Let the town talk, handle day abilities, then run the vote.</p></div></section>`;
  return '';
}
function winBlock() {
  const s = A.s; let h = '';
  if (s.winPrompt) {
    const w = s.winPrompt;
    h += `<div class="winbanner section" role="alert"><div class="row between"><div><div class="small" style="color:var(--ember);font-weight:700">Win condition met</div>
      <h2 class="display" style="font-size:30px">${esc(E.factionName(s, w.faction))}${w.faction === 'draw' ? ' wins' : ' win' + (w.faction.startsWith('solo:') ? 's' : '')}</h2><p class="ash" style="margin:4px 0 0">${esc(w.reason)}</p>
      ${w.winners.length ? `<p class="small" style="margin:6px 0 0">Winners: ${w.winners.map(x => esc(E.pname(s, x.id))).join(', ')}</p>` : ''}</div></div>
      <div class="row" style="margin-top:14px"><button class="btn primary" data-a="end-game-win">${icon('flag')} End the game and reveal</button><button class="btn" data-a="dismiss-win">Keep playing</button></div></div>`;
  }
  if (!s.winPrompt && s.lastWin && s.lastWin.status === 'over') h += `<div class="showdown section" style="border-color:color-mix(in srgb,var(--ember) 55%,transparent);background:rgba(232,182,99,.07)"><div class="row between"><span><b>Win condition still met:</b> ${esc(E.factionName(s, s.lastWin.faction))}. You chose to keep playing.</span><button class="btn sm" data-a="end-game-win">${icon('flag', 'sm')} End the game</button></div></div>`;
  const sm = E.stalemate(s);
  if (sm && s.phase !== 'night') h += `<div class="winbanner section" role="alert"><div class="small" style="color:var(--ember);font-weight:700">Possible stalemate</div><h2 class="display" style="font-size:26px">Nobody has died for ${plural(sm.quietNights, 'night')}</h2>
    <p class="ash" style="margin:4px 0 0">If the survivors can't kill each other (say a Godfather and a Serial Killer, both with Basic defense), the game can't end on its own. Town of Salem calls this a draw.</p>
    <div class="row" style="margin-top:12px"><button class="btn primary" data-a="stalemate-draw">${icon('flag')} End as a draw</button><button class="btn" data-a="stalemate-ack">Keep playing</button></div></div>`;
  if (s.showdown) h += `<div class="showdown section"><b>Showdown.</b> ${esc(E.factionName(s, s.showdown.faction))} has secured the game, but ${s.showdown.pending.map(id => esc(E.pname(s, id))).join(' and ')} can still win. Play continues until the end of Day ${s.showdown.endsAfterDay}.</div>`;
  return h;
}
function viewGame() {
  const s = A.s;
  if (s.phase === 'ended') return viewEnded();
  let h = hero() + winBlock();
  if (s.phase === 'night') h += viewNight();
  else if (s.phase === 'dawn') h += viewDawn();
  else if (s.phase === 'day') h += viewDay();
  h += `<section class="section"><div class="row between"><h2>At a glance</h2><button class="btn ghost sm" data-a="nav" data-v="players">All players ${icon('chev', 'sm')}</button></div>${statsStrip()}<div class="pgrid" style="margin-top:12px">${s.players.map(pcard).join('')}</div></section>`;
  if (s.phase === 'dawn') h += `<div class="phasebar"><button class="btn primary big" data-a="start-day">${icon('sun')} Announce and start Day ${s.night}</button></div>`;
  if (s.phase === 'day' && s.dayState.done && !s.winPrompt) h += `<div class="phasebar">${s.pending.length ? '<span class="small ash" style="flex:1 1 100%">Resolve the prompt above first.</span>' : ''}<button class="btn primary big" data-a="end-day" ${s.pending.length ? 'disabled' : ''}>${icon('moon')} Begin Night ${s.day + 1}</button></div>`;
  return h;
}
function statsStrip() {
  const s = A.s; const al = s.players.filter(p => p.alive);
  const side = t => al.filter(p => (E.TEAM_INFO[p.team] || {}).side === t).length;
  return `<div class="stats" role="list">
    <div class="stat" role="listitem"><b>${al.length}</b><span>Alive</span></div>
    <div class="stat" role="listitem"><b>${s.players.length - al.length}</b><span>Dead</span></div>
    <div class="stat town" role="listitem"><b>${side('town')}</b><span>Town</span></div>
    <div class="stat mafia" role="listitem"><b>${side('mafia')}</b><span>Mafia</span></div>
    <div class="stat neutral" role="listitem"><b>${side('neutral')}</b><span>Neutral</span></div></div>`;
}
function fxChips(p) {
  const s = A.s; const c = [];
  if (!p.alive) { const d = s.deaths.slice().reverse().find(x => x.id === p.id); c.push(`<span class="chip dead">${icon('skull', 'sm')} Dead${d ? ' · ' + d.ph : ''}</span>`); }
  if (p.fx.revealed) c.push(`<span class="chip warn">Revealed</span>`);
  if (p.fx.doused) c.push(`<span class="chip solo">Doused</span>`);
  if (p.fx.poison) c.push(`<span class="chip mafia">Poisoned</span>`);
  if (p.fx.lover) c.push(`<span class="chip vampire">${icon('heart', 'sm')} ${esc(E.pname(s, p.fx.lover))}</span>`);
  if (s.phase === 'day' && p.fx.blackmailed === s.day) c.push(`<span class="chip warn">Can't speak</span>`);
  if (s.phase === 'day' && p.fx.silenced === s.day) c.push(`<span class="chip warn">Can't vote</span>`);
  if (p.fx.revived !== undefined && p.alive) c.push(`<span class="chip ok">Revived</span>`);
  if (s.phase === 'night') { const a = s.actions.find(x => x.actor === p.id && x.key === p.id); if (a && a.targets.length) c.push(`<span class="chip">→ ${a.targets.map(t => esc(E.pname(s, t))).join(' & ')}</span>`); }
  const r = role(p.roleId);
  if (r && p.alive) for (const ab of r.abilities || []) { const u = p.uses[ab.id]; if (typeof u === 'number') c.push(`<span class="chip ${u ? '' : 'dead'}">${u} ${esc(E.KINDS[ab.kind].verb.toLowerCase())}</span>`); }
  return c.join('');
}
function pcard(p) {
  const r = p.roleId ? role(p.roleId) : null;
  const rl = r ? (p.roleId === 'drunk' && p.meta.fake ? `Drunk <span class="muted">(as ${esc(role(p.meta.fake).name)})</span>` : esc(r.name)) : 'Not dealt';
  return `<button class="pcard ${teamCls(p.team)} ${p.alive ? '' : 'dead'}" data-a="open-player" data-v="${p.id}" aria-label="${esc(p.name)}, ${r ? esc(r.name) : 'no role'}, ${p.alive ? 'alive' : 'dead'}">
    <div class="nm"><span class="dot" style="--c:${p.color}"></span><span>${esc(p.name)}</span></div>
    <div class="rl">${r ? icon(r.icon, 'sm') : ''}${rl}</div>
    <div class="fx">${fxChips(p)}</div></button>`;
}

/* ---------- night console ---------- */
function nightUi() { const s = A.s; if (!s.nightUi || s.nightUi.night !== s.night) s.nightUi = { night: s.night, visited: {} }; return s.nightUi; }
function stepState(st) { const s = A.s; const nu = nightUi(); if (s.actions.some(a => a.key === st.key)) return 'done'; return nu.visited[st.key] ? 'skip' : ''; }
function viewNight() {
  const s = A.s; const steps = E.nightSteps(s);
  let idx = Math.max(0, Math.min(A.ui.nightIdx, steps.length));
  const recorded = steps.filter(st => stepState(st) === 'done').length;
  const handled = steps.filter(st => stepState(st)).length;
  const list = steps.map((st, i) => { const ss = stepState(st); return `<button class="step ${ss} ${st.type === 'bluff' ? 'bluff' : ''}" data-a="night-step" data-v="${i}" ${i === idx ? 'aria-current="step"' : ''}>
      <span class="st">${ss === 'done' ? '✓' : ss === 'skip' ? '–' : i + 1}</span><span>${esc(st.title)}${st.type === 'player' ? ` <span class="muted">· ${esc(E.pname(s, st.actor))}</span>` : ''}${st.type === 'bluff' ? ' <span class="muted">(bluff)</span>' : ''}</span></button>`; }).join('')
    + `<button class="step ${handled === steps.length ? 'done' : ''}" data-a="night-step" data-v="${steps.length}" ${idx === steps.length ? 'aria-current="step"' : ''}><span class="st">${icon('check', 'sm')}</span><span>Resolve the night</span></button>`;
  const body = idx >= steps.length ? nightSummary(steps) : stepPanel(steps[idx], idx, steps.length);
  return `<section class="section">
    <div class="nightmeta"><span><b style="color:var(--accent)">${handled === steps.length ? 'All roles called' : `Step ${Math.min(idx + 1, steps.length)} of ${steps.length}`}</b> · ${plural(recorded, 'action')} recorded</span>
      ${handled === steps.length && idx < steps.length ? `<button class="btn sm" data-a="night-step" data-v="${steps.length}">Resolve ${icon('chev', 'sm')}</button>` : ''}</div>
    <div class="console"><nav class="steps" aria-label="Night order">${list}</nav><div>${body}</div></div></section>`;
}
function initDraft(st) {
  const s = A.s; const ex = s.actions.find(a => a.key === st.key);
  if (st.type === 'faction') return { key: st.key, ab: st.kind, targets: ex ? ex.targets.slice() : [], opts: ex ? Object.assign({}, ex.opts) : {}, carrier: ex ? ex.actor : E.defaultCarrier(s, st.faction) };
  if (st.type === 'player') { const okAb = st.abilities.find(a => a.ok) || st.abilities[0]; return { key: st.key, ab: ex ? ex.ab : okAb.id, targets: ex ? ex.targets.slice() : [], opts: ex ? Object.assign({}, ex.opts) : {} }; }
  return { key: st.key };
}
function draftFor(st) { if (!A.ui.draft || A.ui.draft.key !== st.key) A.ui.draft = initDraft(st); return A.ui.draft; }
const SLOT_LABELS = { transport: ['First player', 'Second player'], control: ['Player to control', 'Their new target'], lovers: ['First lover', 'Second lover'] };
function targetGrid(actorId, abId, d, max = 1, kind = '') {
  const s = A.s; const slot = Math.min(d.targets.length, max - 1);
  const lt = E.legalTargets(s, actorId, abId, max > 1 ? (d.targets.length >= max ? max - 1 : d.targets.length) : 0, d.targets[0]);
  const labels = SLOT_LABELS[kind];
  return `${max > 1 ? `<p class="small ash" style="margin:0 0 8px">${labels ? `Tap the <b>${labels[Math.min(d.targets.length, 1)].toLowerCase()}</b>${d.targets.length >= 2 ? ' (tap a chosen player to remove them)' : ''}.` : 'Choose two players.'}</p>` : ''}
    <div class="targets">${lt.map(t => { const p = P(t.id); const sel = d.targets.indexOf(t.id); const pressed = sel >= 0;
      const disabled = !t.ok && !pressed;
      return `<button class="tgt" data-a="draft-target" data-v="${t.id}" aria-pressed="${pressed}" ${disabled ? 'disabled' : ''}><span class="dot" style="--c:${p.color}"></span><span>${esc(p.name)}${!t.ok && t.why ? `<span class="why">${esc(t.why)}</span>` : ''}</span>${pressed && max > 1 ? `<span class="tag">${labels ? labels[sel].split(' ')[0] : sel + 1}</span>` : ''}</button>`; }).join('')}</div>`;
}
function stepPanel(st, idx, total) {
  const s = A.s; const d = draftFor(st); let inner = '', can = false, okLabel = 'Confirm', head = '';
  if (st.type === 'bluff') {
    return `<div class="panel glow"><div class="row"><span class="sig" style="color:var(--dim)">${icon(role(st.key.slice(6)).icon, 'lg')}</span><h2>${esc(st.title)} <span class="muted small">(no one alive)</span></h2></div>
      <div class="script" style="margin-top:14px">${esc(st.title)}, wake up… <span class="muted">(pause a few seconds)</span> …${esc(st.title)}, go to sleep.</div>
      <p class="small ash">${esc(st.script)}</p><div class="actionbar"><button class="btn primary" data-a="night-skip">${icon('check')} Called — next</button></div></div>`;
  }
  if (st.type === 'faction') {
    const carrier = P(d.carrier); const strongUses = carrier && carrier.roleId === 'strongman' ? carrier.uses.strong || 0 : 0;
    head = `<div class="row"><span style="color:var(--${st.faction === 'mafia' ? 'mafia' : 'vamp'})">${icon(st.faction === 'mafia' ? 'fedora' : 'fang', 'lg')}</span><h2>${esc(st.title)}</h2></div>
      <div class="actors" style="margin-top:10px">${st.actors.map(id => `<span class="chip ${st.faction}">${esc(E.pname(s, id))} · ${esc(role(P(id).roleId).name)}</span>`).join('')}</div>`;
    inner = `<h3 style="margin-top:16px">Who carries it out?</h3><div class="targets" style="margin-top:8px">${st.actors.map(id => `<button class="tgt" data-a="draft-carrier" data-v="${id}" aria-pressed="${d.carrier === id}"><span class="dot" style="--c:${P(id).color}"></span>${esc(E.pname(s, id))}</button>`).join('')}</div>
      ${carrier && E.nightAbilities(s, carrier).length ? `<p class="small" style="color:var(--warn);margin:8px 0 0">${esc(carrier.name)} gives up their own ${esc(role(carrier.roleId).name)} ability tonight to carry out the ${st.faction === 'mafia' ? 'kill' : 'bite'}.${st.actors.length > 1 ? ' Pick someone else if you want them to use it.' : ' They are the only one who can.'}</p>` : ''}
      ${strongUses ? `<div class="toggle"><div><div class="t" id="sk-l">Strong kill (Unstoppable)</div><div class="d">${strongUses} left — pierces heals and jail.</div></div><button class="switch" role="switch" aria-checked="${!!d.opts.strong}" aria-labelledby="sk-l" data-a="draft-opt" data-v="strong"></button></div>` : ''}
      <h3 style="margin-top:16px">${st.faction === 'mafia' ? 'Choose the victim' : 'Choose who to bite'}</h3><div style="margin-top:8px">${targetGrid(d.carrier, st.kind, d)}</div>`;
    can = !!(d.carrier && d.targets[0]); okLabel = d.targets[0] ? `${st.faction === 'mafia' ? 'Kill' : 'Bite'} ${esc(E.pname(s, d.targets[0]))}` : 'Pick a target';
  } else {
    const actor = P(st.actor); const r = role(st.roleId);
    head = `<div class="row"><span class="sig" style="color:${teamVar(st.drunk ? 'town' : actor.team)}">${icon(r.icon, 'lg')}</span><div><h2>${esc(r.name)}</h2><div class="ash">${esc(actor.name)}</div></div></div>
      ${st.drunk ? `<p class="small" style="color:var(--warn);margin:10px 0 0">${icon('bottle', 'sm')} ${esc(actor.name)} is the Drunk. Record their choice as normal — it will have no effect.</p>` : ''}`;
    const abs = st.abilities;
    const ab = abs.find(a => a.id === d.ab) || abs[0];
    const carrying = s.actions.find(a => (a.key === 'mafia' || a.key === 'vampire') && a.actor === actor.id);
    if (carrying) {
      const what = carrying.key === 'mafia' ? 'Mafia kill' : 'Vampire bite';
      return `<div class="panel glow">${head}
        <div class="msg status" style="margin-top:14px"><b>${esc(actor.name)} is carrying out tonight's ${what}</b> (on ${esc(E.pname(s, carrying.targets[0]))}), so their own ${esc(role(st.roleId).name)} ability does not happen tonight. Wake them anyway so the table can't tell, then move on. To use their ability instead, pick a different carrier in the ${carrying.key === 'mafia' ? 'Mafia' : 'Vampire'} step.</div>
        <div class="row between small muted" style="margin-top:14px"><button class="btn ghost sm" data-a="night-step" data-v="${idx - 1}" ${idx ? '' : 'disabled'}>${icon('up', 'sm')} Previous</button><span>${idx + 1} / ${total}</span><button class="btn ghost sm" data-a="night-step" data-v="${idx + 1}">Next ${icon('down', 'sm')}</button></div>
        <div class="actionbar"><button class="btn primary" data-a="night-skip">${icon('check')}<span class="t">Called — next</span></button></div></div>`;
    }
    if (abs.length > 1) inner += `<div class="seg" role="group" aria-label="Ability" style="margin-top:14px">${abs.map(a => `<button data-a="draft-ab" data-v="${a.id}" aria-pressed="${a.id === ab.id}" ${a.ok ? '' : 'disabled title="' + esc(a.why) + '"'}>${esc(a.verb)}</button>`).join('')}</div>`;
    if (!ab.ok) { inner += `<p class="ash" style="margin-top:14px">${icon('info', 'sm')} ${esc(ab.why)}. Wake them anyway so nobody can tell, then move on.</p>`; can = false; }
    else {
      const t = ab.target; const k = ab.kind;
      if (t === 'self' || t === 'none') { inner += `<p class="ash" style="margin-top:14px">${t === 'self' ? 'Does the player use this ability tonight?' : 'This ability needs no target.'}</p>`; can = true; okLabel = esc(ab.verb); }
      else if (t === 'assigned') { const tg = actor.meta.target; inner += `<p style="margin-top:14px">Their ward is <b>${esc(E.pname(s, tg))}</b>. Shield them tonight?</p>`; can = true; okLabel = `${esc(ab.verb)} ${esc(E.pname(s, tg))}`; }
      else if (t === 'two') { inner += `<div style="margin-top:14px">${targetGrid(actor.id, ab.id, d, 2, k)}</div>`; can = d.targets.length === 2; okLabel = can ? `${esc(ab.verb)} ${d.targets.map(x => esc(E.pname(s, x))).join(' & ')}` : 'Pick two'; }
      else { inner += `<h3 style="margin-top:14px">${t === 'dead' || t === 'deadTown' ? 'Choose a dead player' : 'Choose a target'}</h3><div style="margin-top:8px">${targetGrid(actor.id, ab.id, d)}</div>`; can = !!d.targets[0]; okLabel = can ? `${esc(ab.verb)} ${esc(E.pname(s, d.targets[0]))}` : 'Pick a target'; }
      if (LIVE_KINDS.includes(k) && d.targets[0]) inner += liveAnswer(actor, ab, d);
      if (k === 'jail') { const ex = actor.uses.execute || 0; inner += `<div class="toggle"><div><div class="t" id="ex-l">Execute the prisoner</div><div class="d">${ex ? ex + ' left · Unstoppable' : 'No executions left'}</div></div><button class="switch" role="switch" ${ex ? '' : 'disabled'} aria-checked="${!!d.opts.execute}" aria-labelledby="ex-l" data-a="draft-opt" data-v="execute"></button></div>`; }
      if (k === 'hypnotize') { inner += `<label class="field" style="margin-top:14px" for="hyp"><span>Message to plant</span></label><select id="hyp" data-c="draft-msg">${E.HYPNO_MSGS.map(m => `<option ${d.opts.msg === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`; if (!d.opts.msg) d.opts.msg = E.HYPNO_MSGS[0]; }
      if (k === 'duel') { inner += `<h3 style="margin-top:16px">Who won the duel?</h3><p class="small ash" style="margin:2px 0 8px">Run a quick rock-paper-scissors between the Pirate and the target.</p><div class="seg" role="group" aria-label="Duel result"><button data-a="draft-duel" data-v="1" aria-pressed="${d.opts.won === true}">The Pirate won</button><button data-a="draft-duel" data-v="0" aria-pressed="${d.opts.won === false}">The target won</button></div>`; can = can && typeof d.opts.won === 'boolean'; }
      d.ab = ab.id;
    }
  }
  const scriptLine = st.type === 'faction' ? st.script : `${esc(role(st.roleId).name)}, wake up. ${scriptFor(st, d)}`;
  return `<div class="panel glow">${head}<div class="script" style="margin-top:14px">${scriptLine}</div>${inner}
    ${s.actions.some(a => a.key === st.key) ? `<p style="margin:14px 0 0"><span class="chip ok">${icon('check', 'sm')} Recorded — confirm again to change it</span></p>` : ''}
    <div class="row between small muted" style="margin-top:14px"><button class="btn ghost sm" data-a="night-step" data-v="${idx - 1}" ${idx ? '' : 'disabled'}>${icon('up', 'sm')} Previous</button><span>${idx + 1} / ${total}</span><button class="btn ghost sm" data-a="night-step" data-v="${idx + 1}">Next ${icon('down', 'sm')}</button></div>
    <div class="actionbar"><button class="btn primary" data-a="night-confirm" ${can ? '' : 'disabled'}>${icon('check')}<span class="t">${okLabel}</span></button>
      <button class="btn" data-a="night-skip">${st.type === 'faction' ? 'No ' + (st.faction === 'mafia' ? 'kill' : 'bite') : 'No action'}</button></div></div>`;
}
const LIVE_KINDS = ['checkSus', 'seekMafia', 'clue', 'checkRole', 'checkAlign', 'checkGun', 'medium'];
function liveAnswer(actor, ab, d) {
  const s = A.s; let pv;
  try { pv = E.previewResult(s, { key: actor.id, actor: actor.id, ab: ab.id, targets: d.targets.slice(), opts: {} }); } catch (e) { return ''; }
  if (pv.blocked) return `<div class="msg status" style="margin-top:14px">${esc(actor.name)} gets no answer tonight — ${pv.blocked === 'jailed' ? 'they are in jail' : pv.blocked === 'roleblocked' ? 'they were roleblocked' : 'their action is cancelled'}. Wake them anyway, but give no signal.</div>`;
  const m = pv.messages[0]; if (!m) return '';
  const moved = pv.about && pv.pointed && pv.about !== pv.pointed ? `<div class="small" style="color:var(--warn);margin-top:6px">${icon('swap', 'sm')} A Transporter or Witch moved this check: the answer is about ${esc(E.pname(s, pv.about))}, but ${esc(actor.name)} will think it is about ${esc(E.pname(s, pv.pointed))}. Signal it anyway.</div>` : '';
  if (ab.kind === 'checkSus' || ab.kind === 'seekMafia') {
    const up = /^Thumbs up/.test(m);
    return `<div class="panel tight" style="margin-top:14px;text-align:center;${up ? 'border-color:var(--mafia)' : ''}"><div class="small ash">Signal now</div><div class="display" style="font-size:30px;${up ? 'color:var(--mafia)' : ''}">${up ? 'Give a thumbs up' : ab.kind === 'checkSus' ? 'Give a thumbs down' : 'No thumbs up'}</div><div class="small ash">${esc(m)}</div>${moved}</div>`;
  }
  return `<div class="panel tight" style="margin-top:14px"><div class="small ash">Tell them now (or at dawn)</div><div style="font-weight:650;margin-top:4px">${esc(m)}</div>${moved}</div>`;
}
function scriptFor(st, d) {
  const ab = st.abilities.find(a => a.id === d.ab) || st.abilities[0];
  const map = { heal: 'Who will you protect tonight?', checkSus: 'Point at the player you think is Mafia.', clue: 'Who do you want to investigate?', checkRole: 'Whose role do you want to learn?', checkAlign: 'Whose loyalty do you want to learn?', checkGun: 'Who do you want to inspect?', kill: 'Who do you want to kill?', guard: 'Who will you guard?', roleblock: 'Who will you distract tonight?', jail: 'Who is in your cell tonight?', track: 'Who will you follow?', watch: 'Whose house will you watch?', count: 'Whose house will you watch?', alert: 'Will you go on alert tonight?', vest: 'Will you wear a vest tonight?', medium: 'Which of the dead do you want to contact?', transport: 'Which two players will you swap?', control: 'Who will you control, and whom will they target?', duel: 'Who do you challenge to a duel?', poison: 'Who do you want to poison?', frame: 'Who do you want to frame?', disguise: 'Who do you want to disguise?', clean: 'Whose body will you clean if they die?', douse: 'Who do you douse — or will you ignite?', ignite: 'Ignite everyone doused?', blackmail: 'Who do you want to blackmail?', silence: 'Who do you want to silence?', hypnotize: 'Who do you want to hypnotize?', ambush: 'Whose house will you wait outside?', lovers: 'Which two players fall in love?', shield: 'Will you shield your ward tonight?', rampage: 'Whose house will you rampage at?', recruit: 'Who will you recruit?', remember: 'Whose role do you want to remember?', revive: 'Whom will you raise from the dead?', oracle: 'Who do you want to mark?', seekMafia: 'Point at the player you think is Mafia.', spy: 'Listen in on the Mafia.', psychic: 'Receive your vision.' };
  return esc(map[ab.kind] || 'What do you do tonight?');
}
function actionText(a) {
  const s = A.s; const tn = a.targets.map(t => E.pname(s, t)).join(' & ');
  if (a.key === 'mafia' || a.key === 'vampire') return `${a.key === 'mafia' ? 'The Mafia' : 'The Vampires'} (${E.pname(s, a.actor)}) → ${a.key === 'mafia' ? 'kill' : 'bite'} ${tn}${a.opts.strong ? ' · strong kill' : ''}`;
  const p = P(a.actor); const r = E.effRole(s, p); const ab = (r.abilities || []).find(x => x.id === a.ab);
  return `${p.name} (${r.name}${p.roleId === 'drunk' ? ', Drunk' : ''}) → ${ab ? E.KINDS[ab.kind].verb.toLowerCase() : a.ab}${tn ? ' ' + tn : ''}${a.opts.execute ? ' · execute' : ''}${typeof a.opts.won === 'boolean' ? (a.opts.won ? ' · Pirate won' : ' · target won') : ''}`;
}
function nightSummary(steps) {
  const s = A.s; const missing = steps.filter(st => !stepState(st) && st.type !== 'bluff');
  return `<div class="panel glow"><h2>Ready to resolve Night ${s.night}</h2>
    <p class="ash">The engine applies jail, transports, control, roleblocks, protection, attacks, investigations and conversions in priority order.</p>
    ${s.actions.length ? `<ul style="margin:8px 0 0;padding-left:20px">${s.actions.map(a => { const forfeit = !a.key.match(/^(mafia|vampire)$/) && s.actions.some(f => (f.key === 'mafia' || f.key === 'vampire') && f.actor === a.actor); return `<li style="margin:4px 0">${esc(actionText(a))}${forfeit ? ' <span class="chip warn">won\'t happen — carrying the kill</span>' : ''}</li>`; }).join('')}</ul>` : '<p class="muted">No actions recorded — a quiet night.</p>'}
    ${missing.length ? `<p class="small" style="color:var(--warn);margin-top:12px">${icon('alert', 'sm')} Not yet called: ${missing.map(st => esc(st.title)).join(', ')}. They will count as no action.</p>` : ''}
    <div class="actionbar"><button class="btn primary" data-a="resolve-ask">${icon('moon')}<span class="t">Resolve Night ${s.night}</span></button><button class="btn ghost" data-a="restart-night">${icon('refresh', 'sm')} Restart</button></div></div>`;
}

/* ---------- prompts (Hunter / Jester haunt) ---------- */
function promptCards() {
  const s = A.s; if (!s.pending.length) return '';
  return s.pending.map(q => {
    const ch = E.promptChoices(s, q); const sel = (A.ui.promptSel || {})[q.id];
    const title = q.type === 'hunter' ? `${esc(E.pname(s, q.actor))} the Hunter takes a last shot` : `${esc(E.pname(s, q.actor))} the Jester chooses whom to haunt`;
    return `<div class="panel glow section" role="alert"><h2>${title}</h2><p class="ash">${q.type === 'hunter' ? 'Ask them now. The shot is Unstoppable and resolves immediately.' : 'Only players who voted for the Jester can be haunted. They die next night; nothing can stop it.'}</p>
      <div class="targets">${ch.map(id => `<button class="tgt" data-a="prompt-sel" data-v="${q.id}|${id}" aria-pressed="${sel === id}"><span class="dot" style="--c:${P(id).color}"></span>${esc(E.pname(s, id))}</button>`).join('')}</div>
      <div class="row" style="margin-top:14px"><button class="btn ${q.type === 'hunter' ? 'danger' : 'primary'}" data-a="prompt-go" data-v="${q.id}" ${sel ? '' : 'disabled'}>${q.type === 'hunter' ? icon('bow') + ' Shoot ' + (sel ? esc(E.pname(s, sel)) : '') : icon('jester') + ' Haunt ' + (sel ? esc(E.pname(s, sel)) : '')}</button><button class="btn ghost" data-a="prompt-skip" data-v="${q.id}">No ${q.type === 'hunter' ? 'shot' : 'haunt'}</button></div></div>`;
  }).join('');
}

/* ---------- dawn report ---------- */
function viewDawn() {
  const s = A.s; const N = s.night; const rep = s.reports[N] || { deaths: [], saves: [], messages: [], lines: [], publicNotes: [] };
  const fmt = A.ui.annFormat || (s.config.revealOnDeath && s.config.showCause ? 'full' : s.config.revealOnDeath ? 'role' : s.config.showCause ? 'cause' : 'name');
  const deaths = rep.deaths.length ? rep.deaths.map(d => { const r = role(d.role); return `<div class="prow" style="grid-template-columns:auto 1fr"><span style="color:var(--danger)">${icon('skull')}</span>
      <div><div style="font-weight:700;font-size:18px">${esc(E.pname(s, d.id))} <span class="chip ${d.team}">${esc(r.name)}</span> ${d.cleaned ? '<span class="chip warn">Role hidden by the Janitor</span>' : ''}</div>
      <div class="small ash">${esc(d.cause[0].toUpperCase() + d.cause.slice(1))}${d.killers.length ? ' · by ' + d.killers.map(k => esc(E.pname(s, k))).join(', ') : ''}${d.triggers.length ? ' · triggered ' + d.triggers.join(', ') : ''}</div></div></div>`; }).join('')
    : `<p class="ash" style="margin:0">Nobody died tonight.</p>`;
  const saves = rep.saves.length ? `<div class="small ash" style="margin-top:12px">${rep.saves.map(sv => `${icon('shield', 'sm')} ${esc(E.pname(s, sv.target))} survived (${esc(sv.cause)}) — ${sv.how === 'defense' ? 'own defense' : esc(sv.how)}${sv.by ? ' by ' + esc(E.pname(s, sv.by)) : ''}`).join('<br>')}</div>` : '';
  const byTo = {}; for (const m of rep.messages) (byTo[m.to] = byTo[m.to] || []).push(m);
  const deliver = Object.keys(byTo).map(pid => { const p = P(pid); const k = N + ':' + pid; const done = A.ui.delivered[k];
    return `<div class="panel tight" style="${done ? 'opacity:.6' : ''}"><div class="row between"><div><b>${esc(p.name)}</b> <span class="muted small">· ${esc(role(p.roleId).name)}${p.alive ? '' : ' · dead'}</span></div>${done ? `<span class="chip ok">${icon('check', 'sm')} Delivered</span>` : ''}</div>
      ${byTo[pid].map(m => `<div class="msg ${m.tag}">${esc(m.text)}</div>`).join('')}
      <div class="row" style="margin-top:10px"><button class="btn sm" data-a="show-private" data-v="${pid}">${icon('phone', 'sm')} Show to ${esc(p.name)}</button><button class="btn ghost sm" data-a="mark-delivered" data-v="${k}">${done ? 'Mark undelivered' : 'Told them'}</button></div></div>`; }).join('');
  const lastIsResolve = A.hist.length && /^Resolve Night/.test(A.hist[A.hist.length - 1].label);
  return `${promptCards()}
    <section class="section grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:16px">
      <div class="panel"><h2>What happened</h2><div style="margin-top:8px">${deaths}</div>${saves}
        ${rep.publicNotes.length ? `<div class="divider"></div>${rep.publicNotes.map(n => `<p style="margin:4px 0">${icon('info', 'sm')} ${esc(n)}</p>`).join('')}` : ''}
        <details style="margin-top:14px"><summary class="small ash" style="cursor:pointer;min-height:44px;display:flex;align-items:center">Full resolution log (${rep.lines.length} steps)</summary><ol class="small ash" style="padding-left:20px">${rep.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ol></details>
        ${lastIsResolve ? `<button class="btn ghost sm" style="margin-top:8px" data-a="undo">${icon('undo', 'sm')} Entered something wrong? Undo the resolution</button>` : ''}</div>
      <div><div class="panel"><h2>Private results</h2><p class="ash small">Pass the phone, or whisper. Results go only to the player named.</p>
        <div class="stack" style="margin-top:10px">${deliver || '<p class="muted">No private results tonight.</p>'}</div></div></div>
    </section>
    <section class="section panel glow"><h2>Announce the night</h2>
      <p class="ash small">Choose what the table hears. The announcement screen shows nothing else.</p>
      <div class="seg scroll" role="group" aria-label="Announcement format" style="margin-top:8px">${[['name', 'Names only'], ['role', 'Name + role'], ['cause', 'Name + cause'], ['full', 'Name, role + cause'], ['custom', 'Custom']].map(([k, l]) => `<button data-a="ann-format" data-v="${k}" aria-pressed="${fmt === k}">${l}</button>`).join('')}</div>
      ${fmt === 'custom' ? `<label class="field" for="annc" style="margin-top:12px"><span>Your announcement</span><textarea id="annc" data-i="ann-custom" placeholder="The town wakes to find…">${esc(A.ui.annCustom)}</textarea></label>` : ''}
      </section>`;
}

/* ---------- day ---------- */
function viewDay() {
  const s = A.s; const ds = s.dayState;
  const bm = s.players.filter(p => p.alive && p.fx.blackmailed === s.day), sl = s.players.filter(p => p.alive && p.fx.silenced === s.day);
  const notes = s.publicNotes.filter(n => n.ph === 'D' + s.day);
  let h = promptCards();
  if (bm.length || sl.length || notes.length) h += `<section class="section panel tight"><h3>Read out today</h3>
    ${bm.map(p => `<p style="margin:4px 0">${icon('envelope', 'sm')} <b>${esc(p.name)}</b> has been blackmailed and may not speak.</p>`).join('')}
    ${sl.map(p => `<p style="margin:4px 0">${icon('mute', 'sm')} <b>${esc(p.name)}</b> has been silenced and may not vote.</p>`).join('')}
    ${notes.map(n => `<p style="margin:4px 0">${icon('info', 'sm')} ${esc(n.text)}</p>`).join('')}</section>`;
  h += timerCard();
  h += `<section class="section">${voteCard()}</section>`;
  h += `<section class="section">${dayAbilitiesCard()}</section>`;
  h += `<div class="row" style="margin-top:12px"><button class="btn ghost sm" data-a="restart-day">${icon('restart', 'sm')} Restart Day ${s.day}</button></div>`;
  return h;
}
function timerCard() {
  const mins = A.s.config.dayTimer; if (!mins) return '';
  const t = A.ui.timer || (A.ui.timer = { running: false, left: mins * 60000, endAt: 0, total: mins * 60000 });
  return `<section class="section panel tight"><div class="timerrow"><div><div class="small ash">Discussion · ${mins} min</div><div id="timer-val" class="clock" aria-live="off">${fmtClock(timerLeft())}</div></div>
    <div class="row" style="margin-left:auto"><button class="btn sm ${t.running ? '' : 'primary'}" data-a="timer-toggle">${icon(t.running ? 'pause' : 'play', 'sm')} ${t.running ? 'Pause' : 'Start'}</button><button class="iconbtn" data-a="timer-reset" aria-label="Reset timer">${icon('refresh', 'sm')}</button></div></div></section>`;
}
function timerLeft() { const t = A.ui.timer; if (!t) return 0; return Math.max(0, t.running ? t.endAt - Date.now() : t.left); }
function fmtClock(ms) { const sec = Math.ceil(ms / 1000); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
function dayAbilitiesCard() {
  const s = A.s; const rows = [];
  for (const p of s.players.filter(p => p.alive)) {
    if (p.roleId === 'mayor' && !p.fx.revealed) rows.push(`<div class="prow" style="grid-template-columns:1fr auto"><div><b>${esc(p.name)}</b> <span class="muted small">· Mayor</span><div class="small ash">May reveal for a ${s.config.mayorWeight}× vote.</div></div><button class="btn sm" data-a="mayor-reveal" data-v="${p.id}">${icon('crown', 'sm')} Reveal</button></div>`);
    if (['goodguesser', 'evilguesser'].includes(p.roleId)) { const st = E.guessStatus(s, p); rows.push(`<div class="prow" style="grid-template-columns:1fr auto"><div><b>${esc(p.name)}</b> <span class="muted small">· ${esc(role(p.roleId).name)}</span><div class="small ash">${p.uses.guess || 0} shots left${st.ok ? '' : ' · ' + esc(st.why)}</div></div><button class="btn sm" data-a="guess-open" data-v="${p.id}" ${st.ok ? '' : 'disabled'}>${icon('dice', 'sm')} Guess</button></div>`); }
  }
  return `<div class="panel"><h3>Day abilities</h3>${rows.length ? rows.join('') : '<p class="muted small" style="margin:6px 0 0">No living player has a day ability right now.</p>'}</div>`;
}
function voteCard() {
  const s = A.s; const ds = s.dayState; const alive = s.players.filter(p => p.alive);
  if (ds.done) { const r = ds.result || {}; const t = r.target ? E.pname(s, r.target) : '';
    return `<div class="panel"><h2>The vote</h2><p style="font-size:18px">${r.type === 'execute' ? (r.spared ? `${esc(t)} was voted out — but survived.` : `${esc(t)} was executed${r.random ? ' (random tie-break)' : ''}.`) : esc(r.reason || 'No execution.')}</p></div>`; }
  if (!ds.open) {
    const noms = A.ui.nominees || []; const enough = alive.length >= 2;
    return `<div class="panel"><h2>The vote</h2><p class="ash small">${enough ? 'Select the players on trial, then open the vote.' : 'Fewer than two players are alive — no vote is possible.'}</p>
      ${enough ? `<div class="row" style="margin:6px 0 10px"><button class="btn sm" data-a="nom-all">Everyone alive</button><button class="btn ghost sm" data-a="nom-clear" ${noms.length ? '' : 'disabled'}>Clear</button></div>
      <div class="targets">${alive.map(p => `<button class="tgt" data-a="nom-toggle" data-v="${p.id}" aria-pressed="${noms.includes(p.id)}"><span class="dot" style="--c:${p.color}"></span>${esc(p.name)}</button>`).join('')}</div>` : ''}
      <div class="actionbar"><button class="btn primary" data-a="vote-open" ${noms.length && enough ? '' : 'disabled'}>${icon('hand')}<span class="t">Open vote${noms.length ? ' (' + noms.length + ')' : ''}</span></button><button class="btn ghost" data-a="vote-skip">Skip the vote</button></div></div>`;
  }
  const t = E.tally(s); const opts = ds.nominees.concat(s.config.allowSkip ? ['skip'] : []);
  let cur = A.ui.voteNominee; if (!opts.includes(cur)) cur = A.ui.voteNominee = opts[0];
  const nm = id => id === 'skip' ? 'No execution' : E.pname(s, id);
  const max = Math.max(1, ...Object.values(t.totals));
  const voters = alive.map(p => { const v = ds.votes[p.id]; const can = E.canVote(s, p); const w = E.voteWeight(s, p);
    return `<button class="tgt" data-a="vote-cast" data-v="${p.id}" aria-pressed="${v === cur}" ${can ? '' : 'disabled'}><span class="dot" style="--c:${p.color}"></span><span>${esc(p.name)}${!can ? '<span class="why">Silenced</span>' : v && v !== cur ? `<span class="why">→ ${esc(nm(v))}</span>` : ''}</span>${w > 1 ? `<span class="tag">${w}×</span>` : ''}</button>`; }).join('');
  const r = t.result;
  const preview = r.type === 'execute' ? `${esc(nm(r.target))} would be executed.` : r.type === 'revote' ? `Tie between ${r.tied.map(x => esc(nm(x))).join(' and ')} — a revote would follow.` : r.type === 'random' ? `Tie between ${r.tied.map(x => esc(nm(x))).join(' and ')} — one is picked at random.` : esc(r.reason);
  return `<div class="panel glow"><div class="row between"><h2>The vote${ds.round > 1 ? ` · round ${ds.round}` : ''}</h2><span class="chip">${t.cast} of ${t.totalW} votes cast</span></div>
    <p class="small ash">${window.Online && Online.room ? 'Votes from phones fill in by themselves. Tap for anyone voting by hand — a tap overrides their phone until they change it.' : 'Pick a name, then tap everyone voting for them. Tap again to take a vote back.'}</p>
    <div class="nominee-tabs seg scroll" role="group" aria-label="Voting for">${opts.map(o => `<button data-a="vote-nominee" data-v="${o}" aria-pressed="${o === cur}">${esc(nm(o))} · ${t.totals[o] || 0}</button>`).join('')}</div>
    <h3 style="margin-top:14px">Votes for ${esc(nm(cur))}</h3><div class="targets" style="margin-top:8px">${voters}</div>
    <div class="bars" style="margin-top:16px">${opts.map(o => `<div class="bar"><span class="small" style="font-weight:650">${esc(nm(o))}</span><div class="track"><div class="fill ${o === 'skip' ? 'skip' : ''}" style="width:${(t.totals[o] || 0) / max * 100}%"></div></div><b>${t.totals[o] || 0}</b></div>`).join('')}</div>
    <p style="margin:12px 0 0"><b>${preview}</b></p>
    <div class="actionbar"><button class="btn primary" data-a="vote-confirm">${icon('gavel')}<span class="t">Lock in the result</span></button><button class="btn ghost" data-a="vote-reset">Clear</button></div></div>`;
}

/* ---------- game over ---------- */
function viewEnded() {
  const s = A.s; const r = s.result; const st = E.stats(s); const wins = new Set(r.winners.map(w => w.id));
  const fate = p => { if (p.alive) return '<span style="color:var(--ok)">Survived</span>'; const d = s.deaths.slice().reverse().find(x => x.id === p.id); return `Died ${d ? d.ph + ' · ' + esc(d.cause) : ''}`; };
  const statBox = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  return `<section class="hero" style="grid-template-columns:1fr;text-align:center;justify-items:center;padding:20px 0">
      <span style="color:var(--ember)">${icon(r.faction === 'mafia' ? 'fedora' : r.faction === 'town' ? 'crown' : r.faction === 'draw' ? 'skull' : 'star', 'xl')}</span>
      <div class="kicker">The game is over</div>
      <h1 class="display" style="font-size:clamp(46px,10vw,96px)">${esc(r.factionName)} ${r.faction === 'draw' ? 'wins' : r.faction.startsWith('solo:') ? 'wins' : 'win'}</h1>
      <p style="text-align:center">${esc(r.reason)}</p></section>
    <section class="section panel glow"><h2>Winners</h2><div class="row" style="margin-top:10px">${r.winners.length ? r.winners.map(w => { const p = P(w.id); return `<span class="chip ${p.team}">${esc(p.name)} · ${esc(w.why)}</span>`; }).join('') : '<span class="muted">Nobody won.</span>'}</div></section>
    <section class="section panel"><h2>Every role, revealed</h2><div class="scrollx" style="margin-top:10px"><table class="dt"><thead><tr><th>Player</th><th>Role</th><th>Team</th><th>Fate</th><th>Result</th></tr></thead><tbody>
      ${s.players.map(p => { const ir = (s.initialRoles || []).find(x => x.id === p.id); const changed = ir && ir.roleId !== p.roleId; return `<tr><td><span class="dot" style="--c:${p.color};display:inline-block;margin-right:8px"></span>${esc(p.name)}</td><td>${esc(role(p.roleId).name)}${changed ? `<div class="tiny muted">started as ${esc(role(ir.roleId).name)}</div>` : ''}</td><td><span class="chip ${p.team}">${teamName(p.team)}</span></td><td class="small">${fate(p)}</td><td>${wins.has(p.id) ? '<b style="color:var(--ember)">Won</b>' : '<span class="muted">Lost</span>'}</td></tr>`; }).join('')}</tbody></table></div></section>
    <section class="section"><h2>The numbers</h2><div class="stats" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">
      ${statBox(st.nights, 'Nights')}${statBox(st.deaths, 'Deaths')}${statBox(st.mafiaKills, 'Mafia kills')}${statBox(st.townKills, 'Town kills')}${statBox(st.saves, 'Saves')}${statBox(st.investigations, 'Night results')}${statBox(st.executions, 'Executions')}${statBox(st.voteRounds, 'Vote rounds')}${statBox(fmtDur(st.duration), 'Duration')}</div>
      <div class="grid g2" style="margin-top:12px">
        <div class="panel tight"><div class="small muted">Most valuable player</div><div class="display" style="font-size:26px">${st.mvp ? esc(st.mvp.name) : '—'}</div></div>
        <div class="panel tight"><div class="small muted">Most targeted at night</div><div class="display" style="font-size:26px">${st.mostTargeted ? `${esc(st.mostTargeted.name)} <span class="small muted">· ${plural(st.mostTargeted.n, 'visit')}</span>` : '—'}</div></div>
        <div class="panel tight"><div class="small muted">Most kills</div><div class="display" style="font-size:26px">${st.mostKills ? `${esc(st.mostKills.name)} <span class="small muted">· ${st.mostKills.n}</span>` : '—'}</div></div></div></section>
    <section class="section row"><button class="btn primary big" data-a="rematch">${icon('dice')} Rematch — reshuffle &amp; go</button><button class="btn big" data-a="play-again">${icon('refresh')} Play again with these players</button><button class="btn big" data-a="new-game">${icon('plus')} New game</button><button class="btn ghost big" data-a="nav" data-v="timeline">${icon('clock')} Full timeline</button><button class="btn ghost big" data-a="export-log">${icon('download')} Export log</button></section>`;
}

/* Omertà — views part 3 (players, timeline, roles, settings), sheets, handlers, init */
'use strict';
const DEF_NAMES = ['None', 'Basic', 'Powerful', 'Invincible'];

/* ---------- players ---------- */
function viewPlayers() {
  const s = A.s; const f = A.ui.pfilter;
  const list = s.players.filter(p => f === 'all' || (f === 'alive' ? p.alive : !p.alive));
  return `<h1 class="display" style="font-size:clamp(34px,6vw,50px)">Players</h1>
    <p class="lead">Your eyes only. Tap a player for their abilities, night history and overrides.</p>
    <div class="row between" style="margin-top:12px"><div class="seg scroll" role="group" aria-label="Filter">${[['all', 'Everyone'], ['alive', 'Alive'], ['dead', 'Dead']].map(([k, l]) => `<button data-a="pfilter" data-v="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
      ${s.phase !== 'setup' ? `<span class="small ash">${s.players.filter(p => p.alive).length} alive · ${s.players.filter(p => !p.alive).length} dead</span>` : ''}</div>
    ${s.phase !== 'setup' ? statsStrip() : ''}
    <div class="pgrid" style="margin-top:14px">${list.map(pcard).join('') || '<div class="empty">No players here.</div>'}</div>`;
}
function playerHistory(p) {
  const s = A.s; const out = [];
  for (const [N, rep] of Object.entries(s.reports)) {
    const lines = [];
    const vis = rep.visits.filter(v => v.from === p.id);
    for (const v of vis) lines.push(`${E.KINDS[v.kind] ? E.KINDS[v.kind].verb : v.kind} → ${E.pname(s, v.to)}`);
    for (const c of rep.cancelled.filter(c => c.actor === p.id)) lines.push(`Action cancelled (${c.why})`);
    const msgs = rep.messages.filter(m => m.to === p.id).map(m => m.text);
    if (lines.length || msgs.length) out.push({ N, lines, msgs });
  }
  return out;
}
function sheetPlayer(id) {
  const s = A.s; const p = P(id); if (!p) return '';
  const r = p.roleId ? role(p.roleId) : null; const death = s.deaths.slice().reverse().find(d => d.id === p.id);
  const hist = playerHistory(p);
  return `<header><span class="sig" style="color:${teamVar(p.team)}">${r ? icon(r.icon, 'lg') : icon('user', 'lg')}</span><h2>${esc(p.name)}</h2><button class="iconbtn" data-a="sheet-close" aria-label="Close">${icon('x')}</button></header>
    ${r ? `<div class="row"><span class="chip ${p.team}">${teamName(p.team)}</span><span class="chip ${p.alive ? 'ok' : 'dead'}">${p.alive ? 'Alive' : 'Dead' + (death ? ' · ' + death.ph : '')}</span>${fxChips(p).replace(/<span class="chip dead">.*?<\/span>/, '')}</div>
      <h3 class="display" style="font-size:26px;margin-top:14px">${esc(r.name)}${p.roleId === 'drunk' && p.meta.fake ? ` <span class="small muted">believes they are the ${esc(role(p.meta.fake).name)}</span>` : ''}</h3>
      <p class="ash" style="margin:4px 0 0">${esc(r.desc)}</p>
      ${(r.abilities || []).length ? `<div class="divider"></div><h3>Abilities</h3><ul class="small" style="padding-left:18px">${r.abilities.map(a => `<li>${esc(E.describeAbility(s, p, a))}</li>`).join('')}${p.uses.execute !== undefined ? `<li>Execute · ${p.uses.execute} left</li>` : ''}</ul>` : ''}
      ${p.meta.target ? `<p class="small">${p.roleId === 'guardian' ? 'Ward' : 'Target'}: <b>${esc(E.pname(s, p.meta.target))}</b>${p.meta.won ? ' · objective complete' : ''}</p>` : ''}
      ${p.meta.duelWins ? `<p class="small">Duels won: ${p.meta.duelWins}/2</p>` : ''}
      ${death ? `<div class="msg status"><b>Death:</b> ${esc(death.cause)}${death.killers.length ? ' — by ' + death.killers.map(k => esc(E.pname(s, k))).join(', ') : ''}${death.cleaned ? ' · role hidden publicly' : ''}</div>` : ''}
      <div class="divider"></div><h3>Night history and known information</h3>
      ${hist.length ? hist.map(h => `<div class="msg"><b>Night ${h.N}</b>${h.lines.map(l => `<div class="small ash">${esc(l)}</div>`).join('')}${h.msgs.map(m => `<div class="small">“${esc(m)}”</div>`).join('')}</div>`).join('') : '<p class="small muted">Nothing yet.</p>'}` : '<p class="ash">Roles have not been dealt yet.</p>'}
    <div class="divider"></div><h3>Game Master tools</h3>
    <div class="row" style="margin-top:8px">
      ${r ? `<button class="btn sm" data-a="reveal-player" data-v="${p.id}">${icon('phone', 'sm')} Show their role privately</button>` : ''}
      <button class="btn sm" data-a="rename-player" data-v="${p.id}">${icon('edit', 'sm')} Rename</button>
      ${r && s.phase !== 'setup' && s.phase !== 'ended' ? `<button class="btn sm" data-a="setrole-ask" data-v="${p.id}">${icon('swap', 'sm')} Change role or team</button>
        ${p.alive ? `<button class="btn sm danger" data-a="kill-ask" data-v="${p.id}">${icon('skull', 'sm')} Kill</button>` : `<button class="btn sm" data-a="revive" data-v="${p.id}">${icon('ankh', 'sm')} Revive</button>`}` : ''}
    </div>`;
}

/* ---------- timeline ---------- */
function viewTimeline() {
  const s = A.s; const pub = A.ui.tlMode === 'public';
  const evs = s.events.filter(e => !pub || !e.secret);
  let ph = '', h = '';
  for (const e of evs) {
    if (e.ph !== ph) { ph = e.ph; h += `<div class="tl-ph">${ph === 'Setup' ? 'Setup' : (ph[0] === 'N' ? 'Night ' : 'Day ') + ph.slice(1)}</div>`; }
    const d = new Date(e.t);
    h += `<div class="tl-ev ${e.secret ? 'secret' : ''} ${e.type === 'death' ? 'death' : ''} ${e.type === 'win' ? 'win' : ''}"><time>${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</time><span>${e.secret && !pub ? icon('eyeoff', 'sm') + ' ' : ''}${esc(e.text)}</span></div>`;
  }
  return `<h1 class="display" style="font-size:clamp(34px,6vw,50px)">Timeline</h1>
    <p class="lead">Every action, death and vote. Lines marked with a closed eye are secret — switch to “Public only” before showing this to anyone.</p>
    <div class="row between" style="margin-top:12px"><div class="seg" role="group" aria-label="Show">${[['all', 'Everything'], ['public', 'Public only']].map(([k, l]) => `<button data-a="tl-mode" data-v="${k}" aria-pressed="${A.ui.tlMode === k}">${l}</button>`).join('')}</div>
      <div class="row"><button class="btn sm" data-a="export-log">${icon('download', 'sm')} Export log</button><button class="btn sm ghost" data-a="export-save">${icon('save', 'sm')} Save file</button></div></div>
    <div class="panel section">${evs.length ? `<div class="tl">${h}</div>` : '<div class="empty">Nothing has happened yet.</div>'}</div>`;
}

/* ---------- role library ---------- */
const LIB_FILTERS = [['all', 'All'], ['town', 'Town'], ['mafia', 'Mafia'], ['neutral', 'Neutral'], ['killing', 'Killing'], ['protective', 'Protective'], ['investigative', 'Investigative'], ['support', 'Support'], ['roleblock', 'Roleblock'], ['information', 'Information'], ['chaos', 'Chaos'], ['custom', 'Custom']];
function viewRoles() {
  const s = A.s; const f = A.ui.libFilter; const q = A.ui.libQuery.trim().toLowerCase();
  const roles = E.allRoles(s).filter(r => {
    if (q && !(r.name + ' ' + r.short + ' ' + r.desc).toLowerCase().includes(q)) return false;
    if (f === 'all') return true; if (f === 'town' || f === 'mafia') return r.team === f; if (f === 'neutral') return !['town', 'mafia'].includes(r.team);
    if (f === 'custom') return !!r.custom; return (r.tags || []).includes(f);
  });
  return `<div class="row between"><div><h1 class="display" style="font-size:clamp(34px,6vw,50px)">Role library</h1><p class="lead" style="margin:4px 0 0">${E.allRoles(s).length} roles. Turn a role off to keep it out of recommendations.</p></div>
      <button class="btn primary" data-a="custom-new">${icon('plus')} Create a role</button></div>
    <label class="sr" for="libq">Search roles</label><input id="libq" type="search" placeholder="Search by name or ability" value="${esc(A.ui.libQuery)}" data-i="libq" style="margin-top:14px">
    <div class="chips-scroll" style="margin-top:10px">${LIB_FILTERS.map(([k, l]) => `<button class="chip" style="cursor:pointer;min-height:36px" data-a="lib-filter" data-v="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
    <div class="grid g2" style="margin-top:14px">${roles.map(r => `<button class="rcard ${A.prefs.disabled.includes(r.id) ? 'off' : ''}" style="--team:${teamVar(r.team)}" data-a="open-role" data-v="${r.id}">
        <span class="sig">${icon(r.icon, 'lg')}</span>
        <span><span class="row between" style="gap:6px"><h3>${esc(r.name)}</h3><span class="diff" aria-label="Difficulty ${r.diff} of 3">${[1, 2, 3].map(i => `<i class="${i <= r.diff ? 'on' : ''}"></i>`).join('')}</span></span>
          <span class="chip ${r.team}" style="margin-top:4px">${teamName(r.team)}</span>${A.prefs.disabled.includes(r.id) ? ' <span class="chip">Off</span>' : ''}${r.custom ? ' <span class="chip warn">Custom</span>' : ''}
          <p>${esc(r.short)}</p></span></button>`).join('') || '<div class="empty">No roles match.</div>'}</div>`;
}
function sheetRole(id) {
  const s = A.s; const r = role(id); if (!r) return '';
  const sus = r.custom && typeof r.sus === 'boolean' ? r.sus : id === 'godfather' ? !s.config.godfatherInnocent : (r.team === 'solo' || r.team === 'vampire') ? s.config.nkSuspicious : r.team === 'mafia';
  const off = A.prefs.disabled.includes(id);
  const inUse = s.players.some(p => p.roleId === id) || (s.setup.pool[id] || 0) > 0;
  return `<header><span class="sig" style="color:${teamVar(r.team)}">${icon(r.icon, 'lg')}</span><h2>${esc(r.name)}</h2><button class="iconbtn" data-a="sheet-close" aria-label="Close">${icon('x')}</button></header>
    <div class="row"><span class="chip ${r.team}">${teamName(r.team)}</span>${(r.tags || []).map(t => `<span class="chip">${t}</span>`).join('')}<span class="chip">Difficulty ${r.diff}/3</span></div>
    <p style="margin-top:12px">${esc(r.desc)}</p>
    ${(r.abilities || []).length ? `<h3>Abilities</h3><ul class="small" style="padding-left:18px">${r.abilities.map(a => `<li>${esc(E.describeAbility(s, { uses: {} }, a))}${typeof a.uses === 'number' ? ` · ${a.uses} uses` : a.uses === 'guessShots' ? ` · ${s.config.guessShots} shots` : ''}${a.viaFaction ? ' · used through the Mafia kill' : ''}</li>`).join('')}</ul>` : ''}
    <h3>Wins when</h3><p class="small ash" style="margin-top:4px">${esc(r.winText)}</p>
    <h3>Under investigation</h3><div class="small ash" style="margin-top:4px">
      <div>Police: ${sus ? 'thumbs up' : 'thumbs down'}${id === 'werewolf' && sus ? ' (only on full moons)' : ''}</div>
      <div>Investigator clue group “${esc(E.CLUE_NAMES[r.clue] || r.clue)}”: ${esc(E.rolesInClue(s, r.clue).join(', '))}</div>
      <div>Gunsmith: ${r.gun ? 'carries a weapon' : 'unarmed'}</div>
      <div>Mafia Investigator: ${r.appearsTown ? 'Town' : teamName(r.team)}</div></div>
    <h3 style="margin-top:12px">Defenses</h3><div class="small ash" style="margin-top:4px">Night defense: ${DEF_NAMES[r.def || 0]}${r.rbImmune ? ' · cannot be roleblocked' : ''}${r.ctrlImmune ? ' · cannot be controlled' : ''}${r.trImmune ? ' · cannot be transported' : ''}</div>
    <div class="divider"></div>
    <div class="toggle"><div><div class="t" id="rt-l">Use in recommendations</div><div class="d">Off keeps this role out of suggested setups. You can still add it by hand.</div></div><button class="switch" role="switch" aria-checked="${!off}" aria-labelledby="rt-l" data-a="role-toggle" data-v="${id}"></button></div>
    ${s.phase === 'setup' ? `<div class="row" style="margin-top:12px"><button class="btn sm" data-a="pool-inc" data-v="${id}">${icon('plus', 'sm')} Add to role list (${s.setup.pool[id] || 0})</button></div>` : ''}
    ${r.custom ? `<div class="row" style="margin-top:12px"><button class="btn sm danger" data-a="custom-delete" data-v="${id}" ${inUse ? 'disabled title="In use in this game"' : ''}>${icon('trash', 'sm')} Delete custom role</button></div>` : ''}`;
}
function sheetCustom() {
  const sel = (id, opts, val) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const kinds = [['none', 'No night ability']].concat(E.CUSTOM_KINDS.map(k => [k, E.KINDS[k].verb + (E.KINDS[k].info ? ' (information)' : '')]));
  return `<header><span class="sig" style="color:var(--ember)">${icon('star', 'lg')}</span><h2>Create a role</h2><button class="iconbtn" data-a="sheet-close" aria-label="Close">${icon('x')}</button></header>
    <p class="small ash">Custom roles plug into the same rules engine as built-in ones: priority, roleblocks, protection and win conditions all apply.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
      <label class="field"><span>Name</span><input id="cr-name" type="text" maxlength="28" placeholder="e.g. Nurse"></label>
      <label class="field"><span>Icon</span>${sel('cr-icon', ROLE_ICONS.map(k => [k, k]), 'star')}</label>
      <label class="field"><span>Team</span>${sel('cr-team', [['town', 'Town'], ['mafia', 'Mafia'], ['solo', 'Solo killer'], ['neutral', 'Neutral (survive to win)']], 'town')}</label>
      <label class="field"><span>Night ability</span>${sel('cr-kind', kinds, 'heal')}</label>
      <label class="field"><span>Uses per game</span>${sel('cr-uses', [[0, 'Unlimited'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], 0)}</label>
      <label class="field"><span>Attack (if it kills)</span>${sel('cr-attack', [[1, 'Basic'], [2, 'Powerful'], [3, 'Unstoppable']], 1)}</label>
      <label class="field"><span>Night defense</span>${sel('cr-def', [[0, 'None'], [1, 'Basic'], [2, 'Powerful'], [3, 'Invincible']], 0)}</label>
      <label class="field"><span>Roleblock</span>${sel('cr-rb', [[0, 'Can be roleblocked'], [1, 'Immune']], 0)}</label>
      <label class="field"><span>Police answer</span>${sel('cr-sus', [['auto', 'By team — thumbs up only if Mafia'], [1, 'Always thumbs up'], [0, 'Always thumbs down']], 'auto')}</label>
      <label class="field"><span>Investigator clue group</span>${sel('cr-clue', Object.entries(E.CLUE_NAMES), 'common')}</label>
      <label class="field"><span>Nights</span>${sel('cr-nights', [['all', 'Every night'], ['notFirst', 'From Night 2'], ['even', 'Even nights only']], 'all')}</label>
    </div>
    <label class="field" style="margin-top:12px"><span>Description (shown on their role card)</span><textarea id="cr-desc" maxlength="300" placeholder="What the role does, in a sentence or two."></textarea></label>
    <div class="row" style="margin-top:14px"><button class="btn primary" data-a="custom-save">${icon('check')} Create role</button><button class="btn ghost" data-a="sheet-close">Cancel</button></div>`;
}

/* ---------- settings ---------- */
function viewSettings() {
  const s = A.s; const inGame = !['setup', 'ended'].includes(s.phase);
  const w = s.phase === 'setup' ? null : E.evaluateWin(s);
  const facs = {}; for (const p of s.players) { const k = E.factionKey(p); if (k === 'neutral') continue; (facs[k] = facs[k] || { alive: 0, total: 0 }); facs[k].total++; if (p.alive) facs[k].alive++; }
  const fx = s.players.reduce((n, p) => n + Object.keys(p.fx).length, 0);
  return `<h1 class="display" style="font-size:clamp(34px,6vw,50px)">Rules and settings</h1>
    <p class="lead">Rule changes apply from the next action. Everything is saved on this device.</p>
    <section class="section"><h2>House rules</h2><div class="row" style="margin-top:8px"><button class="btn sm" data-a="cfg-reset">${icon('refresh', 'sm')} Restore defaults</button></div>${configPanel()}</section>
    ${window.Online && Online.avail ? `<section class="section"><h2>Players' phones</h2><div style="margin-top:8px">${onlinePanel()}</div></section>` : ''}
    <section class="section grid g2">
      <div class="panel"><h3>Sound</h3><div class="toggle"><div><div class="t" id="snd-l">Atmosphere and effects</div><div class="d">Night drone, phase chimes and kill sounds. Synthesized on the device.</div></div><button class="switch" role="switch" aria-checked="${A.prefs.sound}" aria-labelledby="snd-l" data-a="toggle-sound"></button></div></div>
      <div class="panel"><h3>Game Master PIN</h3><p class="small ash">When set, leaving a player's private screen needs this 4-digit PIN instead of a long press.</p>
        <div class="row" style="flex-wrap:nowrap"><label class="sr" for="pin">PIN</label><input id="pin" type="password" inputmode="numeric" maxlength="4" placeholder="${s.config.godPin ? 'PIN is set' : '4 digits'}"><button class="btn" data-a="pin-set">Set</button>${s.config.godPin ? `<button class="btn ghost" data-a="pin-clear">Remove</button>` : ''}</div></div>
      <div class="panel"><h3>Save and restore</h3><p class="small ash">The game saves itself after every action. Export a file to move it to another device.</p>
        <div class="row"><button class="btn sm" data-a="export-save">${icon('download', 'sm')} Save file</button><button class="btn sm" data-a="import-open">${icon('copy', 'sm')} Import</button><button class="btn sm ghost" data-a="export-log">Export log</button></div></div>
      <div class="panel"><h3>Debug view</h3><p class="small ash">Engine state at a glance, for checking rulings mid-game.</p><button class="btn sm" data-a="debug-toggle" aria-expanded="${!!A.ui.debug}">${icon('bug', 'sm')} ${A.ui.debug ? 'Hide' : 'Show'} engine state</button></div>
    </section>
    ${A.ui.debug ? `<section class="section panel"><h2>Engine state</h2><div class="scrollx"><table class="dt" style="margin-top:10px"><tbody>
      <tr><th>Phase</th><td>${esc(s.phase)}</td></tr><tr><th>Night / Day</th><td>${s.night} / ${s.day}</td></tr>
      <tr><th>Alive</th><td>${s.players.filter(p => p.alive).length} of ${s.players.length}</td></tr>
      <tr><th>Recorded actions (tonight)</th><td>${s.actions.length}</td></tr><tr><th>Resolved nights</th><td>${Object.keys(s.reports).length}</td></tr>
      <tr><th>Active effects</th><td>${fx}</td></tr><tr><th>Scheduled effects</th><td>${s.scheduled.map(x => `${esc(x.type)} on ${esc(E.pname(s, x.target))} (N${x.night})`).join(', ') || 'None'}</td></tr>
      <tr><th>Pending prompts</th><td>${s.pending.map(q => esc(q.type) + ' · ' + esc(E.pname(s, q.actor))).join(', ') || 'None'}</td></tr>
      <tr><th>Showdown</th><td>${s.showdown ? 'until end of Day ' + s.showdown.endsAfterDay : 'No'}</td></tr>
      <tr><th>Win check</th><td>${w ? esc(w.status) + (w.faction ? ' · ' + esc(E.factionName(s, w.faction)) : '') : '—'}</td></tr>
      ${Object.entries(facs).map(([k, v]) => `<tr><th>${esc(E.factionName(s, k))}</th><td>${v.alive} alive of ${v.total} · ${w && w.faction === k ? '<b style="color:var(--ember)">has secured the win</b>' : v.alive ? 'contending' : 'eliminated'}</td></tr>`).join('')}
      <tr><th>Undo history</th><td>${A.hist.length} steps${A.hist.length ? ' · last: ' + esc(A.hist[A.hist.length - 1].label) : ''}</td></tr></tbody></table></div></section>` : ''}
    <section class="section panel" style="border-color:color-mix(in srgb,var(--danger) 40%,transparent)"><h2>Danger zone</h2>
      <div class="row" style="margin-top:10px">${inGame ? `<button class="btn danger" data-a="end-game">${icon('flag')} End the game now</button>` : ''}<button class="btn" data-a="new-game">${icon('plus')} Start a new game</button></div></section>`;
}

/* ---------- sheets ---------- */
function lastHist(label) { return A.hist.map(h => h.label).lastIndexOf(label); }
function sheetMenu() {
  const s = A.s; const inGame = !['setup'].includes(s.phase); const N = s.phase === 'day' ? s.day : s.night;
  const row = (act, ic, title, desc, opt = {}) => `<button class="menurow ${opt.danger ? 'danger' : ''}" data-a="${act}" ${opt.disabled ? 'disabled' : ''}><span class="mi">${icon(ic)}</span><span><span class="mt">${title}</span><br><span class="md">${desc}</span></span>${icon('chev', 'sm')}</button>`;
  let h = `<header><h2>Game menu</h2><button class="iconbtn" data-a="sheet-close" aria-label="Close">${icon('x')}</button></header>
    <div class="toggle"><div><div class="t" id="mnu-snd">Sound</div><div class="d">Night ambience, chimes and effects.</div></div><button class="switch" role="switch" aria-checked="${A.prefs.sound}" aria-labelledby="mnu-snd" data-a="toggle-sound"></button></div>`;
  if (inGame) {
    h += `<div class="menugroup">Restart</div>`;
    if (s.phase === 'night') h += row('restart-night', 'moon', `Restart Night ${N}`, 'Clear every action recorded tonight and start from the first role.');
    if (s.phase === 'dawn') h += row('restart-night', 'moon', `Restart Night ${N}`, 'Undo the night’s results and clear tonight’s actions.', { disabled: lastHist(`Resolve Night ${N}`) < 0 });
    if (s.phase === 'day') h += row('restart-day', 'sun', `Restart Day ${N}`, 'Undo today’s votes, executions and day abilities.', { disabled: lastHist(`Start Day ${N}`) < 0 });
    h += row('restart-same', 'restart', 'Restart the game — same roles', 'Back to Night 1. Everyone keeps the card they were dealt.', { disabled: !(s.initialRoles && s.initialRoles.length === s.players.length) });
    h += row('restart-reshuffle', 'dice', 'Reshuffle and restart', 'Same players and role list, new secret roles, then the reveal.');
    h += row('restart-setup', 'settings', 'Back to setup', 'Same players. Change roles or rules before dealing again.');
  }
  if (window.Online && Online.avail) h += `<div class="menugroup">Players' phones</div>${onlinePanel()}`;
  h += `<div class="menugroup">${inGame ? 'Start over' : 'Setup'}</div>`;
  h += row('new-game', 'plus', 'New game', inGame ? 'Clear everything, including the players.' : 'Clear the players and setup and start again.', { danger: true });
  h += `<p class="tiny muted" style="margin:12px 0 0">Every restart can be undone with Undo straight afterwards.</p>`;
  return h;
}
function confirmSheet(o) { A.ui.sheet = Object.assign({ type: 'confirm' }, o); render(); }
function renderSheet(sh) {
  let body = '';
  if (sh.type === 'confirm') body = `<header><h2>${esc(sh.title)}</h2><button class="iconbtn" data-a="sheet-close" aria-label="Close">${icon('x')}</button></header>${sh.html || `<p class="ash">${esc(sh.body || '')}</p>`}
    <div class="row" style="margin-top:18px"><button class="btn ${sh.danger ? 'danger' : 'primary'}" data-a="confirm-ok">${esc(sh.ok || 'Confirm')}</button><button class="btn ghost" data-a="sheet-close">Cancel</button></div>`;
  else if (sh.type === 'menu') body = sheetMenu();
  else if (sh.type === 'player') body = sheetPlayer(sh.id);
  else if (sh.type === 'role') body = sheetRole(sh.id);
  else if (sh.type === 'custom') body = sheetCustom();
  else if (sh.type === 'rename') { const p = P(sh.id); body = `<header><h2>Rename ${esc(p.name)}</h2><button class="iconbtn" data-a="sheet-close" aria-label="Close">${icon('x')}</button></header>
    <label class="field" for="rn"><span>Name</span></label><input id="rn" type="text" maxlength="24" value="${esc(p.name)}" data-enter="rename-go"><div class="row" style="margin-top:14px"><button class="btn primary" data-a="rename-go">Save</button></div>`; }
  else if (sh.type === 'kill') { const p = P(sh.id); body = `<header><h2>Kill ${esc(p.name)}?</h2><button class="iconbtn" data-a="sheet-close" aria-label="Close">${icon('x')}</button></header>
    <p class="ash">A Game Master kill bypasses all protection and fires death triggers (lovers, Hunter, promotions). You can undo it.</p>
    <label class="field" for="kcause"><span>Cause, for the record</span></label><input id="kcause" type="text" maxlength="60" value="removed by the Game Master">
    <div class="row" style="margin-top:14px"><button class="btn danger" data-a="kill-go" data-v="${p.id}">${icon('skull')} Kill ${esc(p.name)}</button><button class="btn ghost" data-a="sheet-close">Cancel</button></div>`; }
  else if (sh.type === 'setrole') { const p = P(sh.id); body = `<header><h2>Change ${esc(p.name)}</h2><button class="iconbtn" data-a="sheet-close" aria-label="Close">${icon('x')}</button></header>
    <p class="ash small">Use this to fix a mistake or apply a house ruling. Uses reset to the new role's defaults.</p>
    <label class="field" for="sr-role"><span>Role</span></label><select id="sr-role">${E.allRoles(A.s).map(r => `<option value="${r.id}" ${r.id === p.roleId ? 'selected' : ''}>${esc(r.name)} (${teamName(r.team)})</option>`).join('')}</select>
    <label class="field" for="sr-team" style="margin-top:10px"><span>Team</span></label><select id="sr-team"><option value="">Role's default team</option>${['town', 'mafia', 'cult', 'vampire', 'solo', 'neutral'].map(t => `<option value="${t}">${teamName(t)}</option>`).join('')}</select>
    <div class="row" style="margin-top:14px"><button class="btn primary" data-a="setrole-go" data-v="${p.id}">Apply</button><button class="btn ghost" data-a="sheet-close">Cancel</button></div>`; }
  else if (sh.type === 'guess') { const s = A.s; const g = P(sh.id); const poolIds = Object.keys(s.setup.pool).filter(k => s.setup.pool[k] > 0);
    const others = E.allRoles(s).filter(r => !poolIds.includes(r.id));
    body = `<header><h2>${esc(g.name)} makes a guess</h2><button class="iconbtn" data-a="sheet-close" aria-label="Close">${icon('x')}</button></header>
    <p class="ash small">Right: the target is shot (Unstoppable). Wrong: ${s.config.guessWrong === 'die' ? 'the guesser dies' : s.config.guessWrong === 'lose' ? 'the guesser loses their guesses' : 'nothing happens'}. ${g.uses.guess || 0} shot${g.uses.guess === 1 ? '' : 's'} left.</p>
    <label class="field" for="g-t"><span>Target</span></label><select id="g-t">${s.players.filter(p => p.alive && p.id !== g.id).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
    <label class="field" for="g-r" style="margin-top:10px"><span>Guessed role</span></label><select id="g-r"><optgroup label="In this game's role list">${poolIds.map(id => `<option value="${id}">${esc(role(id).name)}</option>`).join('')}</optgroup><optgroup label="Other roles">${others.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</optgroup></select>
    <div class="row" style="margin-top:14px"><button class="btn danger" data-a="guess-go" data-v="${g.id}">${icon('dice')} Lock in the guess</button><button class="btn ghost" data-a="sheet-close">Cancel</button></div>`; }
  else if (sh.type === 'import') body = `<header><h2>Import a save</h2><button class="iconbtn" data-a="sheet-close" aria-label="Close">${icon('x')}</button></header>
    <p class="ash small">Paste the contents of an Omertà save file. This replaces the current game.</p><label class="sr" for="imp">Save data</label><textarea id="imp" style="min-height:160px" placeholder='{"v":1, …}'></textarea>
    <div class="row" style="margin-top:14px"><button class="btn primary" data-a="import-go">Import</button><button class="btn ghost" data-a="sheet-close">Cancel</button></div>`;
  else if (sh.type === 'copytext') body = `<header><h2>${esc(sh.title)}</h2><button class="iconbtn" data-a="sheet-close" aria-label="Close">${icon('x')}</button></header>
    <p class="ash small">Saving files isn't available here, so select this text and copy it.</p><label class="sr" for="cpt">Text</label><textarea id="cpt" readonly style="min-height:220px;font-size:13px">${esc(sh.text)}</textarea>`;
  return `<div class="scrim" data-a="sheet-close"><div class="sheet" role="dialog" aria-modal="true" data-a="noop"><div class="grab" aria-hidden="true"></div>${body}</div></div>`;
}
function afterRender() {
  const sh = A.ui.sheet;
  if (sh && !sh._focused) { sh._focused = true; const el = document.querySelector('.sheet input:not([type=hidden]), .sheet textarea, .sheet .btn, .sheet button'); if (el) el.focus({ preventScroll: true }); }
}

/* ---------- handlers ---------- */
const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
const top0 = () => window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
function resetUi() { Object.assign(A.ui, { nightIdx: 0, draft: null, sheet: null, peek: {}, showAssign: false, delivered: {}, timer: null, nominees: [], voteNominee: null, promptSel: {}, annFormat: null, annCustom: '' }); }
function newGameNow() {
  const fresh = s => { const n = E.newGame(); for (const r of A.customLib) n.customRoles[r.id] = r; n.setup.disabled = A.prefs.disabled.slice(); return n; };
  if (A.s.phase === 'setup' && !A.s.players.length) A.s = fresh(); else cmd('New game', fresh);
  resetUi(); Object.assign(A.ui, { setupStep: 0, nightIdx: 0, draft: null, sheet: null, view: 'command', peek: {}, showAssign: false, delivered: {}, timer: null });
  save(); top0(); render();
}
function afterPlayersChange(s) {
  s.setup.dealt = false; s.setup.revealed = false;
  for (const p of s.players) if (!p.lock) p.roleId = null;
  if (s.players.length > (s.setup.targetN || 0)) s.setup.targetN = s.players.length;
  autoPool(s);
}
function setupMut(fn) { fn(A.s); save(); render(); }
function nightCurrent() { return E.nightSteps(A.s)[A.ui.nightIdx]; }
function nightAdvance() {
  const steps = E.nightSteps(A.s); let i = A.ui.nightIdx + 1;
  while (i < steps.length && stepState(steps[i])) i++;
  A.ui.nightIdx = i; A.ui.draft = null;
  const c = document.querySelector('.console'); render(); const c2 = document.querySelector('.console'); if (c2 && c2.getBoundingClientRect().top < 0) c2.scrollIntoView({ block: 'start' });
}
Object.assign(H, {
  noop() {}, 'sheet-close'() { A.ui.sheet = null; render(); },
  'confirm-ok'() { const fn = A.ui.sheet && A.ui.sheet.onOk; A.ui.sheet = null; if (fn) fn(); render(); },
  undo() { undo(); },
  'toggle-sound'() { A.prefs.sound = !A.prefs.sound; savePrefs(); if (A.prefs.sound) { Sound.init(); Sound.confirm(); } render(); },
  nav(v) { A.ui.view = v; A.ui.sheet = null; top0(); render(); },
  'go-home'() { A.ui.view = 'home'; A.ui.sheet = null; render(); },
  resume() { A.ui.view = 'command'; render(); },
  'home-roles'() { A.ui.view = 'roles'; render(); },
  'new-game'() {
    const s = A.s; if (s.phase === 'setup' && !s.players.length) { newGameNow(); return; }
    confirmSheet({ title: 'Start a new game?', body: s.phase === 'ended' ? 'The finished game will be replaced. Export its log first if you want a record.' : 'The current game will be replaced. Export a save file first if you want to keep it.', ok: 'Start a new game', danger: s.phase !== 'ended', onOk: newGameNow });
  },
  /* setup */
  'setup-step'(v) { const i = +v; const b = setupBlocked(i); if (b && i > A.ui.setupStep) { toast(b); return; } A.ui.setupStep = i; top0(); render(); },
  'target-step'(v) { setupMut(s => { s.setup.targetN = Math.max(5, s.players.length, Math.min(40, effN() + +v)); autoPool(s); }); },
  'target-set'(v) { setupMut(s => { s.setup.targetN = Math.max(+v, s.players.length); autoPool(s); }); },
  'target-n'(v) { setupMut(s => { s.setup.targetN = Math.max(+v, s.players.length); autoPool(s); }); },
  'players-continue'() {
    const N = effN();
    cmd(`Set up ${N} players`, s => {
      let k = 1; while (s.players.length < N) { let name; do { name = 'Player ' + k++; } while (s.players.some(p => p.name === name)); E.addPlayer(s, name); }
      afterPlayersChange(s);
    });
    A.ui.setupStep = 1; top0(); render();
  },
  'add-player'() {
    const name = val('pname').trim(); const s = A.s;
    if (!name) { const el = document.getElementById('pname'); if (el) el.focus(); return; }
    if (s.players.length >= 40) { toast('40 players is the maximum.'); return; }
    if (s.players.some(p => p.name.toLowerCase() === name.toLowerCase())) { toast(`${name} is already in the game.`); return; }
    const ph = s.players.find(p => /^Player \d+$/.test(p.name));
    cmd(ph ? `Rename seat to ${name}` : `Add ${name}`, s2 => { if (ph) { E.getP(s2, ph.id).name = name.slice(0, 24); return; } E.addPlayer(s2, name); afterPlayersChange(s2); });
    const el = document.getElementById('pname'); if (el) { el.value = ''; el.focus(); }
  },
  'toggle-bulk'() { A.ui.bulk = !A.ui.bulk; render(); },
  'bulk-add'() {
    const names = val('bulk').split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
    if (!names.length) { toast('Paste at least one name.'); return; }
    cmd(`Add ${plural(names.length, 'player')}`, s => {
      for (const n of names) {
        if (s.players.some(p => p.name.toLowerCase() === n.toLowerCase())) continue;
        const ph = s.players.find(p => /^Player \d+$/.test(p.name));
        if (ph) ph.name = n.slice(0, 24); else if (s.players.length < 40) E.addPlayer(s, n);
      }
      afterPlayersChange(s);
    });
    A.ui.bulk = false; render();
  },
  'rename-player'(v) { A.ui.sheet = { type: 'rename', id: v }; render(); },
  'rename-go'() {
    const id = A.ui.sheet.id; const name = val('rn').trim(); if (!name) { toast('Enter a name.'); return; }
    if (A.s.players.some(p => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) { toast('Another player already has that name.'); return; }
    A.ui.sheet = null; cmd(`Rename to ${name}`, s => { E.getP(s, id).name = name.slice(0, 24); });
  },
  'move-player'(v) { const [id, d] = v.split('|'); cmd('Reorder players', s => { const i = s.players.findIndex(p => p.id === id); const j = i + +d; if (j < 0 || j >= s.players.length) return; [s.players[i], s.players[j]] = [s.players[j], s.players[i]]; }); },
  'del-player'(v) { const p = P(v); cmd(`Remove ${p.name}`, s => { s.players = s.players.filter(x => x.id !== v); if ((s.setup.targetN || 0) > Math.max(5, s.players.length) && s.setup.targetN > s.players.length) {} afterPlayersChange(s); }); },
  'group-save'() {
    const names = A.s.players.map(p => p.name);
    if (names.length < 2) { toast('Add at least 2 players first.'); return; }
    const label = names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '');
    A.groups.push({ name: label.slice(0, 40), players: names }); LS.set(GKEY, A.groups); toast('Group saved'); render();
  },
  'group-load'(v) {
    const g = A.groups[+v]; if (!g) return;
    cmd(`Load group "${g.name}"`, s => {
      s.players = []; for (const n of g.players) E.addPlayer(s, n);
      afterPlayersChange(s);
    });
    toast(`Loaded "${g.name}"`);
  },
  'group-del'(v) { const g = A.groups[+v]; confirmSheet({ title: `Delete "${g.name}"?`, body: 'This removes the saved group from this device.', ok: 'Delete', danger: true, onOk: () => { A.groups.splice(+v, 1); LS.set(GKEY, A.groups); } }); },
  'rec-style'(v) { setupMut(s => { s.setup.style = v; s.setup.seed = 1; s.setup.poolTouched = false; s.setup.dealt = false; autoPool(s); }); },
  'rec-reroll'() { setupMut(s => { s.setup.seed = (s.setup.seed || 1) + 1; if (!s.setup.poolTouched) { autoPool(s); s.setup.dealt = false; } }); Sound.tick(); },
  'rec-use'() { setupMut(s => { const n = A.ui.setupStep === 0 ? effN() : Math.max(5, s.players.length); s.setup.pool = E.recommend(n, s.setup.style, s.setup.seed, s).pool; s.setup.poolTouched = false; s.setup.dealt = false; }); toast('Recommended setup applied'); },
  'pool-inc'(v) { setupMut(s => { s.setup.pool[v] = (s.setup.pool[v] || 0) + 1; s.setup.poolTouched = true; s.setup.dealt = false; }); Sound.tick(); },
  'pool-dec'(v) { setupMut(s => { s.setup.pool[v] = Math.max(0, (s.setup.pool[v] || 0) - 1); if (!s.setup.pool[v]) delete s.setup.pool[v]; s.setup.poolTouched = true; s.setup.dealt = false; }); Sound.tick(); },
  'pool-tab'(v) { A.ui.poolTab = v; A.ui.poolQuery = ''; render(); },
  poolq(v) { A.ui.poolQuery = v; render(); },
  'pool-fill'() { setupMut(s => { const d = s.players.length - roleCount(); if (d > 0) { s.setup.pool.villager = (s.setup.pool.villager || 0) + d; s.setup.poolTouched = true; s.setup.dealt = false; } }); },
  'pool-trim'() { const d = roleCount() - A.s.players.length; const v = A.s.setup.pool.villager || 0; if (v < d) { toast(`Remove ${d - v} more role${d - v === 1 ? '' : 's'} by hand — not enough Villagers to trim.`); } setupMut(s => { const cut = Math.min(d, v); if (cut > 0) { s.setup.pool.villager -= cut; if (!s.setup.pool.villager) delete s.setup.pool.villager; s.setup.poolTouched = true; s.setup.dealt = false; } }); },
  'preset-save'() { const s = A.s; const name = val('presetName').trim() || `${roleCount()}-player ${E.STYLE_NAMES[s.setup.style] || 'custom'} setup`; A.presets.push({ name: name.slice(0, 30), n: roleCount(), pool: E.clone(s.setup.pool), style: s.setup.style }); LS.set(PRKEY, A.presets); toast('Preset saved'); render(); },
  'preset-load'(v) { const p = A.presets[+v]; if (!p) return; setupMut(s => { s.setup.pool = E.clone(p.pool); s.setup.poolTouched = true; s.setup.dealt = false; }); toast(`Loaded “${p.name}”`); },
  'preset-del'(v) { const p = A.presets[+v]; confirmSheet({ title: `Delete “${p.name}”?`, body: 'This removes the saved preset from this device.', ok: 'Delete', danger: true, onOk: () => { A.presets.splice(+v, 1); LS.set(PRKEY, A.presets); } }); },
  'cfg-toggle'(k) { const s = A.s; s.config[k] = !s.config[k]; if (s.phase !== 'setup') E.log(s, 'override', `Rule changed: ${k} → ${s.config[k] ? 'on' : 'off'}.`); save(); render(); },
  'cfg-set'(v, el) { const s = A.s; const k = el.dataset.key; const num = ['convertCap', 'guessShots', 'mayorWeight', 'dayTimer', 'stalemateCycles'].includes(k); s.config[k] = num ? +v : v; if (k === 'dayTimer') A.ui.timer = null; if (s.phase !== 'setup') E.log(s, 'override', `Rule changed: ${k} → ${v}.`); save(); render(); },
  'cfg-reset'() { confirmSheet({ title: 'Restore default rules?', body: 'Every house rule goes back to its default. Your PIN is kept.', ok: 'Restore defaults', onOk: () => { const pin = A.s.config.godPin; A.s.config = E.clone(E.DEFAULT_CONFIG); A.s.config.godPin = pin; save(); toast('Defaults restored'); } }); },
  peek(v) { A.ui.peek[v] = !A.ui.peek[v]; render(); },
  'toggle-assign'() { A.ui.showAssign = !A.ui.showAssign; render(); },
  'manual-role'(v, el) {
    const pid = el.dataset.pid;
    cmd('Hand-pick a role', s => {
      const p = E.getP(s, pid);
      if (!v) { p.lock = false; return; }
      if (s.setup.dealt) {
        const other = s.players.find(q => q.id !== p.id && q.roleId === v && !q.lock) || s.players.find(q => q.id !== p.id && q.roleId === v);
        if (!other && p.roleId !== v) throw new Error('That role is not in the role list.');
        if (other) { other.roleId = p.roleId; }
        p.roleId = v; p.lock = true; E.finalizeAssignment(s);
      } else { p.roleId = v; p.lock = true; }
    });
  },
  deal() { cmd('Deal roles', s => { E.assignRoles(s); s.setup.dealt = true; s.setup.revealed = false; }); A.ui.showAssign = false; A.ui.peek = {}; Sound.confirm(); render(); },
  'reveal-all'() { if (!A.s.setup.dealt) { toast('Deal the roles first.'); return; } openReveal(A.s.players.map(p => p.id)); A.ui.overlay.after = () => { A.s.setup.revealed = true; save(); render(); }; },
  'reveal-one'() { const id = val('reveal-one'); if (id) openReveal([id]); },
  'reveal-player'(v) { openReveal([v]); },
  'start-game'() {
    if (!A.s.setup.dealt) { toast('Deal the roles first.'); return; }
    if (!cmd('Start the game', s => E.startGame(s))) return;
    Object.assign(A.ui, { view: 'command', nightIdx: 0, draft: null });
    Sound.night(); A.ui.overlay = { type: 'cine', kind: 'night', n: A.s.night }; top0(); render();
  },
  /* night */
  'night-step'(v) { A.ui.nightIdx = Math.max(0, +v); A.ui.draft = null; render(); },
  'draft-carrier'(v) { const d = A.ui.draft; d.carrier = v; if (P(v).roleId !== 'strongman') delete d.opts.strong; Sound.tick(); render(); },
  'draft-opt'(k) { const d = A.ui.draft; d.opts[k] = !d.opts[k]; render(); },
  'draft-ab'(v) { const d = A.ui.draft; d.ab = v; d.targets = []; d.opts = {}; render(); },
  'draft-msg'(v) { A.ui.draft.opts.msg = v; },
  'draft-duel'(v) { A.ui.draft.opts.won = v === '1'; render(); },
  'draft-target'(v) {
    const d = A.ui.draft; const st = nightCurrent(); if (!st) return;
    let two = false; if (st.type === 'player') { const ab = st.abilities.find(a => a.id === d.ab); two = ab && ab.target === 'two'; }
    if (!two) d.targets = d.targets[0] === v ? [] : [v];
    else { const i = d.targets.indexOf(v); if (i >= 0) d.targets.splice(i, 1); else if (d.targets.length < 2) d.targets.push(v); else d.targets = [d.targets[0], v]; }
    Sound.tick(); render();
  },
  'night-confirm'() {
    const st = nightCurrent(); const d = A.ui.draft; if (!st || !d) return; const N = A.s.night;
    const act = st.type === 'faction' ? { key: st.key, actor: d.carrier, ab: st.kind, targets: d.targets.slice(0, 1), opts: { strong: !!d.opts.strong } }
      : { key: st.key, actor: st.actor, ab: d.ab, targets: d.targets.slice(), opts: Object.assign({}, d.opts) };
    if (cmd(`Night ${N}: ${st.title}`, s => { E.setAction(s, act); nightUi().visited[st.key] = 'done'; })) { Sound.confirm(); nightAdvance(); }
  },
  'night-skip'() {
    const st = nightCurrent(); if (!st) return;
    if (cmd(`Night ${A.s.night}: ${st.title} — no action`, s => { E.clearAction(s, st.key); nightUi().visited[st.key] = 'skip'; })) nightAdvance();
  },
  'open-menu'() { A.ui.sheet = { type: 'menu' }; render(); },
  'restart-day'() {
    const N = A.s.day; const i = lastHist(`Start Day ${N}`);
    if (i < 0) { toast('The start of this day is no longer in the undo history.'); return; }
    confirmSheet({ title: `Restart Day ${N}?`, body: 'Today’s votes, executions, guesses and reveals are undone. The night’s results stay. You can undo this.', ok: `Restart Day ${N}`, danger: true, onOk: () => {
      const pre = JSON.stringify(A.s); const prevAnn = A.s.lastAnnounce; const s = JSON.parse(A.hist[i].snap); E.startDay(s); if (prevAnn && prevAnn.n === N) s.lastAnnounce = prevAnn;
      A.s = s; A.hist.push({ label: `Restart Day ${N}`, snap: pre, t: Date.now() }); if (A.hist.length > 80) A.hist.shift();
      resetUi(); A.ui.view = 'command'; save(); top0(); toast(`Day ${N} restarted`); } });
  },
  'restart-same'() {
    confirmSheet({ title: 'Restart with the same roles?', body: 'Everything that happened is cleared and the game goes back to Night 1. Everyone keeps the role they were dealt, so no reveal is needed. You can undo this.', ok: 'Restart from Night 1', danger: true, onOk: () => {
      if (!cmd('Restart the game', s => E.restartGame(s, 'same'))) return;
      resetUi(); Object.assign(A.ui, { view: 'command' }); Sound.night(); A.ui.overlay = { type: 'cine', kind: 'night', n: A.s.night }; top0(); } });
  },
  'restart-reshuffle'() {
    confirmSheet({ title: 'Reshuffle and restart?', body: 'Same players and role list, but everyone gets a new secret role. The game goes to the reveal so each player can see their new card. You can undo this.', ok: 'Reshuffle and restart', danger: true, onOk: () => {
      if (!cmd('Reshuffle and restart', s => E.restartGame(s, 'reshuffle'))) return;
      resetUi(); Object.assign(A.ui, { view: 'command', setupStep: 4 }); top0(); } });
  },
  'restart-setup'() {
    confirmSheet({ title: 'Go back to setup?', body: 'The game is cleared but the players stay. Roles and rules can be changed before dealing again. You can undo this.', ok: 'Back to setup', danger: true, onOk: () => {
      if (!cmd('Back to setup', s => E.restartGame(s, 'setup'))) return;
      resetUi(); Object.assign(A.ui, { view: 'command', setupStep: 1 }); top0(); } });
  },
  'resolve-ask'() {
    const s = A.s;
    confirmSheet({ title: `Resolve Night ${s.night}?`, html: `<p class="ash">The engine applies every recorded action in priority order. You can undo this afterwards.</p>${s.actions.length ? `<ul class="small" style="padding-left:18px">${s.actions.map(a => `<li>${esc(actionText(a))}</li>`).join('')}</ul>` : '<p class="muted">No actions recorded.</p>'}`, ok: `Resolve Night ${s.night}`,
      onOk: () => { const before = A.s.deaths.length; if (cmd(`Resolve Night ${A.s.night}`, s2 => E.resolveNight(s2))) { Object.assign(A.ui, { nightIdx: 0, draft: null, annFormat: null, annCustom: '', delivered: {}, promptSel: {} }); if (A.s.deaths.length > before) Sound.kill(); else Sound.confirm(); top0(); } } });
  },
  'restart-night'() {
    const N = A.s.night;
    if (A.s.phase === 'dawn') {
      const i = lastHist(`Resolve Night ${N}`); if (i < 0) { toast('The night is no longer in the undo history.'); return; }
      confirmSheet({ title: `Restart Night ${N}?`, body: 'The night’s results are undone and every action recorded tonight is cleared. You can undo this.', ok: `Restart Night ${N}`, danger: true, onOk: () => {
        const pre = JSON.stringify(A.s); const s = JSON.parse(A.hist[i].snap); s.actions = []; s.nightUi = { night: s.night, visited: {} };
        A.s = s; A.hist.push({ label: `Restart Night ${N}`, snap: pre, t: Date.now() }); if (A.hist.length > 80) A.hist.shift(); resetUi(); A.ui.view = 'command'; save(); top0(); } });
      return;
    }
    confirmSheet({ title: `Restart Night ${N}?`, body: 'Every action recorded tonight is cleared and you start again from the first role. You can undo this.', ok: 'Clear and restart', danger: true, onOk: () => { cmd(`Restart Night ${N}`, s => { s.actions = []; s.nightUi = { night: s.night, visited: {} }; }); resetUi(); A.ui.view = 'command'; } });
  },
  /* prompts */
  'prompt-sel'(v) { const [q, id] = v.split('|'); A.ui.promptSel = A.ui.promptSel || {}; A.ui.promptSel[q] = id; render(); },
  'prompt-go'(qid) {
    const q = A.s.pending.find(x => x.id === qid); const t = (A.ui.promptSel || {})[qid]; if (!q || !t) return;
    const go = () => { const before = A.s.deaths.length; cmd(q.type === 'hunter' ? 'Hunter\'s last shot' : 'Jester\'s haunt', s => E.resolvePrompt(s, qid, t)); if (A.s.deaths.length > before) Sound.kill(); };
    if (q.type === 'hunter') confirmSheet({ title: `Shoot ${E.pname(A.s, t)}?`, body: 'The shot is Unstoppable and happens immediately. Any death abilities trigger.', ok: 'Shoot', danger: true, onOk: go }); else go();
  },
  'prompt-skip'(qid) { cmd('Skip prompt', s => E.resolvePrompt(s, qid, null)); },
  /* dawn */
  'show-private'(pid) { const N = A.s.night; const rep = A.s.reports[N]; openPrivate(pid, rep.messages.filter(m => m.to === pid), `Night ${N}`); A.ui.overlay.after = () => { A.ui.delivered[N + ':' + pid] = true; render(); }; },
  'mark-delivered'(k) { A.ui.delivered[k] = !A.ui.delivered[k]; render(); },
  'ann-format'(v) { A.ui.annFormat = v; render(); },
  'ann-custom'(v) { A.ui.annCustom = v; },
  'start-day'() {
    const s = A.s; const N = s.night;
    const fmt = A.ui.annFormat || (s.config.revealOnDeath && s.config.showCause ? 'full' : s.config.revealOnDeath ? 'role' : s.config.showCause ? 'cause' : 'name');
    if (!cmd(`Start Day ${N}`, s2 => { E.startDay(s2); s2.lastAnnounce = { n: N, format: fmt, custom: A.ui.annCustom }; })) return;
    Object.assign(A.ui, { nominees: [], voteNominee: null, timer: null });
    Sound.day(); A.ui.overlay = { type: 'announce', n: N, format: fmt, custom: A.ui.annCustom }; top0(); render();
  },
  /* day */
  'timer-toggle'() { const t = A.ui.timer; if (!t) return; if (t.running) { t.left = Math.max(0, t.endAt - Date.now()); t.running = false; } else { if (t.left <= 0) t.left = t.total; t.endAt = Date.now() + t.left; t.running = true; } render(); },
  'timer-reset'() { A.ui.timer = null; render(); },
  'mayor-reveal'(id) { confirmSheet({ title: `Reveal ${E.pname(A.s, id)} as the Mayor?`, body: `Their vote will count ${A.s.config.mayorWeight}×, and Doctors can no longer heal them.`, ok: 'Reveal the Mayor', onOk: () => cmd('Mayor revealed', s => E.mayorReveal(s, id)) }); },
  'guess-open'(id) { A.ui.sheet = { type: 'guess', id }; render(); },
  'guess-go'(gid) {
    const t = val('g-t'), r = val('g-r'); if (!t || !r) return; let res = null;
    A.ui.sheet = null;
    if (cmd(`${E.pname(A.s, gid)} guessed`, s => { res = E.guess(s, gid, t, r); if (res.error) throw new Error(res.error); })) { Sound.kill(); toast(res.correct ? `Correct — ${E.pname(A.s, t)} is shot.` : 'Wrong guess.'); }
  },
  'nom-all'() { A.ui.nominees = A.s.players.filter(p => p.alive).map(p => p.id); render(); },
  'nom-clear'() { A.ui.nominees = []; render(); },
  'nom-toggle'(v) { const n = A.ui.nominees || (A.ui.nominees = []); const i = n.indexOf(v); if (i >= 0) n.splice(i, 1); else n.push(v); render(); },
  'vote-open'() { const n = (A.ui.nominees || []).slice(); if (!n.length) return; cmd(`Day ${A.s.day}: open the vote`, s => E.openVote(s, n)); A.ui.voteNominee = null; render(); },
  'vote-skip'() { confirmSheet({ title: 'End the day without a vote?', body: 'Nobody is executed today.', ok: 'Skip the vote', onOk: () => cmd(`Day ${A.s.day}: no vote`, s => E.skipVote(s)) }); },
  'vote-nominee'(v) { A.ui.voteNominee = v; render(); },
  'vote-cast'(voter) { const cur = A.ui.voteNominee; if (!cur) return; E.castVote(A.s, voter, cur); save(); Sound.tick(); render(); },
  'vote-reset'() { A.s.dayState.votes = {}; save(); render(); },
  'vote-confirm'() {
    const s = A.s; const t = E.tally(s); const r = t.result; const nm = id => id === 'skip' ? 'no execution' : E.pname(s, id);
    const go = () => { const before = A.s.deaths.length; cmd(`Day ${A.s.day} vote`, s2 => E.confirmVote(s2)); A.ui.voteNominee = null; if (A.s.deaths.length > before) Sound.kill(); render(); };
    if (r.type === 'execute') confirmSheet({ title: `Execute ${nm(r.target)}?`, body: `${nm(r.target)} received ${t.totals[r.target]} vote${t.totals[r.target] === 1 ? '' : 's'}. Death abilities trigger immediately. You can undo this.`, ok: `Execute ${nm(r.target)}`, danger: true, onOk: go });
    else if (r.type === 'revote') confirmSheet({ title: 'Tie — hold a revote?', body: `${r.tied.map(nm).join(' and ')} are tied. Votes are cleared and only they stay on trial.`, ok: 'Start the revote', onOk: go });
    else if (r.type === 'random') confirmSheet({ title: 'Tie — pick at random?', body: `${r.tied.map(nm).join(' and ')} are tied. One outcome is chosen at random.`, ok: 'Pick at random', danger: true, onOk: go });
    else confirmSheet({ title: 'No execution', body: r.reason, ok: 'Confirm', onOk: go });
  },
  'end-day'() {
    if (!cmd(`End Day ${A.s.day}`, s => E.endDay(s))) return;
    if (A.s.phase === 'night') { Object.assign(A.ui, { nightIdx: 0, draft: null }); Sound.night(); A.ui.overlay = { type: 'cine', kind: 'night', n: A.s.night }; }
    top0(); render();
  },
  /* winning & ending */
  'end-game-win'() { confirmSheet({ title: 'End the game and reveal every role?', body: 'The results screen shows all roles to everyone.', ok: 'End the game', onOk: () => { cmd('End the game', s => E.endGame(s, s.winPrompt)); Sound.end(); top0(); } }); },
  'dismiss-win'() { cmd('Keep playing', s => E.dismissWin(s)); },
  'stalemate-draw'() { confirmSheet({ title: 'End the game as a draw?', body: 'No faction wins. Survivors, Jesters and other independents are still judged on their own goals.', ok: 'End as a draw', onOk: () => { cmd('End as a draw', s => E.endGame(s, { status: 'over', faction: 'draw', reason: 'Stalemate — nobody could be eliminated.', winners: E.computeWinners(s, 'draw') })); Sound.end(); top0(); } }); },
  'stalemate-ack'() { cmd('Play on through stalemate', s => E.ackStalemate(s)); },
  'end-game'() { confirmSheet({ title: 'End the game now?', body: 'This finishes the game immediately. If no faction has won, it is recorded as a draw. You can still undo.', ok: 'End the game', danger: true, onOk: () => { cmd('End the game', s => E.endGame(s)); Sound.end(); A.ui.view = 'command'; top0(); } }); },
  'play-again'() { if (!cmd('Play again', s => { const n = E.restartGame(s, 'setup'); n.setup.seed = (s.setup.seed || 1) + 1; if (!n.setup.poolTouched) n.setup.pool = E.recommend(n.players.length, n.setup.style, n.setup.seed, n).pool; return n; })) return; resetUi(); Object.assign(A.ui, { setupStep: 1, view: 'command' }); top0(); render(); },
  rematch() {
    confirmSheet({ title: 'Rematch — reshuffle and start?', body: 'Same players and role list, new random deal. The game starts immediately at Night 1.', ok: 'Rematch', onOk: () => {
      if (!cmd('Rematch', s => { E.restartGame(s, 'reshuffle'); E.startGame(s); return s; })) return;
      resetUi(); Object.assign(A.ui, { view: 'command', nightIdx: 0, draft: null });
      Sound.night(); A.ui.overlay = { type: 'cine', kind: 'night', n: A.s.night }; top0();
    } });
  },
  /* players */
  pfilter(v) { A.ui.pfilter = v; render(); },
  'open-player'(v) { A.ui.sheet = { type: 'player', id: v }; render(); },
  'kill-ask'(v) { A.ui.sheet = { type: 'kill', id: v }; render(); },
  'kill-go'(v) { const cause = val('kcause').trim() || 'removed by the Game Master'; A.ui.sheet = null; if (cmd(`Kill ${E.pname(A.s, v)}`, s => { E.manualKill(s, v, cause); })) Sound.kill(); },
  revive(v) { confirmSheet({ title: `Revive ${E.pname(A.s, v)}?`, body: 'They return to life with their current role. Win conditions are re-checked.', ok: 'Revive', onOk: () => cmd(`Revive ${E.pname(A.s, v)}`, s => E.manualRevive(s, v)) }); },
  'setrole-ask'(v) { A.ui.sheet = { type: 'setrole', id: v }; render(); },
  'setrole-go'(v) { const r = val('sr-role'), t = val('sr-team'); A.ui.sheet = null; cmd(`Change ${E.pname(A.s, v)}'s role`, s => E.manualSetRole(s, v, r, t || null)); },
  /* timeline & files */
  'tl-mode'(v) { A.ui.tlMode = v; render(); },
  'export-log'() { const d = new Date(); offerFile(`omerta-log-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.txt`, E.historyText(A.s)); },
  'export-save'() { offerFile('omerta-save.json', JSON.stringify(A.s)); },
  'import-open'() { A.ui.sheet = { type: 'import' }; render(); },
  'import-go'() {
    let obj; try { obj = JSON.parse(val('imp')); } catch (e) { toast('That is not valid save data.'); return; }
    if (!obj || obj.v !== 1 || !Array.isArray(obj.players) || !obj.config) { toast('That file is not an Omertà save.'); return; }
    A.s = obj; A.hist = []; A.ui.sheet = null; A.ui.view = 'command'; A.ui.setupStep = 0; save(); toast('Game imported'); render();
  },
  /* roles */
  libq(v) { A.ui.libQuery = v; render(); },
  'lib-filter'(v) { A.ui.libFilter = v; render(); },
  'open-role'(v) { A.ui.sheet = { type: 'role', id: v }; render(); },
  'role-toggle'(id) {
    const d = A.prefs.disabled; const i = d.indexOf(id); if (i >= 0) d.splice(i, 1); else d.push(id);
    savePrefs(); A.s.setup.disabled = d.slice(); if (A.s.phase === 'setup') autoPool(A.s); save(); render();
  },
  'custom-new'() { A.ui.sheet = { type: 'custom' }; render(); },
  'custom-save'() {
    const name = val('cr-name').trim(); if (!name) { toast('Give the role a name.'); document.getElementById('cr-name').focus(); return; }
    const team = val('cr-team'); const susV = val('cr-sus');
    const def = { name, icon: val('cr-icon'), team, kind: val('cr-kind'), uses: +val('cr-uses'), attack: +val('cr-attack'), def: +val('cr-def'), rbImmune: val('cr-rb') === '1',
      clue: val('cr-clue'), nights: val('cr-nights'), desc: val('cr-desc').trim() || `A custom ${teamName(team)} role.`, win: team === 'neutral' ? 'survivor' : team, winText: team === 'neutral' ? 'Be alive when the game ends.' : undefined };
    if (susV !== 'auto') def.sus = susV === '1';
    let r = E.makeCustomRole(def); let k = 2; while (E.LIBMAP[r.id] || (A.s.customRoles[r.id] && A.s.customRoles[r.id].name !== r.name)) { def.idSuffix = String(k++); r = E.makeCustomRole(def); }
    A.s.customRoles[r.id] = r; A.customLib = A.customLib.filter(x => x.id !== r.id).concat([r]); LS.set(CRKEY, A.customLib); save();
    toast(`${r.name} created`); A.ui.sheet = { type: 'role', id: r.id }; render();
  },
  'custom-delete'(id) { const r = role(id); confirmSheet({ title: `Delete ${r.name}?`, body: 'The custom role is removed from this device.', ok: 'Delete', danger: true, onOk: () => { delete A.s.customRoles[id]; A.customLib = A.customLib.filter(x => x.id !== id); LS.set(CRKEY, A.customLib); save(); } }); },
  /* settings */
  'pin-set'() { const v = val('pin').trim(); if (!/^\d{4}$/.test(v)) { toast('The PIN must be exactly 4 digits.'); return; } A.s.config.godPin = v; save(); toast('PIN set. It is needed to leave private screens.'); render(); },
  'pin-clear'() { A.s.config.godPin = ''; save(); toast('PIN removed'); render(); },
  'debug-toggle'() { A.ui.debug = !A.ui.debug; render(); },
});

/* ---------- timer tick & init ---------- */
setInterval(() => {
  const t = A.ui.timer; if (!t || !t.running) return;
  const left = timerLeft(); const el = document.getElementById('timer-val'); if (el) el.textContent = fmtClock(left);
  if (left <= 0) { t.running = false; t.left = 0; Sound.end(); toast('Time is up — move to the vote.'); render(); }
}, 250);
document.addEventListener('visibilitychange', () => { if (document.hidden && A.s) save(); });
boot(); render();

/* Omertà — online rooms, Game Master side. Inert inside Claude (no server there). */
'use strict';
const OKEY = 'omerta.online.v1';

/* ---------- what each phone is allowed to see ---------- */
function hiddenAtDawn(s) {
  // between resolving a night and starting the day, nobody's phone may learn who died
  if (s.phase !== 'dawn') return new Set();
  return new Set(s.deaths.filter(d => d.ph === 'N' + s.night || d.ph === 'D' + s.night).map(d => d.id));
}
function publicView(s) {
  const phase = s.phase === 'reveal-done' || s.phase === 'dawn' ? 'night' : s.phase;
  const hide = hiddenAtDawn(s);
  const lastDeath = id => s.deaths.slice().reverse().find(d => d.id === id);
  const pv = { phase, night: s.night, day: s.day, dealt: !!s.setup.dealt,
    players: s.players.map(p => { const alive = s.phase === 'setup' || p.alive || hide.has(p.id); const d = alive ? null : lastDeath(p.id);
      return { id: p.id, name: p.name, alive, role: d && d.publicRole ? d.publicRole : null }; }) };
  if ((s.phase === 'day' || s.phase === 'ended') && s.lastAnnounce && s.lastAnnounce.n === s.day) {
    const a = E.dawnAnnouncement(s, s.day); const f = s.lastAnnounce.format;
    const showRole = f === 'role' || f === 'full', showCause = f === 'cause' || f === 'full';
    pv.announce = { day: s.day, custom: f === 'custom' ? String(s.lastAnnounce.custom || '').slice(0, 600) : null,
      deaths: a.deaths.map(d => ({ name: d.name, role: showRole && !d.cleaned ? d.role : null, hidden: showRole && d.cleaned, cause: showCause ? d.cause : null })), notes: a.notes };
  }
  if (s.phase === 'day') pv.notes = s.publicNotes.filter(n => n.ph === 'D' + s.day).map(n => n.text);
  const ds = s.dayState;
  if (s.phase === 'day' && ds && ds.open) pv.vote = { key: `D${s.day}R${ds.round}`, round: ds.round, allowSkip: !!s.config.allowSkip,
    nominees: ds.nominees.map(id => ({ id, name: E.pname(s, id) })), eligible: s.players.filter(p => E.canVote(s, p)).map(p => p.id) };
  if (s.phase === 'day' && ds && ds.done && ds.result) {
    const r = ds.result; pv.voteResult = r.type === 'execute' ? (r.spared ? `${E.pname(s, r.target)} was voted out — but survived as the Prince.` : `${E.pname(s, r.target)} was executed.`) : (r.reason || 'Nobody was executed.');
  }
  if (s.phase === 'ended' && s.result) pv.result = { factionName: s.result.factionName, faction: s.result.faction, reason: s.result.reason,
    winners: s.result.winners.map(w => ({ name: E.pname(s, w.id), why: w.why })),
    roles: s.players.map(p => ({ name: p.name, role: E.getRole(s, p.roleId).name, team: E.teamLabel(p), alive: p.alive })) };
  return pv;
}
function playerView(s, p) {
  const hide = hiddenAtDawn(s);
  const v = { id: p.id, name: p.name, alive: s.phase === 'setup' || p.alive || hide.has(p.id) };
  if (p.roleId && (s.setup.dealt || s.phase !== 'setup')) v.card = E.playerCard(s, p.id);
  // a night's private results reach the phone once the Game Master starts the following day
  const upTo = s.phase === 'day' || s.phase === 'ended' ? s.day : Math.max(0, s.night - 1);
  v.results = [];
  for (let n = upTo; n >= 1; n--) { const rep = s.reports[n]; if (!rep) continue; const m = rep.messages.filter(x => x.to === p.id).map(x => x.text); if (m.length) v.results.push({ night: n, messages: m }); }
  if (s.phase === 'day') v.today = { mute: p.fx.blackmailed === s.day, noVote: p.fx.silenced === s.day };
  return v;
}
function onlinePayload(s) {
  const views = {}; for (const p of s.players) views[p.id] = playerView(s, p);
  return { seats: s.players.map(p => ({ id: p.id, name: p.name })), views, publicView: publicView(s) };
}
const voteKey = s => s.phase === 'day' && s.dayState && s.dayState.open ? `D${s.day}R${s.dayState.round}` : '';

/* ---------- connection ---------- */
const Online = {
  avail: false, cfg: null, room: LS.get(OKEY, null), status: { seats: [], votes: [] }, sb: null, ch: null,
  pushT: null, pollT: null, lastSent: '', applied: {}, err: '', busy: false,
  link() { return `${location.origin}/play?room=${this.room.code}`; },
  async api(action, body) {
    const r = await fetch('/api/room?action=' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ action }, body || {})) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Could not reach the server.'), { status: r.status });
    return j;
  },
  async init() {
    if (window.claude && window.claude.use) return;
    try {
      const r = await fetch('/api/room?action=config', { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { if (r.status === 503) { this.avail = 'unconfigured'; this.err = j.error || ''; render(); } return; }
      this.cfg = j; this.avail = true;
    } catch (e) { return; }
    if (this.room) { this.connect(); this.push(true); this.refresh(); }
    render();
  },
  async host() {
    if (this.busy) return; this.busy = true; render();
    try {
      const j = await this.api('create');
      this.room = { code: j.code, hostSecret: j.hostSecret }; LS.set(OKEY, this.room);
      this.connect(); await this.push(true); await this.refresh(); toast(`Room ${j.code} is open`);
    } catch (e) { toast(e.message); }
    this.busy = false; render();
  },
  connect() {
    this.disconnect();
    const rt = this.cfg && this.cfg.realtime;
    if (rt && window.supabase && window.supabase.createClient) {
      try {
        this.sb = this.sb || window.supabase.createClient(rt.url, rt.key, { auth: { persistSession: false, autoRefreshToken: false } });
        this.ch = this.sb.channel('omerta-' + this.room.code, { config: { broadcast: { self: false } } });
        this.ch.on('broadcast', { event: 'player' }, () => this.refresh()).subscribe();
      } catch (e) { this.ch = null; }
    }
    this.pollT = setInterval(() => this.refresh(), this.ch ? 12000 : 3000);
  },
  disconnect() { clearInterval(this.pollT); if (this.ch && this.sb) { try { this.sb.removeChannel(this.ch); } catch (e) {} } this.ch = null; },
  schedule() { if (!this.room) return; clearTimeout(this.pushT); this.pushT = setTimeout(() => this.push(), 250); },
  async push(force) {
    if (!this.room) return;
    const payload = onlinePayload(A.s); const sig = JSON.stringify(payload);
    if (!force && sig === this.lastSent) return;
    try {
      await this.api('sync', Object.assign({ code: this.room.code, hostSecret: this.room.hostSecret, version: Date.now() }, payload));
      this.lastSent = sig; if (this.err) { this.err = ''; render(); }
      if (this.ch) Promise.resolve(this.ch.send({ type: 'broadcast', event: 'update', payload: {} })).catch(() => {});
    } catch (e) { this.err = e.message; if (e.status === 404 || e.status === 403) this.lost(); else render(); }
  },
  async refresh() {
    if (!this.room) return;
    const key = voteKey(A.s);
    try {
      const j = await this.api('status', { code: this.room.code, hostSecret: this.room.hostSecret, voteKey: key });
      const before = JSON.stringify(this.status.seats); this.status = j; const hadErr = !!this.err; this.err = '';
      const changed = applyRemoteVotes(j.votes, key);
      if (changed) { save(); render(); } else if (hadErr || before !== JSON.stringify(j.seats)) render();
    } catch (e) { this.err = e.message; if (e.status === 404 || e.status === 403) this.lost(); }
  },
  lost() { this.disconnect(); this.room = null; LS.del(OKEY); this.status = { seats: [], votes: [] }; toast('The online room has closed. Host a new one to reconnect the phones.'); render(); },
  async resetSeat(id) { try { await this.api('resetSeat', { code: this.room.code, hostSecret: this.room.hostSecret, seatId: id }); await this.refresh(); toast('Seat reset — that player can join again.'); } catch (e) { toast(e.message); } },
  async close() { try { await this.api('close', { code: this.room.code, hostSecret: this.room.hostSecret }); } catch (e) {} this.disconnect(); this.room = null; LS.del(OKEY); this.status = { seats: [], votes: [] }; render(); },
};
window.Online = Online;

function applyRemoteVotes(votes, key) {
  const s = A.s; const ds = s.dayState; if (!key || !ds || !ds.open || !votes) return false;
  let changed = false;
  for (const v of votes) {
    if (v.key && v.key !== key) continue;
    const stamp = key + '|' + v.seat; if (Online.applied[stamp] === v.at) continue; // apply each phone change once; GM taps can override
    Online.applied[stamp] = v.at;
    const p = E.getP(s, v.seat); if (!p || !E.canVote(s, p)) continue;
    const valid = v.target === null || (v.target === 'skip' && s.config.allowSkip) || ds.nominees.includes(v.target);
    if (!valid) continue;
    if (v.target === null) { if (ds.votes[p.id] !== undefined) { delete ds.votes[p.id]; changed = true; } }
    else if (ds.votes[p.id] !== v.target) { ds.votes[p.id] = v.target; changed = true; }
  }
  return changed;
}

/* ---------- UI ---------- */
function qrSvg(text) { try { if (typeof qrcode !== 'function') return ''; const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { return ''; } }
function onlinePanel() {
  const O = Online; if (!O.avail) return '';
  if (O.avail === 'unconfigured') return `<div class="panel tight"><h3>${icon('phone', 'sm')} Play on everyone's phones</h3><p class="small ash" style="margin:6px 0 0">Online play isn't switched on for this site yet. Add the Supabase keys in Vercel (see the README), then redeploy.</p></div>`;
  if (!O.room) return `<div class="panel glow"><h3>${icon('phone', 'sm')} Play on everyone's phones</h3><p class="small ash">Players open this site on their own phones, enter a room code and tap their name. Their role, private results and votes then appear on their own phone — no passing around.</p><button class="btn primary" data-a="online-host" ${O.busy ? 'disabled' : ''}>${icon('users')} Host an online room</button></div>`;
  const seats = O.status.seats || []; const joined = A.s.players.filter(p => (seats.find(x => x.id === p.id) || {}).claimed).length; const qr = qrSvg(O.link());
  return `<div class="panel glow">
    <div class="row between"><h3>${icon('phone', 'sm')} Online room</h3><span class="chip ${joined === A.s.players.length && joined ? 'ok' : 'warn'}">${joined} of ${A.s.players.length} joined</span></div>
    <div class="onlinebox">${qr ? `<div class="qr" role="img" aria-label="QR code to join this room">${qr}</div>` : ''}
      <div style="min-width:0"><div class="small ash">Room code</div><div class="display roomcode">${esc(O.room.code)}</div>
        <div class="tiny ash" style="word-break:break-all">${esc(O.link())}</div>
        <div class="row" style="margin-top:8px"><button class="btn sm" data-a="online-copy">${icon('copy', 'sm')} Copy link</button></div></div></div>
    <p class="tiny muted" style="margin:10px 0 0">Players scan the code or open the link, then tap their own name. Each name can only be claimed once.</p>
    <div style="margin-top:6px">${A.s.players.length ? A.s.players.map(p => { const st = seats.find(x => x.id === p.id) || {};
      return `<div class="prow" style="grid-template-columns:auto minmax(0,1fr) auto"><span class="dot" style="--c:${p.color}"></span><div><b>${esc(p.name)}</b><div class="tiny" style="color:${st.claimed ? 'var(--ok)' : 'var(--dim)'}">${st.claimed ? (st.seen ? 'Joined · has seen their role' : 'Joined') : 'Not joined yet'}</div></div>${st.claimed ? `<button class="btn ghost sm" data-a="online-reset" data-v="${p.id}" aria-label="Reset ${esc(p.name)}'s phone">Reset</button>` : ''}</div>`; }).join('') : '<p class="small muted">Add players and they appear here to be claimed.</p>'}</div>
    ${O.err ? `<p class="small" style="color:var(--warn);margin-top:8px">${icon('alert', 'sm')} ${esc(O.err)}</p>` : ''}
    <div class="row" style="margin-top:10px"><button class="btn ghost sm" data-a="online-close">Close the room</button></div></div>`;
}
Object.assign(H, {
  'online-host'() { Online.host(); },
  'online-copy'() { const l = Online.link(); (navigator.clipboard ? navigator.clipboard.writeText(l) : Promise.reject()).then(() => toast('Link copied'), () => { A.ui.sheet = { type: 'copytext', title: 'Join link', text: l }; render(); }); },
  'online-reset'(id) { confirmSheet({ title: `Reset ${E.pname(A.s, id)}'s phone?`, body: 'Whoever joined as this player is disconnected, and the name can be claimed again. Use this if the wrong person tapped the name or a phone changed.', ok: 'Reset seat', danger: true, onOk: () => Online.resetSeat(id) }); },
  'online-close'() { confirmSheet({ title: 'Close the online room?', body: 'Every phone is disconnected. The game itself continues on this phone.', ok: 'Close the room', danger: true, onOk: () => Online.close() }); },
});
Online.init();

