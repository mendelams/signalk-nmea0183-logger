// NMEA0183 Logger — Service Worker v12
const CACHE_NAME = 'nmea-logger-v12';
const DATA_CACHE = 'nmea-data-v1';
const APP_SHELL = ['/', '/app.css', '/app.js', '/parse-worker.js', '/icon.svg', '/manifest.json'];
const CDN_HOSTS = ['unpkg.com', 'tile.openstreetmap.org', 'tiles.openseamap.org'];

// API paths to cache for offline viewing (read-only GET endpoints).
// Per-log /stats endpoints are deliberately NOT cached because users edit
// events and notes on these pages — caching causes "edits don't appear"
// confusion. The plugin has its own server-side cache for speed.
const CACHEABLE_API = ['/api/logs', '/api/voyages', '/api/lang'];
function isCacheableApi(pathname) {
  return CACHEABLE_API.includes(pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== DATA_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  if (isCacheableApi(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(DATA_CACHE).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => {
          if (cached) return cached;
          return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
        }))
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) return;

  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
