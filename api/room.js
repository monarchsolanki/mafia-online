// The single Vercel function behind every online action: /api/room?action=...
'use strict';
const { handle } = require('../lib/logic');
const { getStore } = require('../lib/store');

async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? safeJson(req.body) : req.body || {};
  const chunks = []; let total = 0;
  for await (const c of req) { total += c.length; if (total > 2e6) throw Object.assign(new Error('Request too large.'), { status: 413 }); chunks.push(c); }
  return chunks.length ? safeJson(Buffer.concat(chunks).toString('utf8')) : {};
}
function safeJson(t) { try { return JSON.parse(t); } catch (e) { return {}; } }

module.exports = async function room(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const q = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
    const body = req.method === 'POST' ? await readBody(req) : {};
    const out = await handle(getStore(), req.method, q, body);
    res.statusCode = 200; res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = e.status || 500;
    if (!e.status) console.error(e);
    res.end(JSON.stringify({ error: e.status ? e.message : 'Server error — check the Vercel function logs.' }));
  }
};
