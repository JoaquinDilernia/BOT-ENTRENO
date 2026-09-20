// Service worker mínimo, sin cache: existe sólo para que el navegador
// ofrezca "Instalar app" en el celular. Cada request sigue yendo a red,
// igual que sin service worker — no hay comportamiento offline.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
