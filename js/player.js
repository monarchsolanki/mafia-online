/* Omertà — player's phone. Sees ONLY this player's slice, fetched with this phone's secret token. */
'use strict';
const $ = s => document.querySelector(s);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PKEY = 'omerta.player.v1', SEENKEY = 'omerta.player.seen.v1';
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const IC = {
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.3 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  skull: '<path d="M12 3a7 7 0 0 0-7 7c0 2.5 1.2 4 2.5 5v3h9v-3c1.3-1 2.5-2.5 2.5-5a7 7 0 0 0-7-7z"/><circle cx="9.5" cy="10.5" r="1.3"/><circle cx="14.5" cy="10.5" r="1.3"/><path d="M10 18v3M14 18v3"/>',
  hand: '<path d="M9 11V5a1.5 1.5 0 0 1 3 0v5M12 9V4a1.5 1.5 0 0 1 3 0v6M15 9.5V6a1.5 1.5 0 0 1 3 0v8c0 4-3 7-6.5 7-2.5 0-4-1-5.5-3l-3-4.5a1.5 1.5 0 0 1 2.4-1.8L9 14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>', mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l4 6M21 9l-4 6"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>', alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>', star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || IC.star}</svg>`;
const teamVar = t => ({ town: 'var(--town)', mafia: 'var(--mafia)', cult: 'var(--cult)', vampire: 'var(--vamp)', solo: 'var(--solo)', neutral: 'var(--neutral)' }[t] || 'var(--neutral)');

const S = { cfg: null, me: LS.get(PKEY, null), data: null, stage: 'loading', err: '', code: '', seats: null, pending: null, busy: false,
  show: { card: false, results: false }, sb: null, ch: null, pollT: null, hideT: null, toastMsg: '' };

function haptic(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {} }

async function api(action, { method = 'GET', query = {}, body } = {}) {
  const qs = new URLSearchParams(Object.assign({ action }, query)).toString();
  const r = await fetch('/api/room?' + qs, method === 'GET' ? { cache: 'no-store' } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ action }, body || {})) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Could not reach the game. Check your connection.'), { status: r.status });
  return j;
}
let toastT;
function toast(m) { S.toastMsg = m; renderToast(); clearTimeout(toastT); toastT = setTimeout(() => { S.toastMsg = ''; renderToast(); }, 2800); }
function renderToast() { $('#toast').innerHTML = S.toastMsg ? `<div class="toast" role="status">${esc(S.toastMsg)}</div>` : ''; }

