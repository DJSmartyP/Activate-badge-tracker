const CACHE='activate-tracker-v13-85-0';
const ASSETS=[
  './',
  'index.html',
  'style.css?v=1385',
  'app.js?v=1385',
  'badges.json','rooms.json','manifest.webmanifest',
  'icon-192.png?v=131','icon-512.png?v=131','icon-maskable-512.png?v=131','favicon-64.png?v=131',
  'icons/home.svg?v=1385','icons/badges.svg?v=1385','icons/levels.svg?v=1385','icons/competitive.svg?v=1385','icons/locations.svg?v=1385','icons/stats.svg?v=1385','icons/settings.svg?v=1385','icons/menu.svg','icons/more.svg','icons/backup.svg','icons/restore.svg',
  'icons/header/home.svg?v=1385','icons/header/badges.svg?v=1385','icons/header/levels.svg?v=1385','icons/header/competitive.svg?v=1385','icons/header/locations.svg?v=1385','icons/header/stats.svg?v=1385','icons/header/settings.svg?v=1385','icons/header/menu.svg'
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
        const fresh = await fetch(event.request,{cache:'no-store'});
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
      const fresh = await fetch(event.request,{cache:'no-store'});
      const cache = await caches.open(CACHE);
      cache.put(event.request, fresh.clone());
      return fresh;
    } catch (err) {
      return (await caches.match(event.request)) || Response.error();
    }
  })());
});
