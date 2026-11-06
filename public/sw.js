// Omertà service worker. The app opens offline once visited; live game data (/api, Supabase) is never cached.
// Bump VERSION when the caching rules change. Built files under /_next/static have content hashes, so they can
// be kept for good; pages are fetched fresh first and only fall back to the cache when offline.
const VERSION = 'omerta-next-v8';
const SHELL = ['/', '/play', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== VERSION).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                       // Supabase, live updates and anything else go straight to the network
  if (url.pathname.startsWith('/api/')) return;                      // game data and accounts are never cached
  if (req.mode === 'navigate') {
    const key = url.pathname.startsWith('/play') ? '/play' : '/';
    e.respondWith(fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(key, copy)); } return res; })
      .catch(() => caches.match(key).then(hit => hit || caches.match('/'))));
    return;
  }
  if (url.pathname.startsWith('/_next/static/')) {                   // hashed build files: cache first
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; })));
    return;
  }
  // icons, the manifest and other public files: network first, cache as a fallback
  e.respondWith(fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; }).catch(() => caches.match(req)));
});
