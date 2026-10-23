// Self-healing Service Worker at /sw.js that replaces any old Workbox precache SW,
// purges all stale Workbox caches, and reloads open tabs with the fresh OpenStreetMap build.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        if (typeof caches !== 'undefined') {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
        await self.clients.claim();
        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        for (const client of windowClients) {
          if ('navigate' in client) {
            await client.navigate(client.url);
          }
        }
      } catch (e) {
        // ignore errors
      }
    })()
  );
});
