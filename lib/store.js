// Storage for Omertà online rooms.
// Production: Supabase Postgres through its REST API, using the SECRET (server-only) key.
// Local development: an in-memory store (never used on Vercel, where memory is not shared).
'use strict';

function env(...names) { for (const n of names) if (process.env[n]) return process.env[n]; return ''; }

const config = () => ({
  url: env('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'),
  secretKey: env('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'),
  publishableKey: env('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
});

function supabaseStore({ url, secretKey }) {
  const base = url.replace(/\/+$/, '') + '/rest/v1/';
  // New-style keys (sb_secret_...) go in the apikey header only; legacy JWT keys also as a Bearer token.
  const headers = extra => Object.assign({ apikey: secretKey, 'Content-Type': 'application/json' },
    secretKey.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + secretKey }, extra || {});
  async function req(method, path, body, prefer) {
    const res = await fetch(base + path, { method, headers: headers(prefer ? { Prefer: prefer } : null), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) { const e = new Error(`Database error ${res.status}: ${text.slice(0, 300)}`); e.dbStatus = res.status; e.status = 502; throw e; }
    return text ? JSON.parse(text) : null;
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
  if (c.url && c.secretKey) return supabaseStore(c);
  if (process.env.VERCEL) { const e = new Error('Online play is not set up yet: add SUPABASE_URL and SUPABASE_SECRET_KEY in Vercel → Settings → Environment Variables, then redeploy.'); e.status = 503; throw e; }
  return memo || (memo = memoryStore());
}

module.exports = { getStore, memoryStore, config };
