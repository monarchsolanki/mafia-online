// API tests: run every action against (1) the memory store and (2) a stand-in for Supabase's REST API.
'use strict';
const http = require('http');
const path = require('path');
const { handle } = require(path.join(__dirname, '..', 'lib', 'logic'));
const { memoryStore } = require(path.join(__dirname, '..', 'lib', 'store'));
let pass = 0, fails = [];
const ok = (c, m) => c ? pass++ : fails.push(m);
const expectErr = async (p, status, m) => { try { await p; fails.push(m + ' (no error)'); } catch (e) { ok(e.status === status, `${m} (got ${e.status} ${e.message})`); } };

// ---- a minimal PostgREST stand-in: eq / is.null / not.in filters, select, order, upsert-merge, PATCH representation, DELETE
function fakePostgrest(port) {
  const db = { rooms: [], seats: [], votes: [] }; const keys = { rooms: ['code'], seats: ['room_code', 'seat_id'], votes: ['room_code', 'seat_id', 'vote_key'] };
  const seen = [];
  const match = (row, filters) => filters.every(([col, op, val]) => op === 'eq' ? String(row[col]) === val : op === 'is' ? (val === 'null' ? row[col] == null : false) : op === 'lt' ? String(row[col]) < val : op === 'not.in' ? !val.includes(String(row[col])) : true);
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      const u = new URL(req.url, 'http://x'); const table = u.pathname.replace('/rest/v1/', '');
      seen.push(`${req.method} ${req.url}`);
      if (!req.headers.apikey) { res.statusCode = 401; return res.end('{"message":"no apikey"}'); }
      if (!db[table]) { res.statusCode = 404; return res.end('{}'); }
      const filters = []; let order = null, onConflict = null;
      for (const [k, v] of u.searchParams) {
        if (k === 'select') continue; if (k === 'order') { order = v.split('.')[0]; continue; } if (k === 'on_conflict') { onConflict = v.split(','); continue; }
        if (v.startsWith('eq.')) filters.push([k, 'eq', v.slice(3)]); else if (v.startsWith('is.')) filters.push([k, 'is', v.slice(3)]);
        else if (v.startsWith('lt.')) filters.push([k, 'lt', v.slice(3)]);
        else if (v.startsWith('not.in.(')) filters.push([k, 'not.in', v.slice(8, -1).split(',')]); else { res.statusCode = 400; return res.end(`{"message":"bad filter ${k}=${v}"}`); }
      }
      const prefer = req.headers.prefer || ''; const rows = db[table];
      const send = (data) => { res.statusCode = data === null ? 204 : 200; res.setHeader('Content-Type', 'application/json'); res.end(data === null ? '' : JSON.stringify(data)); };
      if (req.method === 'GET') { let out = rows.filter(r => match(r, filters)); if (order) out = out.slice().sort((a, b) => a[order] - b[order]); return send(out); }
      if (req.method === 'POST') {
        const items = [].concat(JSON.parse(body)); const k = onConflict || keys[table];
        if (items.some(i => Object.keys(i).sort().join() !== Object.keys(items[0]).sort().join())) { res.statusCode = 400; return res.end('{"message":"All object keys must match"}'); }
        for (const it of items) {
          const ex = rows.find(r => k.every(c => r[c] === it[c]));
          if (ex) { if (!prefer.includes('resolution=merge-duplicates')) { res.statusCode = 409; return res.end('{"message":"duplicate key"}'); } Object.assign(ex, it); }
          else rows.push(Object.assign({ token_hash: null, claimed_at: null, seen_at: null }, it));
        }
        return send(prefer.includes('return=representation') ? items : null);
      }
      if (req.method === 'PATCH') { const p = JSON.parse(body); const hit = rows.filter(r => match(r, filters)); hit.forEach(r => Object.assign(r, p)); return send(prefer.includes('return=representation') ? hit : null); }
      if (req.method === 'DELETE') {
        const del = rows.filter(r => match(r, filters)); db[table] = rows.filter(r => !del.includes(r));
        if (table === 'rooms') for (const r of del) { db.seats = db.seats.filter(s => s.room_code !== r.code); db.votes = db.votes.filter(v => v.room_code !== r.code); }
        return send(null);
      }
    });
  });
  return new Promise(r => server.listen(port, () => r({ server, db, seen })));
}

