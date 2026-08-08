const CACHE='smartys-activate-tracker-v10-5-0';
const ASSETS=['./','index.html','style.css','app.js','badges.json','rooms.json','manifest.webmanifest','icon-192.png','icon-512.png','icon-maskable-512.png','favicon-64.png','splash-portrait.png','splash-landscape.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return res}))));
