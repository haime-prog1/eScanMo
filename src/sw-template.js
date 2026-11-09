// eScanMo service worker — makes the app installable and fully offline.
// Strategy: pre-cache every app file at install time, then serve from cache
// first (falling back to the network). Anything else fetched later (e.g. OCR
// language files) is cached on first use.
const VERSION = '__VERSION__';
const CACHE = 'escanmo-' + VERSION;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  // Delete caches from older versions so storage doesn't grow forever.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('escanmo-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok && (new URL(req.url).origin === location.origin || res.type === 'cors')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    } catch (err) {
      // Offline and not cached: for page navigations, fall back to the app shell.
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw err;
    }
  })());
});
