// Omertà online rooms. The Game Master's phone is the brain: it computes every player's private
// slice and uploads it. The server stores slices and gives each phone ONLY its own, by token.
/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "node:crypto";
import { config, type Store } from "./store";
import { fail } from "./http";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O, so codes read cleanly aloud
const LIMITS = { seats: 40, name: 24, view: 24000, publicView: 80000 };
const ROOM_TTL_HOURS = 48;

const newCode = () => Array.from(crypto.randomBytes(5), b => ALPHABET[b % ALPHABET.length]).join("");
const newSecret = () => crypto.randomBytes(24).toString("base64url");
export const sha = (v: unknown) => crypto.createHash("sha256").update(String(v)).digest("hex");
function sameHash(plain: unknown, stored: unknown): boolean {
  if (!plain || !stored) return false;
  const a = Buffer.from(sha(plain)), b = Buffer.from(String(stored));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const cleanCode = (c: unknown) => String(c || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
const validId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,48}$/.test(id);
const size = (o: unknown) => Buffer.byteLength(JSON.stringify(o || {}));
const CHAT_MAX = 280, CHAT_PAGE = 80;
const isOk = (list: any, id: unknown) => Array.isArray(list) && list.some((t: any) => t && t.id === id && t.ok);

/** Checks a night choice from a phone against the options the Game Master's phone computed for that player.
 *  Returns what to store, or fails. The Game Master's phone checks it again against the rules engine. */
function checkNightChoice(view: any, b: any): { step_key: string; ab: string | null; targets: string[]; opts: Record<string, unknown> } {
  const n = view && view.night;
  if (!n || typeof b.nightKey !== "string" || n.key !== b.nightKey) fail(409, "The night has moved on. Your screen will update.");
  const st = (n.steps || []).find((x: any) => x && x.key === b.stepKey);
  if (!st) fail(403, "That choice isn’t yours to make.");
  if (b.pass === true) return { step_key: st.key, ab: null, targets: [], opts: {} };
  const t = Array.isArray(b.targets) ? b.targets.map(String) : [];
  const o = b.opts && typeof b.opts === "object" ? b.opts : {};
  if (st.type === "faction") {
    if (!(st.carriers || []).some((c: any) => c.id === o.carrier)) fail(400, "Pick who carries it out.");
    if (t.length !== 1 || !isOk(st.targets, t[0])) fail(400, "That player can’t be chosen.");
    const strong = !!o.strong && !!(st.strong && st.strong[o.carrier] > 0);
    return { step_key: st.key, ab: st.kind, targets: t, opts: { carrier: o.carrier, strong } };
  }
  const ab = (st.abilities || []).find((a: any) => a && a.id === b.ab);
  if (!ab || !ab.ok) fail(400, "That ability can’t be used tonight.");
  if (ab.target === "self" || ab.target === "none" || ab.target === "assigned") { if (t.length) fail(400, "This ability takes no target."); }
  else if (ab.target === "two") { if (t.length !== 2 || t[0] === t[1] || !isOk(ab.targets, t[0]) || !isOk(ab.targets2 || ab.targets, t[1])) fail(400, "Pick two different players."); }
  else if (t.length !== 1 || !isOk(ab.targets, t[0])) fail(400, "That player can’t be chosen.");
  const opts: Record<string, unknown> = {};
  if (ab.kind === "jail" && o.execute === true && ab.execute > 0) opts.execute = true;
  if (ab.kind === "hypnotize") { if (!(ab.msgs || []).includes(o.msg)) fail(400, "Pick a message."); opts.msg = o.msg; }
  return { step_key: st.key, ab: ab.id, targets: t, opts };
}
const chatOut = (rows: any[], me: string) => rows.map(m => ({ id: Number(m.id), name: m.name, body: m.body, at: m.created_at, mine: m.seat_id === me }));

async function hostRoom(store: Store, b: any) {
  const room = await store.getRoom(cleanCode(b.code));
  if (!room) fail(404, "This room no longer exists.");
  if (!sameHash(b.hostSecret, room!.host_hash)) fail(403, "Not the host of this room.");
  return room!;
}
async function playerSeat(store: Store, code: string, seatId: unknown, token: unknown) {
  if (!validId(seatId)) fail(400, "Bad seat.");
  const seat = await store.getSeat(code, seatId as string);
  if (!seat) fail(404, "seat-gone");
  if (!sameHash(token, seat!.token_hash)) fail(403, "seat-reset");
  return seat!;
}

export async function handleRoom(store: Store, method: string, q: Record<string, string>, b: any): Promise<any> {
  const action = q.action || b.action;
  const isPost = method === "POST";
  switch (action) {
    case "config": {
      const c = config();
      return { realtime: c.url && c.publishableKey ? { url: c.url, key: c.publishableKey } : null, storage: store.kind };
    }
    case "create": {
      if (!isPost) fail(405, "Use POST.");
      try { await store.pruneRooms(new Date(Date.now() - ROOM_TTL_HOURS * 3600e3).toISOString()); } catch { /* housekeeping only */ }
      for (let i = 0; i < 8; i++) {
        const code = newCode(), secret = newSecret();
        if (await store.insertRoom({ code, host_hash: sha(secret), version: 0, public_view: {}, updated_at: new Date().toISOString() })) return { code, hostSecret: secret };
      }
      return fail(503, "Could not create a room. Try again.");
    }
    case "sync": {
      if (!isPost) fail(405, "Use POST.");
      const room = await hostRoom(store, b);
      const seats = Array.isArray(b.seats) ? b.seats : fail(400, "seats missing");
      if (seats.length > LIMITS.seats) fail(400, `At most ${LIMITS.seats} players.`);
      const views = b.views && typeof b.views === "object" ? b.views : {};
      const rows = seats.map((s: any, i: number) => {
        if (!s || !validId(s.id) || typeof s.name !== "string") fail(400, "Bad seat data.");
        const view = views[s.id] || {};
        if (size(view) > LIMITS.view) fail(413, "A player view is too large.");
        return { seat_id: s.id, ord: i, name: s.name.slice(0, LIMITS.name), view };
      });
      const publicView = b.publicView && typeof b.publicView === "object" ? b.publicView : {};
      if (size(publicView) > LIMITS.publicView) fail(413, "Public view too large.");
      await store.upsertSeats(room.code, rows);
      await store.deleteSeatsExcept(room.code, rows.map((r: any) => r.seat_id));
      await store.updateRoom(room.code, { version: Number(b.version) || Date.now(), public_view: publicView, updated_at: new Date().toISOString() });
      return { ok: true };
    }
    case "status": {
      if (!isPost) fail(405, "Use POST.");
      const room = await hostRoom(store, b);
      const seats = await store.listSeats(room.code);
      const votes = typeof b.voteKey === "string" && b.voteKey ? await store.listVotes(room.code, b.voteKey) : [];
      // newer tables: if they are missing, rooms keep working without phone choices or chat
      let night: any[] = [], chat: any[] = [];
      if (typeof b.nightKey === "string" && b.nightKey) { try { night = await store.listNightActions(room.code, b.nightKey); } catch { night = []; } }
      if (b.chat) { try { chat = await store.listChat(room.code, null, 120); } catch { chat = []; } }
      return {
        seats: seats.map(s => ({ id: s.seat_id, name: s.name, claimed: !!s.token_hash, seen: !!s.seen_at })),
        votes: votes.map(v => ({ seat: v.seat_id, target: v.target, at: v.updated_at, key: b.voteKey })),
        night: night.map(r => ({ step: r.step_key, seat: r.seat_id, ab: r.ab, targets: r.targets || [], opts: r.opts || {}, at: r.updated_at, key: b.nightKey })),
        chat: chat.map(m => ({ id: Number(m.id), channel: m.channel, name: m.name, body: m.body, at: m.created_at })),
      };
    }
    case "resetSeat": {
      if (!isPost) fail(405, "Use POST.");
      const room = await hostRoom(store, b);
      if (!validId(b.seatId)) fail(400, "Bad seat.");
      await store.patchSeat(room.code, b.seatId, { token_hash: null, claimed_at: null, seen_at: null });
      return { ok: true };
    }
    case "close": {
      if (!isPost) fail(405, "Use POST.");
      const room = await hostRoom(store, b);
      await store.deleteRoom(room.code);
      return { ok: true };
    }
    case "seats": {
      const code = cleanCode(q.code || b.code);
      const room = await store.getRoom(code);
      if (!room) fail(404, "No room with that code. Check it with the Game Master.");
      const seats = await store.listSeats(code);
      return { code, phase: (room!.public_view && room!.public_view.phase) || "setup", seats: seats.map(s => ({ id: s.seat_id, name: s.name, claimed: !!s.token_hash })) };
    }
    case "claim": {
      if (!isPost) fail(405, "Use POST.");
      const code = cleanCode(b.code);
      if (!validId(b.seatId)) fail(400, "Bad seat.");
      const seat = await store.getSeat(code, b.seatId);
      if (!seat) fail(404, "That name is no longer in the game.");
      const token = newSecret();
      if (!(await store.claimSeat(code, b.seatId, sha(token)))) fail(409, `Someone has already joined as ${seat!.name}. Ask the Game Master to reset that seat if it wasn't you.`);
      return { token, name: seat!.name };
    }
    case "view": {
      const code = cleanCode(q.code);
      const seat = await playerSeat(store, code, q.seat, q.token);
      if (q.seen === "1" && !seat.seen_at) await store.patchSeat(code, seat.seat_id, { seen_at: new Date().toISOString() });
      const room = await store.getRoom(code);
      if (!room) fail(404, "room-gone");
      const pv = room!.public_view || {};
      const myVote = pv.vote && pv.vote.key ? await store.getVote(code, seat.seat_id, pv.vote.key) : null;
      const view = seat.view || {};
      let chat: any[] | null = null;
      if (view.chat && view.chat.channel) { try { chat = chatOut(await store.listChat(code, view.chat.channel, CHAT_PAGE), seat.seat_id); } catch { chat = null; } }
      let sent: Record<string, any> = {};
      if (view.night && view.night.key) {
        try { for (const r of await store.listNightActions(code, view.night.key)) if ((view.night.steps || []).some((x: any) => x.key === r.step_key)) sent[r.step_key] = { ab: r.ab, targets: r.targets || [], opts: r.opts || {}, at: r.updated_at, mine: r.seat_id === seat.seat_id }; }
        catch { sent = {}; }
      }
      return { version: room!.version, name: seat.name, view, publicView: pv, myVote: myVote ? myVote.target : null, chat, sent };
    }
    case "vote": {
      if (!isPost) fail(405, "Use POST.");
      const code = cleanCode(b.code);
      const seat = await playerSeat(store, code, b.seat, b.token);
      const room = await store.getRoom(code);
      const v = room && room.public_view && room.public_view.vote;
      if (!v || v.key !== b.voteKey) fail(409, "Voting is closed.");
      if (!(v.eligible || []).includes(seat.seat_id)) fail(403, "You can't vote right now.");
      const t = b.target == null ? null : String(b.target);
      const ok = t === null || (t === "skip" && v.allowSkip) || (v.nominees || []).some((n: any) => n.id === t);
      if (!ok) fail(400, "That player is not on trial.");
      await store.upsertVote(code, seat.seat_id, v.key, t);
      return { ok: true, target: t };
    }
    case "act": {
      if (!isPost) fail(405, "Use POST.");
      const code = cleanCode(b.code);
      const seat = await playerSeat(store, code, b.seat, b.token);
      const row = checkNightChoice(seat.view, b);
      await store.upsertNightAction(code, Object.assign({ night_key: seat.view.night.key, seat_id: seat.seat_id }, row));
      return { ok: true };
    }
    case "chat": {
      if (!isPost) fail(405, "Use POST.");
      const code = cleanCode(b.code);
      const seat = await playerSeat(store, code, b.seat, b.token);
      const c = seat.view && seat.view.chat;
      if (!c || !c.channel) fail(403, "There is no chat for you in this game.");
      if (!c.open) fail(409, "The chat is closed until night falls.");
      const body = String(b.body || "").replace(/\s+/g, " ").trim();
      if (!body) fail(400, "Type a message first.");
      if (body.length > CHAT_MAX) fail(400, `Keep it under ${CHAT_MAX} characters.`);
      await store.insertChat(code, { channel: c.channel, seat_id: seat.seat_id, name: seat.name, body });
      return { ok: true, chat: chatOut(await store.listChat(code, c.channel, CHAT_PAGE), seat.seat_id) };
    }
    default: return fail(400, "Unknown action.");
  }
}