/* ---------- flow ---------- */
async function init() {
  const roomQ = (new URL(location.href).searchParams.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
  try { S.cfg = await api('config'); } catch (e) { S.cfg = null; S.err = e.message; }
  if (S.me && (!roomQ || roomQ === S.me.code)) { S.stage = 'play'; render(); await load(); connect(); return; }
  S.code = roomQ; S.stage = 'join'; render();
  if (roomQ) findRoom(roomQ);
}
async function findRoom(code) {
  S.busy = true; S.err = ''; render();
  try { const j = await api('seats', { query: { code } }); S.code = j.code; S.seats = j.seats; S.stage = 'pick'; }
  catch (e) { S.err = e.message; S.stage = 'join'; }
  S.busy = false; render();
}
async function claim(seat) {
  S.busy = true; render();
  try {
    const j = await api('claim', { method: 'POST', body: { code: S.code, seatId: seat.id } });
    S.me = { code: S.code, seat: seat.id, token: j.token, name: j.name }; LS.set(PKEY, S.me); haptic(50);
    S.stage = 'play'; S.pending = null; history.replaceState(null, '', '/play?room=' + S.code);
    await load(); connect(); ping();
  } catch (e) { S.err = e.message; S.pending = null; await findRoom(S.code); }
  S.busy = false; render();
}
async function load(markSeen) {
  if (!S.me) return;
  try {
    const j = await api('view', { query: Object.assign({ code: S.me.code, seat: S.me.seat, token: S.me.token }, markSeen ? { seen: '1' } : {}) });
    const before = S.data ? JSON.stringify(S.data.view.results || []) : null;
    const wasAlive = S.data && S.data.view.alive; const prevPhase = S.data && S.data.publicView && S.data.publicView.phase;
    S.data = j; S.err = '';
    if (before !== null && JSON.stringify(j.view.results || []) !== before && (j.view.results || []).length) haptic([60, 60, 60]);
    if (wasAlive && !j.view.alive) haptic([100, 50, 100, 50, 200]);
    if (prevPhase && prevPhase !== 'ended' && j.publicView.phase === 'ended') haptic([50, 30, 50, 30, 50]);
    render();
  } catch (e) {
    if (e.status === 404 || e.status === 403) return leave(e.message === 'seat-reset' ? 'The Game Master reset your seat. Join again.' : 'That game has ended or your seat was removed. Join again.');
    S.err = 'Reconnecting…'; render();
  }
}
function connect() {
  disconnect();
  const rt = S.cfg && S.cfg.realtime;
  if (rt && window.supabase && window.supabase.createClient) {
    try {
      S.sb = S.sb || window.supabase.createClient(rt.url, rt.key, { auth: { persistSession: false, autoRefreshToken: false } });
      S.ch = S.sb.channel('omerta-' + S.me.code, { config: { broadcast: { self: false } } });
      S.ch.on('broadcast', { event: 'update' }, () => load()).subscribe();
    } catch (e) { S.ch = null; }
  }
  S.pollT = setInterval(() => load(), S.ch ? 20000 : 3000);
}
function disconnect() { clearInterval(S.pollT); if (S.ch && S.sb) { try { S.sb.removeChannel(S.ch); } catch (e) {} } S.ch = null; }
function ping() { if (S.ch) Promise.resolve(S.ch.send({ type: 'broadcast', event: 'player', payload: {} })).catch(() => {}); }
function leave(msg) { disconnect(); LS.del(PKEY); S.me = null; S.data = null; S.stage = 'join'; S.err = msg || ''; S.show = { card: false, results: false }; render(); }
async function vote(target) {
  const v = S.data.publicView.vote; if (!v) return;
  const prev = S.data.myVote; S.data.myVote = target; render();
  try { await api('vote', { method: 'POST', body: { code: S.me.code, seat: S.me.seat, token: S.me.token, voteKey: v.key, target } }); ping(); haptic(target === null ? 20 : [30, 20, 30]); toast(target === null ? 'Vote withdrawn' : 'Vote sent'); }
  catch (e) { S.data.myVote = prev; toast(e.message); load(); }
}
function reveal(which) {
  S.show[which] = true; haptic(which === 'card' ? [40, 30, 40] : 30); render();
  clearTimeout(S.hideT); S.hideT = setTimeout(() => { S.show.card = false; S.show.results = false; render(); }, 20000);
  if (which === 'card') { load(true).then(ping); }
  if (which === 'results' && S.data) { const r = S.data.view.results || []; if (r[0]) LS.set(SEENKEY, { code: S.me.code, night: r[0].night }); }
}

/* ---------- screens ---------- */
function header() {
  return `<header class="top"><span class="brand">Omertà</span>${S.me ? `<span class="phasechip" style="max-width:62vw;overflow:hidden;text-overflow:ellipsis">${esc(S.me.name)} · ${esc(S.me.code)}</span>` : ''}</header>`;
}
function joinScreen() {
  return `<section class="pl-hero">${icon('user', 'xl')}<h1 class="display">Join the game</h1><p class="ash">Type the room code the Game Master shows you.</p></section>
    <div class="panel"><label class="field" for="code"><span>Room code</span></label>
      <input id="code" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" maxlength="5" placeholder="ABCDE" value="${esc(S.code)}" style="font-size:28px;letter-spacing:.3em;text-transform:uppercase;text-align:center">
      ${S.err ? `<p class="small" style="color:var(--warn)">${icon('alert', 'sm')} ${esc(S.err)}</p>` : ''}
      <button class="btn primary block big" style="margin-top:14px" data-a="find" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Looking…' : 'Find my game'}</button></div>`;
}
function pickScreen() {
  if (S.pending) return `<section class="pl-hero"><h1 class="display">Are you ${esc(S.pending.name)}?</h1><p class="ash">Once you join, only the Game Master can move you to another name.</p></section>
    <button class="btn primary block big" data-a="claim" ${S.busy ? 'disabled' : ''}>${icon('check')} Yes, I'm ${esc(S.pending.name)}</button>
    <button class="btn ghost block" style="margin-top:10px" data-a="unpick">No, go back</button>`;
  const seats = S.seats || [];
  return `<section class="pl-hero"><h1 class="display">Who are you?</h1><p class="ash">Room ${esc(S.code)} · tap your own name.</p></section>
    ${S.err ? `<p class="small" style="color:var(--warn)">${icon('alert', 'sm')} ${esc(S.err)}</p>` : ''}
    <div class="targets">${seats.map(s => `<button class="tgt" data-a="pick" data-v="${esc(s.id)}" ${s.claimed ? 'disabled' : ''}><span>${esc(s.name)}${s.claimed ? '<span class="why">Already joined</span>' : ''}</span></button>`).join('') || '<p class="ash">The Game Master hasn\'t added players yet. Pull down to refresh in a moment.</p>'}</div>
    <div class="row" style="margin-top:14px"><button class="btn ghost sm" data-a="refresh-seats">Refresh</button><button class="btn ghost sm" data-a="change-code">Different code</button></div>`;
}
function roleBlock() {
  const c = S.data.view.card; if (!c) return '';
  if (!S.show.card) return `<div class="panel pl-hidden"><div><div class="small ash">Your role</div><div class="pl-hint">Hidden — hold to look. Shield your screen.</div></div>
    <button class="hold" data-hold="card" data-ms="500"><i class="fillbar"></i><span>${icon('eye', 'sm')} Hold to see</span></button></div>`;
  return `<div class="rolecard" style="--team:${teamVar(c.team)};width:100%">
    <div class="row between"><span class="chip ${c.team}">${esc(c.teamName)}</span><button class="btn sm" data-a="hide">${icon('eyeoff', 'sm')} Hide</button></div>
    <div class="who" style="margin-top:12px">${esc(c.name)}, you are the</div><h2 class="display">${esc(c.roleName)}</h2>
    <p style="margin:6px 0 0">${esc(c.desc)}</p>
    ${c.abilities && c.abilities.length ? `<div class="blk"><h4>Abilities</h4><ul>${c.abilities.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
    <div class="blk"><h4>You win when</h4><div>${esc(c.winText)}</div></div>
    ${c.teammates && c.teammates.length ? `<div class="blk"><h4>Your allies</h4>${c.teammates.map(t => `<div>${esc(t.name)} <span class="muted">· ${esc(t.role)}${t.alive ? '' : ' · dead'}</span></div>`).join('')}</div>` : ''}
    ${c.target ? `<div class="blk"><h4>Your target</h4><div class="display" style="font-size:24px">${esc(c.target)}</div></div>` : ''}
    ${c.lover ? `<div class="blk"><h4>Your lover</h4><div>${esc(c.lover)}</div></div>` : ''}
    <p class="tiny muted" style="margin:12px 0 0">Hides by itself in 20 seconds.</p></div>`;
}
function resultsBlock() {
  const r = S.data.view.results || []; if (!r.length) return '';
  const seen = LS.get(SEENKEY, {}); const isNew = !(seen.code === S.me.code && seen.night >= r[0].night);
  if (!S.show.results) return `<div class="panel pl-hidden"><div><div class="small ash">Your private results ${isNew ? '<span class="chip warn" style="min-height:22px">New</span>' : ''}</div><div class="pl-hint">Only for you — hold to read.</div></div>
    <button class="hold" data-hold="results" data-ms="500"><i class="fillbar"></i><span>${icon('eye', 'sm')} Hold to read</span></button></div>`;
  return `<div class="panel glow"><div class="row between"><h3>Your private results</h3><button class="btn sm" data-a="hide">${icon('eyeoff', 'sm')} Hide</button></div>
    ${r.map(x => `<div style="margin-top:10px"><div class="small ash">Night ${x.night}</div>${x.messages.map(m => `<div class="msg result">${esc(m)}</div>`).join('')}</div>`).join('')}</div>`;
}
function announceBlock(pv) {
  const a = pv.announce; let h = '';
  if (a) {
    if (a.custom) h += `<div class="ann"><div class="r" style="color:var(--bone);white-space:pre-wrap">${esc(a.custom)}</div></div>`;
    else h += a.deaths.length ? a.deaths.map(d => `<div class="ann"><div class="n">${esc(d.name)}</div>${d.role ? `<div class="r">was the ${esc(d.role)}</div>` : d.hidden ? '<div class="r">Their role could not be determined.</div>' : ''}${d.cause ? `<div class="r">${esc(d.cause[0].toUpperCase() + d.cause.slice(1))}.</div>` : ''}</div>`).join('') : '<div class="ann"><div class="r" style="color:var(--bone)">Nobody died last night.</div></div>';
    h += (a.notes || []).map(t => `<div class="ann"><div class="r" style="color:var(--bone)">${esc(t)}</div></div>`).join('');
  }
  h += (pv.notes || []).filter(t => !(a && (a.notes || []).includes(t))).map(t => `<div class="ann"><div class="r" style="color:var(--bone)">${esc(t)}</div></div>`).join('');
  return h ? `<div class="section"><h3>This morning</h3><div style="margin-top:8px">${h}</div></div>` : '';
}
function voteBlock(pv) {
  const v = pv.vote; const me = S.data.view;
  if (pv.voteResult) return `<div class="panel section"><h3>The vote</h3><p style="font-size:18px;margin:6px 0 0">${esc(pv.voteResult)}</p></div>`;
  if (!v) return '';
  if (!v.eligible.includes(me.id)) return `<div class="panel section"><h3>Voting is open</h3><p class="ash" style="margin:6px 0 0">${me.alive ? "You can't vote this round." : 'You are out, so you cannot vote.'}</p></div>`;
  const opts = v.nominees.concat(v.allowSkip ? [{ id: 'skip', name: 'No execution' }] : []);
  return `<div class="panel glow section"><h3>${icon('hand', 'sm')} Vote${v.round > 1 ? ` · round ${v.round}` : ''}</h3>
    <p class="small ash">Tap who should be executed. You can change your vote until the Game Master locks it.</p>
    <div class="targets" style="margin-top:8px">${opts.map(o => `<button class="tgt" data-a="vote" data-v="${esc(o.id)}" aria-pressed="${S.data.myVote === o.id}"><span>${esc(o.name)}</span>${S.data.myVote === o.id ? `<span class="tag">${icon('check', 'sm')}</span>` : ''}</button>`).join('')}</div>
    ${S.data.myVote ? `<button class="btn ghost sm" style="margin-top:10px" data-a="unvote">Take my vote back</button>` : ''}</div>`;
}
function playScreen() {
  if (!S.data) return `<section class="pl-hero"><p class="ash">Connecting…</p></section>`;
  const pv = S.data.publicView || {}; const me = S.data.view; const ph = pv.phase || 'setup';
  document.body.dataset.phase = ph === 'ended' ? 'ended' : ph;
  let h = S.err ? `<p class="small" style="color:var(--warn)">${icon('alert', 'sm')} ${esc(S.err)}</p>` : '';
  if (ph === 'ended' && pv.result) {
    const r = pv.result;
    h += `<section class="pl-hero"><div class="small ash">The game is over</div><h1 class="display">${esc(r.factionName)} ${r.faction === 'draw' || (r.faction || '').startsWith('solo:') ? 'wins' : 'win'}</h1><p class="ash">${esc(r.reason)}</p></section>
      <div class="panel"><h3>Winners</h3><div class="row" style="margin-top:8px">${r.winners.map(w => `<span class="chip ok">${esc(w.name)}</span>`).join('') || '<span class="muted">Nobody</span>'}</div></div>
      <div class="panel section"><h3>Every role</h3>${r.roles.map(x => `<div class="prow" style="grid-template-columns:minmax(0,1fr) auto"><div><b>${esc(x.name)}</b> <span class="muted small">· ${esc(x.team)}</span></div><span class="small">${esc(x.role)}${x.alive ? '' : ' ' + icon('skull', 'sm')}</span></div>`).join('')}</div>`;
    return h;
  }
  if (!me.alive) h += `<div class="panel section" style="border-color:color-mix(in srgb,var(--danger) 45%,transparent)"><h3>${icon('skull', 'sm')} You're out</h3><p class="ash" style="margin:4px 0 0">Stay silent until the game ends — no hints, no reactions.</p></div>`;
  if (ph === 'setup') h += me.card ? `<section class="pl-hero"><h1 class="display">Your role is ready</h1><p class="ash">Shield your screen, then hold the button. Tell no one.</p></section>`
    : `<section class="pl-hero">${icon('check', 'xl')}<h1 class="display">You're in, ${esc(me.name)}</h1><p class="ash">Waiting for the Game Master to deal the roles. Keep this page open.</p></section>`;
  if (ph === 'night') h += `<section class="pl-hero pl-night"><div class="moon" style="width:84px;height:84px"><div class="shade" style="transform:translateX(${pv.night % 2 === 0 ? 110 : 45}%)"></div></div><h1 class="display">Night ${pv.night}</h1><p class="ash">Close your eyes and put your phone face down. The Game Master will wake you if your role acts.</p></section>`;
  if (ph === 'day') {
    h += `<section class="pl-hero"><div class="sun" style="width:72px;height:72px"></div><h1 class="display">Day ${pv.day}</h1></section>`;
    if (me.today && me.today.mute) h += `<div class="panel section" style="border-color:var(--warn)"><b>${icon('mute', 'sm')} You've been blackmailed.</b> You may not speak today. You may still vote.</div>`;
    if (me.today && me.today.noVote) h += `<div class="panel section" style="border-color:var(--warn)"><b>You've been silenced.</b> You may not vote today.</div>`;
    h += announceBlock(pv) + voteBlock(pv);
  }
  h += `<div class="section stack">${roleBlock()}${resultsBlock()}</div>`;
  const alive = (pv.players || []).filter(p => p.alive), dead = (pv.players || []).filter(p => !p.alive);
  if (ph !== 'setup' && pv.players) h += `<div class="panel section"><h3>Players</h3><p class="small ash" style="margin:4px 0 8px">${alive.length} alive · ${dead.length} out</p>
    <div class="row" style="gap:6px">${alive.map(p => `<span class="chip">${esc(p.name)}</span>`).join('')}${dead.map(p => `<span class="chip dead">${icon('skull', 'sm')} ${esc(p.name)}${p.role ? ' · ' + esc(p.role) : ''}</span>`).join('')}</div></div>`;
  h += `<div class="row" style="margin:22px 0 40px;justify-content:center"><button class="btn ghost sm" data-a="leave">Leave this game on this phone</button></div>`;
  return h;
}
function render() {
  const body = S.stage === 'join' ? joinScreen() : S.stage === 'pick' ? pickScreen() : S.stage === 'play' ? playScreen() : '<section class="pl-hero"><p class="ash">Loading…</p></section>';
  if (S.stage !== 'play') document.body.dataset.phase = 'setup';
  const ae = document.activeElement; const fid = ae && ae.id; const val = fid === 'code' ? ae.value : null;
  $('#app').innerHTML = `${header()}<main class="pl-main" id="main">${body}</main>`;
  if (fid) { const el = document.getElementById(fid); if (el) { if (val !== null) el.value = val; el.focus({ preventScroll: true }); } }
  bindHolds(); renderToast();
}

/* ---------- events ---------- */
let holdT = null;
function bindHolds() {
  document.querySelectorAll('[data-hold]').forEach(el => {
    const ms = +(el.dataset.ms || 500); el.style.setProperty('--hold', ms + 'ms');
    const start = e => { if (e.type === 'keydown' && !(e.key === ' ' || e.key === 'Enter')) return; if (e.repeat) return; e.preventDefault(); el.classList.add('holding'); clearTimeout(holdT); holdT = setTimeout(() => { el.classList.remove('holding'); reveal(el.dataset.hold); }, ms); };
    const stop = () => { el.classList.remove('holding'); clearTimeout(holdT); };
    el.addEventListener('pointerdown', start); el.addEventListener('keydown', start);
    ['pointerup', 'pointerleave', 'pointercancel', 'keyup', 'blur'].forEach(t => el.addEventListener(t, stop));
    el.addEventListener('contextmenu', e => e.preventDefault());
  });
}
const ACT = {
  find() { const c = ($('#code').value || '').toUpperCase().replace(/[^A-Z]/g, ''); if (c.length !== 5) { S.err = 'Room codes have 5 letters.'; render(); return; } S.code = c; findRoom(c); },
  pick(id) { S.pending = (S.seats || []).find(s => s.id === id) || null; S.err = ''; render(); },
  unpick() { S.pending = null; render(); },
  claim() { if (S.pending) claim(S.pending); },
  'refresh-seats'() { findRoom(S.code); },
  'change-code'() { S.stage = 'join'; S.seats = null; S.err = ''; render(); },
  hide() { clearTimeout(S.hideT); S.show.card = false; S.show.results = false; render(); },
  vote(id) { vote(S.data.myVote === id ? null : id); },
  unvote() { vote(null); },
  leave() { if (confirm('Leave this game on this phone? You can rejoin only if the Game Master resets your seat.')) leave(''); },
};
document.addEventListener('click', e => { const el = e.target.closest('[data-a]'); if (!el || el.disabled) return; e.preventDefault(); const f = ACT[el.dataset.a]; if (f) f(el.dataset.v); });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.id === 'code') ACT.find(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) load(); });
init();

