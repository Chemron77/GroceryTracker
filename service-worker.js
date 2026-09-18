/**
 * Grocery Tracker — Service Worker
 * Strategy: Cache-first for assets, Network-first for API / Firestore
 * 
 * HOW TO UPDATE: bump CACHE_VERSION when you deploy a new HTML/JS build.
 */

const CACHE_VERSION = 'gt-v2';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Files to pre-cache on install (your app shell)
const PRECACHE_URLS = [
  './',                          // index / app shell
  './index.html',                // if you rename the HTML
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
];

// Origins that should never be cached (Firebase, Google APIs)
const BYPASS_ORIGINS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'accounts.google.com',
  'www.googleapis.com',
];

// ──────────────────────────────────────────────────────
//  INSTALL — pre-cache app shell
// ──────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ──────────────────────────────────────────────────────
//  ACTIVATE — clean up old caches
// ──────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ──────────────────────────────────────────────────────
//  FETCH — routing logic
// ──────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Always bypass non-GET requests
  if (event.request.method !== 'GET') return;

  // 2. Always bypass Firebase / Google auth / API calls
  if (BYPASS_ORIGINS.some(origin => url.hostname.includes(origin))) return;

  // 3. Chrome extension or data URIs — ignore
  if (!url.protocol.startsWith('http')) return;

  // 4. Navigation requests → Cache-first with network fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(event.request)
        .then(cached => cached || fetch(event.request)
          .catch(() => caches.match('./'))  // offline fallback to root
        )
    );
    return;
  }

  // 5. Static assets (JS, CSS, images, fonts) → Cache-first
  if (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf)$/) ||
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'cdnjs.cloudflare.com' ||
    url.hostname === 'www.gstatic.com'
  ) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }
          const toCache = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(event.request, toCache));
          return response;
        });
      })
    );
    return;
  }

  // 6. Everything else → Network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const toCache = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(event.request, toCache));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ──────────────────────────────────────────────────────
//  PUSH NOTIFICATIONS (optional — hook up later)
// ──────────────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  const options = {
    body: data.body || 'You have a new notification.',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-72.png',
    tag: data.tag || 'grocery-tracker',
    renotify: true,
    data: { url: data.url || '/' },
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'Grocery Tracker', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
