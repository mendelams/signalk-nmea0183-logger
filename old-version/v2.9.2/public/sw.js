// NMEA0183 Logger — Service Worker v10
const CACHE_NAME = 'nmea-logger-v10';
const DATA_CACHE = 'nmea-data-v1';
const APP_SHELL = ['/', '/app.css', '/app.js', '/icon.svg', '/manifest.json'];
const CDN_HOSTS = ['unpkg.com', 'tile.openstreetmap.org', 'tiles.openseamap.org'];

const CACHEABLE_API = ['/api/logs', '/api/voyages', '/api/lang'];
function isCacheableApi(pathname) {
  if (CACHEABLE_API.includes(pathname)) return true;
  if (/^\/api\/logs\/[^/]+\/stats$/.test(pathname)) return true;
  if (/^\/api\/voyages\/[^/]+\/stats$/.test(pathname)) return true;
  return false;
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
