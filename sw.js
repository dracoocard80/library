/* Library service worker — caches the app shell so it opens offline.
   Bump CACHE_VERSION whenever you change any file in ASSETS. */
const CACHE_VERSION = 'v2';
const CACHE = 'html-library-' + CACHE_VERSION;
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './LIBRARY-APP-GUIDE.md',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 'reload' bypasses the HTTP cache so a new deploy is actually fetched.
    // index.html and app.js are essential; a missing icon must not block installing.
    await Promise.all(ASSETS.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { if (url === './index.html' || url === './app.js') throw e; }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('html-library-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // leave cross-origin (e.g. "Import from URL") alone
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate' && req.destination !== 'iframe') {
      // Serve the cached shell for top-level navigations inside the scope (never for
      // iframe navigations — an imported app following a link must not get the shell
      // nested inside itself). Updates arrive by bumping CACHE_VERSION.
      const cached = await cache.match('./index.html');
      if (cached) return cached;
      try { return await fetch(req); }
      catch (e) { return new Response('Offline and not cached yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
    }
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const r = await fetch(req);
      if (r && r.ok && ASSETS.some((a) => url.pathname.endsWith(a.replace('./', '/')))) cache.put(req, r.clone());
      return r;
    } catch (e) {
      return new Response('', { status: 504 });
    }
  })());
});
