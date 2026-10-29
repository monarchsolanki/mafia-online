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
  const seen = []; let mode = ''; // 'missing' = tables not created, 'badkey' = key rejected, 'paused' = project paused
  const fail = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
  const match = (row, filters) => filters.every(([col, op, val]) => op === 'eq' ? String(row[col]) === val : op === 'is' ? (val === 'null' ? row[col] == null : false) : op === 'lt' ? String(row[col]) < val : op === 'not.in' ? !val.includes(String(row[col])) : true);
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      const u = new URL(req.url, 'http://x'); const table = u.pathname.replace('/rest/v1/', '');
      seen.push(`${req.method} ${req.url}`);
      if (mode === 'missing') return fail(res, 404, { code: 'PGRST205', message: "Could not find the table 'public.rooms' in the schema cache" });
      if (mode === 'badkey') return fail(res, 401, { message: 'Invalid API key' });
      if (mode === 'paused') return fail(res, 540, { message: 'Project is paused' });
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
  return new Promise(r => server.listen(port, () => r({ server, db, seen, setMode: m => { mode = m; } })));
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
  // ---- configuration: pasted values are cleaned up, and every failure explains itself
  const storePath = require.resolve(path.join(__dirname, '..', 'lib', 'store'));
  const withEnv = e => { for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VERCEL']) delete process.env[k]; Object.assign(process.env, e); delete require.cache[storePath]; return require(storePath); };
  const throws = fn => { try { fn(); return null; } catch (e) { return e; } };
  const asyncThrows = async fn => { try { await fn(); return null; } catch (e) { return e; } };
  let m = withEnv({ SUPABASE_URL: '  "abcd1234.supabase.co/rest/v1/" ', SUPABASE_SECRET_KEY: ' "sb_secret_abc"\n' });
  ok(m.config().url === 'https://abcd1234.supabase.co' && m.config().secretKey === 'sb_secret_abc', 'config: quotes, spaces, a missing https:// and a /rest/v1 suffix are cleaned up');
  let err = throws(() => withEnv({ VERCEL: '1' }).getStore());
  ok(err && err.status === 503 && /SUPABASE_URL and SUPABASE_SECRET_KEY/.test(err.message), 'clear error when Vercel env vars are missing');
  err = throws(() => withEnv({ VERCEL: '1', SUPABASE_URL: 'https://abcd1234.supabase.co' }).getStore());
  ok(err && err.status === 503 && /SUPABASE_SECRET_KEY is missing/.test(err.message), 'clear error when only the secret key is missing');
  err = throws(() => withEnv({ VERCEL: '1', SUPABASE_URL: 'https://abcd1234.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_ab•••' }).getStore());
  ok(err && err.status === 503 && /character a key cannot have/.test(err.message) && !/sb_secret_ab/.test(err.message), 'a key copied with masked bullets is explained and never echoed');
  m = withEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_SECRET_KEY: 'sb_secret_test' });
  let d = await m.diagnose();
  ok(d.ok && d.storage === 'supabase' && d.steps.length >= 5 && !JSON.stringify(d).includes('sb_secret_test'), 'diagnose: a healthy setup passes every step and shows no secret');
  fake.setMode('missing'); d = await m.diagnose();
  ok(!d.ok && d.steps.some(s => !s.ok && /schema\.sql/.test(s.fix)), 'diagnose: missing tables tell you to run schema.sql');
  err = await asyncThrows(() => m.getStore().getRoom('AAAAA'));
  ok(err && err.status === 502 && /schema\.sql/.test(err.message), 'missing tables are reported in plain words');
  fake.setMode('badkey'); d = await m.diagnose();
  ok(!d.ok && d.steps.some(s => !s.ok && /secret key/i.test(s.fix)), 'diagnose: a rejected key is named');
  fake.setMode('paused'); d = await m.diagnose();
  ok(!d.ok && d.steps.some(s => !s.ok && /paused/.test(s.fix)), 'diagnose: a paused project is named');
  fake.setMode('');
  d = await withEnv({ SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_SECRET_KEY: 'sb_secret_test' }).diagnose();
  ok(!d.ok && d.steps.some(s => !s.ok && /reach|connect/i.test(s.fix)), 'diagnose: an unreachable project is named');
  d = await withEnv({ SUPABASE_URL: 'https://abcd1234.supabase.co', SUPABASE_SECRET_KEY: 'sb_publishable_abc' }).diagnose();
  ok(!d.ok && d.steps.some(s => !s.ok && /publishable/.test(s.fix)), 'diagnose: the publishable key used by mistake is named');
  d = await withEnv({ VERCEL: '1' }).diagnose();
  ok(!d.ok && d.steps.some(s => /Environment Variables/.test(s.fix)), 'diagnose: nothing configured on Vercel says what to add');
  d = await withEnv({}).diagnose();
  ok(d.ok && d.storage === 'memory', 'diagnose: local development uses in-memory rooms');
  // the HTTP function itself: failures come back as readable JSON, and diagnose works even when the settings are broken
  const roomFn = require(path.join(__dirname, '..', 'api', 'room.js'));
  const web = http.createServer(roomFn); await new Promise(r => web.listen(54322, r));
  withEnv({ VERCEL: '1', SUPABASE_URL: 'https://abcd1234.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_ab•' });
  let r = await fetch('http://127.0.0.1:54322/api/room?action=create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  let j = await r.json();
  ok(r.status === 503 && /character a key cannot have/.test(j.error), 'HTTP: a bad key returns a readable 503, not "check the logs"');
  r = await fetch('http://127.0.0.1:54322/api/room?action=diagnose'); j = await r.json();
  ok(r.status === 200 && j.ok === false && j.steps.some(s => !s.ok), 'HTTP: diagnose answers even when the settings are broken');
  web.close();
  withEnv({ VERCEL: '1' });
  fake.server.close();
  console.log(`${pass} passed, ${fails.length} failed`); if (fails.length) { console.log(' - ' + fails.join('\n - ')); process.exit(1); }
})();
