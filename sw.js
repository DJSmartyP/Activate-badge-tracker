const CACHE='activate-tracker-v13-54-0';
const ASSETS=[
  './','index.html','style.css','app.js','badges.json','rooms.json','manifest.webmanifest',
  'icon-192.png?v=131','icon-512.png?v=131','icon-maskable-512.png?v=131','favicon-64.png?v=131',
  'icons/home.svg','icons/badges.svg','icons/levels.svg','icons/competitive.svg','icons/locations.svg','icons/stats.svg','icons/settings.svg','icons/menu.svg','icons/more.svg','icons/backup.svg','icons/restore.svg',
  'icons/header/home.svg','icons/header/badges.svg','icons/header/levels.svg','icons/header/competitive.svg','icons/header/locations.svg','icons/header/stats.svg','icons/header/settings.svg','icons/header/menu.svg'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isArtwork = /\.(png|jpg|jpeg|webp)$/i.test(url.pathname);

  if (isArtwork) {
    // Network-first so replacing an image in GitHub is visible immediately.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(event.request, {cache:'no-store'});
        const cache = await caches.open(CACHE);
        cache.put(event.request, fresh.clone());
        return fresh;
      } catch (err) {
        return (await caches.match(event.request)) || Response.error();
      }
    })());
    return;
  }

  // App shell: network first, cached fallback.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(event.request);
      const cache = await caches.open(CACHE);
      cache.put(event.request, fresh.clone());
      return fresh;
    } catch (err) {
      return (await caches.match(event.request)) || Response.error();
    }
  })());
});
