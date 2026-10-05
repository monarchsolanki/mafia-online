// Omertà online API. The Game Master's phone is the brain: it computes every player's private
// slice and uploads it. The server stores slices and gives each phone ONLY its own, by token.
'use strict';
const crypto = require('crypto');
const { config } = require('./store');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, so codes read cleanly aloud
const LIMITS = { seats: 40, name: 24, view: 24000, publicView: 80000 };
const ROOM_TTL_HOURS = 48;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const newCode = () => Array.from(crypto.randomBytes(5), b => ALPHABET[b % ALPHABET.length]).join('');
const newSecret = () => crypto.randomBytes(24).toString('base64url');
const sha = v => crypto.createHash('sha256').update(String(v)).digest('hex');
function sameHash(plain, stored) {
  if (!plain || !stored) return false;
  const a = Buffer.from(sha(plain)), b = Buffer.from(String(stored));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const cleanCode = c => String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(id);
const size = o => Buffer.byteLength(JSON.stringify(o || {}));

async function hostRoom(store, b) {
  const room = await store.getRoom(cleanCode(b.code));
  if (!room) fail(404, 'This room no longer exists.');
  if (!sameHash(b.hostSecret, room.host_hash)) fail(403, 'Not the host of this room.');
  return room;
}
async function playerSeat(store, code, seatId, token) {
  if (!validId(seatId)) fail(400, 'Bad seat.');
  const seat = await store.getSeat(code, seatId);
  if (!seat) fail(404, 'seat-gone');
  if (!sameHash(token, seat.token_hash)) fail(403, 'seat-reset');
  return seat;
}

async function handle(store, method, q, b) {
  const action = q.action || b.action;
  const isPost = method === 'POST';
  switch (action) {
    case 'config': {
      const c = config();
      return { realtime: c.url && c.publishableKey ? { url: c.url, key: c.publishableKey } : null, storage: store.kind };
    }
    case 'create': {
      if (!isPost) fail(405, 'Use POST.');
      try { await store.pruneRooms(new Date(Date.now() - ROOM_TTL_HOURS * 3600e3).toISOString()); } catch (e) { /* housekeeping only */ }
      for (let i = 0; i < 8; i++) {
        const code = newCode(), secret = newSecret();
        if (await store.insertRoom({ code, host_hash: sha(secret), version: 0, public_view: {}, updated_at: new Date().toISOString() })) return { code, hostSecret: secret };
      }
      fail(503, 'Could not create a room. Try again.');
    }
    case 'sync': {
      if (!isPost) fail(405, 'Use POST.');
      const room = await hostRoom(store, b);
      const seats = Array.isArray(b.seats) ? b.seats : fail(400, 'seats missing');
      if (seats.length > LIMITS.seats) fail(400, `At most ${LIMITS.seats} players.`);
      const views = b.views && typeof b.views === 'object' ? b.views : {};
      const rows = seats.map((s, i) => {
        if (!s || !validId(s.id) || typeof s.name !== 'string') fail(400, 'Bad seat data.');
        const view = views[s.id] || {};
        if (size(view) > LIMITS.view) fail(413, 'A player view is too large.');
        return { seat_id: s.id, ord: i, name: s.name.slice(0, LIMITS.name), view };
      });
      const publicView = b.publicView && typeof b.publicView === 'object' ? b.publicView : {};
      if (size(publicView) > LIMITS.publicView) fail(413, 'Public view too large.');
      await store.upsertSeats(room.code, rows);
      await store.deleteSeatsExcept(room.code, rows.map(r => r.seat_id));
      await store.updateRoom(room.code, { version: Number(b.version) || Date.now(), public_view: publicView, updated_at: new Date().toISOString() });
      return { ok: true };
    }
    case 'status': {
      if (!isPost) fail(405, 'Use POST.');
      const room = await hostRoom(store, b);
      const seats = await store.listSeats(room.code);
      const votes = typeof b.voteKey === 'string' && b.voteKey ? await store.listVotes(room.code, b.voteKey) : [];
      return {
        seats: seats.map(s => ({ id: s.seat_id, name: s.name, claimed: !!s.token_hash, seen: !!s.seen_at })),
        votes: votes.map(v => ({ seat: v.seat_id, target: v.target, at: v.updated_at, key: b.voteKey })),
      };
    }
    case 'resetSeat': {
      if (!isPost) fail(405, 'Use POST.');
      const room = await hostRoom(store, b);
      if (!validId(b.seatId)) fail(400, 'Bad seat.');
      await store.patchSeat(room.code, b.seatId, { token_hash: null, claimed_at: null, seen_at: null });
      return { ok: true };
    }
    case 'close': {
      if (!isPost) fail(405, 'Use POST.');
      const room = await hostRoom(store, b);
      await store.deleteRoom(room.code);
      return { ok: true };
    }
    case 'seats': {
      const code = cleanCode(q.code || b.code);
      const room = await store.getRoom(code);
      if (!room) fail(404, 'No room with that code. Check it with the Game Master.');
      const seats = await store.listSeats(code);
      return { code, phase: (room.public_view && room.public_view.phase) || 'setup', seats: seats.map(s => ({ id: s.seat_id, name: s.name, claimed: !!s.token_hash })) };
    }
    case 'claim': {
      if (!isPost) fail(405, 'Use POST.');
      const code = cleanCode(b.code);
      if (!validId(b.seatId)) fail(400, 'Bad seat.');
      const seat = await store.getSeat(code, b.seatId);
      if (!seat) fail(404, 'That name is no longer in the game.');
      const token = newSecret();
      if (!(await store.claimSeat(code, b.seatId, sha(token)))) fail(409, `Someone has already joined as ${seat.name}. Ask the Game Master to reset that seat if it wasn't you.`);
      return { token, name: seat.name };
    }
    case 'view': {
      const code = cleanCode(q.code);
      const seat = await playerSeat(store, code, q.seat, q.token);
      if (q.seen === '1' && !seat.seen_at) await store.patchSeat(code, seat.seat_id, { seen_at: new Date().toISOString() });
      const room = await store.getRoom(code);
      if (!room) fail(404, 'room-gone');
      const pv = room.public_view || {};
      const myVote = pv.vote && pv.vote.key ? await store.getVote(code, seat.seat_id, pv.vote.key) : null;
      return { version: room.version, name: seat.name, view: seat.view || {}, publicView: pv, myVote: myVote ? myVote.target : null };
    }
    case 'vote': {
      if (!isPost) fail(405, 'Use POST.');
      const code = cleanCode(b.code);
      const seat = await playerSeat(store, code, b.seat, b.token);
      const room = await store.getRoom(code);
      const v = room && room.public_view && room.public_view.vote;
      if (!v || v.key !== b.voteKey) fail(409, 'Voting is closed.');
      if (!(v.eligible || []).includes(seat.seat_id)) fail(403, "You can't vote right now.");
      const t = b.target == null ? null : String(b.target);
      const ok = t === null || (t === 'skip' && v.allowSkip) || (v.nominees || []).some(n => n.id === t);
      if (!ok) fail(400, 'That player is not on trial.');
      await store.upsertVote(code, seat.seat_id, v.key, t);
      return { ok: true, target: t };
    }
    default: fail(400, 'Unknown action.');
  }
}

module.exports = { handle, HttpError, sha, cleanCode };
