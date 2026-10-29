// The single Vercel function behind every online action: /api/room?action=...
'use strict';
const { handle } = require('../lib/logic');
const { getStore, diagnose } = require('../lib/store');

async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? safeJson(req.body) : req.body || {};
  const chunks = []; let total = 0;
  for await (const c of req) { total += c.length; if (total > 2e6) throw Object.assign(new Error('Request too large.'), { status: 413 }); chunks.push(c); }
  return chunks.length ? safeJson(Buffer.concat(chunks).toString('utf8')) : {};
}
function safeJson(t) { try { return JSON.parse(t); } catch (e) { return {}; } }
// Name and code only: an error's message can echo request details, so it never goes back to the browser.
function errorTag(e) { const code = e && (e.code || (e.cause && e.cause.code)); return `${(e && e.name) || 'Error'}${code ? ' ' + code : ''}`; }

module.exports = async function room(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const q = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
    if (q.action === 'diagnose') { res.statusCode = 200; return res.end(JSON.stringify(await diagnose())); }
    const body = req.method === 'POST' ? await readBody(req) : {};
    const out = await handle(getStore(), req.method, q, body);
    res.statusCode = 200; res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = e.status || 500;
    if (!e.status) console.error(e);
    res.end(JSON.stringify({ error: e.status ? e.message : `Unexpected server error (${errorTag(e)}). Tap “Check connection” on the online room panel to test the Supabase settings.` }));
  }
};
