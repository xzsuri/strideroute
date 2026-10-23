// Service Worker for background commute notifications and interactive route actions
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      typeof caches !== 'undefined'
        ? caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        : Promise.resolve(),
    ])
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'SHOW_DRIVING_NOTIFICATION') {
    const { title, body, pitstopQuestion, directQuestion } = data.payload || {};
    const options = {
      body: body || 'Tap an option to start shortest route navigation with live traffic.',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: 'strideroute-driving-prompt',
      renotify: true,
      requireInteraction: true,
      data: data.payload,
      actions: [
        {
          action: 'pitstop',
          title: pitstopQuestion || 'Go to restaurant?',
        },
        {
          action: 'direct',
          title: directQuestion || 'Go directly to office?',
        },
      ],
    };

    event.waitUntil(
      self.registration.showNotification(title || 'Heading to office', options)
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  const chosenAction = event.action || 'pitstop';
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        client.postMessage({
          type: 'NOTIFICATION_ACTION_SELECTED',
          action: chosenAction,
        });
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(`/?commuteAction=${encodeURIComponent(chosenAction)}`);
      }
    })
  );
});