async function suite(store, label) {
  const call = (method, q, b) => handle(store, method, q || {}, b || {});
  const { code, hostSecret } = await call('POST', { action: 'create' });
  ok(/^[A-Z]{5}$/.test(code) && hostSecret.length > 20, label + ': create room');
  const seats = [{ id: 'p1', name: 'Priya' }, { id: 'p2', name: 'Rahul' }, { id: 'p3', name: 'Aman' }];
  const views = { p1: { card: { roleName: 'Doctor' } }, p2: { card: { roleName: 'Godfather' } }, p3: { card: { roleName: 'Villager' } } };
  await call('POST', { action: 'sync' }, { code, hostSecret, version: 5, seats, views, publicView: { phase: 'setup', vote: null } });
  await expectErr(call('POST', { action: 'sync' }, { code, hostSecret: 'wrong', seats, views }), 403, label + ': sync with wrong host secret');
  const list = await call('GET', { action: 'seats', code: code.toLowerCase() });
  ok(list.seats.map(s => s.name).join() === 'Priya,Rahul,Aman' && list.seats.every(s => !s.claimed) && !JSON.stringify(list).includes('Godfather'), label + ': public seat list in order, no roles');
  const c1 = await call('POST', { action: 'claim' }, { code, seatId: 'p1' });
  await expectErr(call('POST', { action: 'claim' }, { code, seatId: 'p1' }), 409, label + ': second claim of a seat refused');
  const v1 = await call('GET', { action: 'view', code, seat: 'p1', token: c1.token, seen: '1' });
  ok(v1.view.card.roleName === 'Doctor' && v1.name === 'Priya' && !JSON.stringify(v1).includes('Godfather'), label + ': player sees only own view');
  await expectErr(call('GET', { action: 'view', code, seat: 'p2', token: c1.token }), 403, label + ': token cannot read another seat');
  await expectErr(call('GET', { action: 'view', code, seat: 'p1', token: 'nope' }), 403, label + ': wrong token refused');
  let st = await call('POST', { action: 'status' }, { code, hostSecret });
  ok(st.seats.find(s => s.id === 'p1').claimed && st.seats.find(s => s.id === 'p1').seen && !st.seats.find(s => s.id === 'p2').claimed, label + ': host sees claimed + seen');
  // voting
  await expectErr(call('POST', { action: 'vote' }, { code, seat: 'p1', token: c1.token, voteKey: 'D1R1', target: 'p2' }), 409, label + ': vote refused while closed');
  await call('POST', { action: 'sync' }, { code, hostSecret, version: 6, seats, views, publicView: { phase: 'day', vote: { key: 'D1R1', nominees: [{ id: 'p2', name: 'Rahul' }], allowSkip: true, eligible: ['p1', 'p2'] } } });
  await call('POST', { action: 'vote' }, { code, seat: 'p1', token: c1.token, voteKey: 'D1R1', target: 'p2' });
  await expectErr(call('POST', { action: 'vote' }, { code, seat: 'p1', token: c1.token, voteKey: 'D1R1', target: 'p3' }), 400, label + ': vote for non-nominee refused');
  const v1b = await call('GET', { action: 'view', code, seat: 'p1', token: c1.token });
  ok(v1b.myVote === 'p2', label + ': player sees own vote');
  await call('POST', { action: 'vote' }, { code, seat: 'p1', token: c1.token, voteKey: 'D1R1', target: 'skip' });
  st = await call('POST', { action: 'status' }, { code, hostSecret, voteKey: 'D1R1' });
  ok(st.votes.length === 1 && st.votes[0].target === 'skip' && st.votes[0].seat === 'p1', label + ': host reads latest vote');
  const c3 = await call('POST', { action: 'claim' }, { code, seatId: 'p3' });
  await expectErr(call('POST', { action: 'vote' }, { code, seat: 'p3', token: c3.token, voteKey: 'D1R1', target: 'p2' }), 403, label + ': ineligible voter refused');
  // seat removal + reset
  await call('POST', { action: 'sync' }, { code, hostSecret, version: 7, seats: seats.slice(0, 2), views, publicView: { phase: 'day' } });
  await expectErr(call('GET', { action: 'view', code, seat: 'p3', token: c3.token }), 404, label + ': removed seat is gone');
  await call('POST', { action: 'resetSeat' }, { code, hostSecret, seatId: 'p1' });
  await expectErr(call('GET', { action: 'view', code, seat: 'p1', token: c1.token }), 403, label + ': reset seat invalidates old token');
  const c1b = await call('POST', { action: 'claim' }, { code, seatId: 'p1' }); ok(!!c1b.token, label + ': reset seat can be claimed again');
  const sync2 = await call('POST', { action: 'status' }, { code, hostSecret }); ok(sync2.seats.length === 2, label + ': name changes and removals sync');
  await call('POST', { action: 'close' }, { code, hostSecret });
  await expectErr(call('GET', { action: 'seats', code }), 404, label + ': closed room is gone');
}

(async () => {
  await suite(memoryStore(), 'memory');
  const fake = await fakePostgrest(54321);
  process.env.SUPABASE_URL = 'http://localhost:54321'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
  delete require.cache[require.resolve(path.join(__dirname, '..', 'lib', 'store'))];
  const { getStore } = require(path.join(__dirname, '..', 'lib', 'store'));
  await suite(getStore(), 'supabase-REST');
  ok(fake.seen.some(s => /seats\?on_conflict=room_code,seat_id/.test(s)) && fake.seen.some(s => /token_hash=is\.null/.test(s)) && fake.seen.some(s => /seat_id=not\.in\.\(p1,p2\)/.test(s)), 'REST: upsert, atomic claim and seat pruning use the expected filters');
  process.env.SUPABASE_SECRET_KEY = ''; process.env.VERCEL = '1';
  delete require.cache[require.resolve(path.join(__dirname, '..', 'lib', 'store'))];
  try { require(path.join(__dirname, '..', 'lib', 'store')).getStore(); fails.push('missing config on Vercel should error'); } catch (e) { ok(e.status === 503 && /SUPABASE_URL/.test(e.message), 'clear error when Vercel env vars are missing'); }
  fake.server.close();
  console.log(`${pass} passed, ${fails.length} failed`); if (fails.length) { console.log(' - ' + fails.join('\n - ')); process.exit(1); }
})();
