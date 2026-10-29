// Storage for Omertà online rooms.
// Production: Supabase Postgres through its REST API, using the SECRET (server-only) key.
// Local development: an in-memory store (never used on Vercel, where memory is not shared).
'use strict';

const httpError = (status, message, extra) => Object.assign(new Error(message), { status }, extra || {});

// Values pasted into Vercel often carry stray quotes, spaces or a trailing line break. Clean them before use.
function clean(v) {
  let t = String(v == null ? '' : v).trim();
  const quoted = t.match(/^(["'`])([\s\S]*)\1$/);
  if (quoted) t = quoted[2].trim();
  return t;
}
function env(...names) { for (const n of names) { const v = clean(process.env[n]); if (v) return v; } return ''; }

// Accept "abcd.supabase.co", "https://abcd.supabase.co/" and "https://abcd.supabase.co/rest/v1" alike.
function normalizeUrl(raw) {
  let u = clean(raw);
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '').replace(/\/rest\/v1$/i, '').replace(/\/+$/, '');
}
function urlProblem(url) {
  try { const u = new URL(url); if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol'); return ''; }
  catch (e) { return 'SUPABASE_URL is not a valid web address. Copy the Project URL from Supabase (it looks like https://abcd1234.supabase.co) into Vercel → Settings → Environment Variables, then redeploy.'; }
}
// Real keys are plain visible ASCII. A masked key copied from the dashboard contains "•", which breaks every request.
function keyProblem(key, name) {
  if (/[^\x21-\x7e]/.test(key)) return `${name} contains a character a key cannot have (such as •, a space or a line break). Reveal the full key in Supabase, copy it again into Vercel → Settings → Environment Variables, then redeploy.`;
  return '';
}
function jwtRole(key) {
  try { const p = key.split('.')[1]; return JSON.parse(Buffer.from(p, 'base64url').toString('utf8')).role || ''; } catch (e) { return ''; }
}

const config = () => {
  const publishableKey = env('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return {
    url: normalizeUrl(env('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL')),
    secretKey: env('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'),
    publishableKey: keyProblem(publishableKey, '') ? '' : publishableKey, // a broken key only costs live updates; phones then poll
  };
};

function netError(e, host) {
  const code = (e && e.cause && e.cause.code) || (e && e.code) || '';
  const name = (e && e.name) || 'Error';
  if (name === 'TimeoutError' || name === 'AbortError') return httpError(504, `Supabase (${host}) did not answer in time. If the project was paused, open the Supabase dashboard and restore it, then try again.`);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return httpError(502, `Cannot find a Supabase project at ${host}. Check SUPABASE_URL in Vercel, or the project may be paused or deleted — restore it in the Supabase dashboard.`);
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return httpError(502, `Cannot connect to Supabase at ${host} (${code}). Try again in a moment.`);
  return httpError(502, `Could not reach Supabase at ${host} (${name}${code ? ' ' + code : ''}). Check SUPABASE_URL in Vercel.`);
}
function dbError(status, text) {
  let j = null; try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
  const code = j && j.code, msg = (j && (j.message || j.msg || j.error_description || j.error)) || '';
  let say;
  if (status === 401 || /invalid api key|invalid jwt/i.test(msg)) say = 'Supabase rejected the secret key. Copy it again (Supabase → Project Settings → API Keys) into SUPABASE_SECRET_KEY in Vercel, then redeploy.';
  else if (code === '42P01' || code === 'PGRST205' || (status === 404 && /relation|table/i.test(msg))) say = 'The database tables are missing. In Supabase open SQL Editor, paste everything from supabase/schema.sql and run it.';
  else if (code === '42501' || status === 403) say = 'Supabase denied access to the tables. Run supabase/schema.sql again (it grants the server key access) and make sure SUPABASE_SECRET_KEY is the secret key, not the publishable one.';
  else if (status === 540 || /paused/i.test(text)) say = 'The Supabase project is paused. Open the Supabase dashboard and restore it, then try again.';
  else if (status >= 500) say = `Supabase is having trouble right now (error ${status}). Try again in a moment.`;
  else say = `Database error ${status}: ${String(msg || text).slice(0, 200)}`;
  return httpError(502, say, { dbStatus: status, dbCode: code });
}

const TIMEOUT_MS = 8000;

function supabaseStore({ url, secretKey }) {
  const base = url + '/rest/v1/'; const host = new URL(url).host;
  // New-style keys (sb_secret_...) go in the apikey header only; legacy JWT keys also as a Bearer token.
  const headers = extra => Object.assign({ apikey: secretKey, 'Content-Type': 'application/json' },
    secretKey.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + secretKey }, extra || {});
  async function req(method, path, body, prefer) {
    let res, text;
    try {
      res = await fetch(base + path, { method, headers: headers(prefer ? { Prefer: prefer } : null), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
      text = await res.text();
    } catch (e) { throw netError(e, host); }
    if (!res.ok) throw dbError(res.status, text);
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { throw httpError(502, `Supabase at ${host} sent an unexpected reply. Check that SUPABASE_URL is the Project URL (https://abcd1234.supabase.co).`); }
  }
  const q = encodeURIComponent;
  return {
    kind: 'supabase',
    async getRoom(code) { const r = await req('GET', `rooms?code=eq.${q(code)}&select=*`); return r[0] || null; },
    async insertRoom(room) {
      try { await req('POST', 'rooms', room, 'return=minimal'); return true; }
      catch (e) { if (e.dbStatus === 409) return false; throw e; }
    },
    async updateRoom(code, patch) { await req('PATCH', `rooms?code=eq.${q(code)}`, patch, 'return=minimal'); },
    async deleteRoom(code) { await req('DELETE', `rooms?code=eq.${q(code)}`, undefined, 'return=minimal'); },
    async pruneRooms(beforeIso) { await req('DELETE', `rooms?updated_at=lt.${q(beforeIso)}`, undefined, 'return=minimal'); },
    async listSeats(code) { return req('GET', `seats?room_code=eq.${q(code)}&select=seat_id,ord,name,token_hash,claimed_at,seen_at&order=ord.asc`); },
    async getSeat(code, id) { const r = await req('GET', `seats?room_code=eq.${q(code)}&seat_id=eq.${q(id)}&select=*`); return r[0] || null; },
    async upsertSeats(code, rows) {
      if (!rows.length) return;
      await req('POST', 'seats?on_conflict=room_code,seat_id', rows.map(r => ({ room_code: code, seat_id: r.seat_id, ord: r.ord, name: r.name, view: r.view })), 'resolution=merge-duplicates,return=minimal');
    },
    async deleteSeatsExcept(code, keep) {
      const filter = keep.length ? `&seat_id=not.in.(${keep.map(q).join(',')})` : '';
      await req('DELETE', `seats?room_code=eq.${q(code)}${filter}`, undefined, 'return=minimal');
    },
    async claimSeat(code, id, tokenHash) {
      const rows = await req('PATCH', `seats?room_code=eq.${q(code)}&seat_id=eq.${q(id)}&token_hash=is.null`, { token_hash: tokenHash, claimed_at: new Date().toISOString() }, 'return=representation');
      return Array.isArray(rows) && rows.length === 1;
    },
    async patchSeat(code, id, patch) { await req('PATCH', `seats?room_code=eq.${q(code)}&seat_id=eq.${q(id)}`, patch, 'return=minimal'); },
    async listVotes(code, key) { return req('GET', `votes?room_code=eq.${q(code)}&vote_key=eq.${q(key)}&select=seat_id,target,updated_at`); },
    async getVote(code, id, key) { const r = await req('GET', `votes?room_code=eq.${q(code)}&seat_id=eq.${q(id)}&vote_key=eq.${q(key)}&select=target`); return r[0] || null; },
    async upsertVote(code, id, key, target) {
      await req('POST', 'votes?on_conflict=room_code,seat_id,vote_key', [{ room_code: code, seat_id: id, vote_key: key, target, updated_at: new Date().toISOString() }], 'resolution=merge-duplicates,return=minimal');
    },
  };
}

function memoryStore() {
  const rooms = new Map(), seats = new Map(), votes = new Map();
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const seatsOf = code => { if (!seats.has(code)) seats.set(code, new Map()); return seats.get(code); };
  const votesOf = code => { if (!votes.has(code)) votes.set(code, new Map()); return votes.get(code); };
  return {
    kind: 'memory',
    async getRoom(code) { return clone(rooms.get(code)) || null; },
    async insertRoom(room) { if (rooms.has(room.code)) return false; rooms.set(room.code, Object.assign({ updated_at: new Date().toISOString() }, clone(room))); return true; },
    async updateRoom(code, patch) { const r = rooms.get(code); if (r) Object.assign(r, clone(patch)); },
    async deleteRoom(code) { rooms.delete(code); seats.delete(code); votes.delete(code); },
    async pruneRooms(beforeIso) { for (const [c, r] of rooms) if ((r.updated_at || '') < beforeIso) this.deleteRoom(c); },
    async listSeats(code) { return [...seatsOf(code).values()].sort((a, b) => a.ord - b.ord).map(s => clone({ seat_id: s.seat_id, ord: s.ord, name: s.name, token_hash: s.token_hash, claimed_at: s.claimed_at, seen_at: s.seen_at })); },
    async getSeat(code, id) { return clone(seatsOf(code).get(id)) || null; },
    async upsertSeats(code, rows) { const m = seatsOf(code); for (const r of rows) { const cur = m.get(r.seat_id) || { seat_id: r.seat_id, token_hash: null, claimed_at: null, seen_at: null }; Object.assign(cur, clone({ ord: r.ord, name: r.name, view: r.view })); m.set(r.seat_id, cur); } },
    async deleteSeatsExcept(code, keep) { const m = seatsOf(code); for (const id of [...m.keys()]) if (!keep.includes(id)) m.delete(id); },
    async claimSeat(code, id, tokenHash) { const s = seatsOf(code).get(id); if (!s || s.token_hash) return false; s.token_hash = tokenHash; s.claimed_at = new Date().toISOString(); return true; },
    async patchSeat(code, id, patch) { const s = seatsOf(code).get(id); if (s) Object.assign(s, clone(patch)); },
    async listVotes(code, key) { return [...votesOf(code).values()].filter(v => v.vote_key === key).map(v => clone({ seat_id: v.seat_id, target: v.target, updated_at: v.updated_at })); },
    async getVote(code, id, key) { const v = votesOf(code).get(id + '|' + key); return v ? { target: v.target } : null; },
    async upsertVote(code, id, key, target) { votesOf(code).set(id + '|' + key, { seat_id: id, vote_key: key, target, updated_at: new Date().toISOString() }); },
  };
}

let memo = null;
function getStore() {
  const c = config();
  if (c.url || c.secretKey) {
    if (!c.url) throw httpError(503, 'SUPABASE_URL is missing. Add the Project URL in Vercel → Settings → Environment Variables, then redeploy.');
    if (!c.secretKey) throw httpError(503, 'SUPABASE_SECRET_KEY is missing. Add the secret key in Vercel → Settings → Environment Variables, then redeploy.');
    const bad = urlProblem(c.url) || keyProblem(c.secretKey, 'SUPABASE_SECRET_KEY');
    if (bad) throw httpError(503, bad);
    return supabaseStore(c);
  }
  if (process.env.VERCEL) throw httpError(503, 'Online play is not set up yet: add SUPABASE_URL and SUPABASE_SECRET_KEY in Vercel → Settings → Environment Variables, then redeploy.');
  return memo || (memo = memoryStore());
}

// Walks through everything online play depends on and says which part is wrong. Never reveals a secret.
async function diagnose() {
  const steps = [];
  const add = (name, ok, detail, fix) => steps.push({ name, ok, detail, fix: ok ? '' : fix || '' });
  const done = storage => ({ ok: steps.every(s => s.ok), storage, steps });
  const rawUrl = env('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'), key = env('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!rawUrl && !key) {
    if (!process.env.VERCEL) { add('Storage', true, 'Local in-memory rooms (development server). Nothing to set up.'); return done('memory'); }
    add('Settings', false, 'SUPABASE_URL and SUPABASE_SECRET_KEY are not set on this deployment.', 'In Vercel open your project → Settings → Environment Variables, add both (see the README), then redeploy.');
    return done('none');
  }
  const url = normalizeUrl(rawUrl);
  const urlBad = !rawUrl ? 'SUPABASE_URL is not set.' : urlProblem(url);
  add('Project URL', !urlBad, urlBad ? 'Missing or not a valid web address.' : new URL(url).host, urlBad || '');
  let keyBad = !key ? 'SUPABASE_SECRET_KEY is not set.' : keyProblem(key, 'SUPABASE_SECRET_KEY');
  let kind = '';
  if (!keyBad) {
    if (key.startsWith('sb_secret_')) kind = 'new-style secret key';
    else if (key.startsWith('sb_publishable_')) { keyBad = 'This is the publishable key. The server needs the secret key (starts with sb_secret_).'; }
    else if (key.split('.').length === 3) { const role = jwtRole(key); kind = 'legacy ' + (role || 'JWT') + ' key'; if (role && role !== 'service_role') keyBad = `This is the ${role} key. The server needs the service_role (secret) key.`; }
  }
  add('Secret key', !keyBad, keyBad ? 'Missing or the wrong kind of key.' : kind || 'present', keyBad || '');
  const pub = env('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  add('Live updates key', true, !pub ? 'Not set — optional. Phones will check for changes every few seconds instead.' : keyProblem(pub, '') ? 'Looks malformed, so it is ignored — phones will check every few seconds instead.' : 'present');
  if (urlBad || keyBad) return done('supabase');
  const store = supabaseStore({ url, secretKey: key });
  for (const [table, probe] of [['rooms', () => store.getRoom('AAAAA')], ['seats', () => store.getSeat('AAAAA', 'x')], ['votes', () => store.getVote('AAAAA', 'x', 'x')]]) {
    try { await probe(); add(`Table “${table}”`, true, 'reachable'); }
    catch (e) {
      add(`Table “${table}”`, false, e.message.split('. ')[0] + '.', e.message);
      if (!e.dbStatus) break; // network trouble: the other tables would fail the same way
    }
  }
  return done('supabase');
}

module.exports = { getStore, memoryStore, config, diagnose };
