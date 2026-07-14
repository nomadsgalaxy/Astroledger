// Astroledger service worker — minimal shell so the PWA install prompt fires and
// the app's static chrome loads when offline. Doesn't cache API responses
// (data should always be fresh from the server) and never serves stale auth.

// Bump this version whenever the cached shell assets change (e.g. the logo /
// icons are regenerated). The activate handler purges every cache whose name
// doesn't match, forcing existing installs to re-fetch the new icons instead
// of serving the stale cache-first copies.
const CACHE = 'astroledger-shell-v3';
const SHELL = ['/', '/manifest.webmanifest', '/icons/astroledger-192.png', '/icons/astroledger-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Network-first for navigations, cache-first for icons. NEVER intercept /api.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;          // don't touch API requests
  if (url.pathname.startsWith('/auth/')) return;         // and never auth flow

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/') || new Response('Offline', { status: 503 }))
    );
    return;
  }

  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(caches.match(event.request).then(r => r || fetch(event.request)));
  }
});

// ── Push notifications (scaffold) ──────────────────────────────────────────
// Handlers so the PWA can receive web-push once the server side (VAPID keys +
// a subscription store + a sender) is wired. Payload is a JSON
// { title, body, url }. No-op until a push is actually sent.
self.addEventListener('push', (event) => {
  let data = { title: 'Astroledger', body: '', url: '/' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch { /* plain-text or empty */ }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icons/astroledger-192.png',
    badge: '/icons/astroledger-192.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if ('focus' in w) { w.navigate(target); return w.focus(); } }
      return self.clients.openWindow(target);
    })
  );
});
