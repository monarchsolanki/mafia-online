// Local test server: serves the site and the API with an in-memory store. Run: node dev-server.js
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const room = require('./api/room');
const ROOT = __dirname, PORT = +process.env.PORT || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/room') return room(req, res);
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html'; else if (p === '/play') p = '/play.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(ROOT) || /[\/\\](api|lib|supabase|node_modules)[\/\\]/.test(file)) { res.statusCode = 404; return res.end('Not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream'); res.end(data);
  });
}).listen(PORT, () => console.log(`Omertà dev server: http://localhost:${PORT}  (players: http://localhost:${PORT}/play)`));
