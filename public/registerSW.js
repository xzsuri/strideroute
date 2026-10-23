// Unregister legacy Workbox service workers and clear all caches
if ('caches' in window) {
  caches.keys().then(function (keys) {
    keys.forEach(function (k) {
      caches.delete(k);
    });
  });
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (regs) {
    regs.forEach(function (reg) {
      if (reg.active && reg.active.scriptURL && reg.active.scriptURL.indexOf('sw-commute.js') === -1) {
        reg.unregister().then(function () {
          window.location.reload();
        });
      }
    });
  });
}
