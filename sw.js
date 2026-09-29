const CACHE = 'chinese-app-v1';
const ASSETS = ['/', '/index.html', '/app.js', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// Клик по уведомлению
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const wordId = e.notification.data && e.notification.data.wordId;
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      for (const c of list) {
        c.postMessage({ type: 'notification-click', wordId });
        return c.focus();
      }
      return clients.openWindow('/');
    })
  );
});