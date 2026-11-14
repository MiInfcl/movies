// v3 · El reproductor ya no usa service worker (los videos vienen del Worker de Cloudflare).
// Este archivo solo existe para desinstalar el service worker viejo de los navegadores que lo tenían.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
})()));
