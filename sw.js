// Omertà service worker. Pages and icons work offline; live game data (/api) is never cached.
// Bump VERSION on every deploy so phones pick up the new build.
const VERSION = 'omerta-online-v1';
const SHELL = ['/', '/index.html', '/play', '/play.html', '/manifest.webmanifest', '/vendor/supabase.js', '/vendor/qrcode.js', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== VERSION).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;          // never cache game data
  if (url.hostname.endsWith('supabase.co') || url.protocol.startsWith('ws')) return;       // live updates
  if (req.mode === 'navigate') {
    const key = url.pathname.startsWith('/play') ? '/play.html' : '/index.html';
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(key, copy)); return res; }).catch(() => caches.match(key)));
    return;
  }
  if (url.origin === location.origin || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; })));
  }
});
