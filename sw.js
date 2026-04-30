const CACHE = 'mikesell-v1';
const ASSETS = [
  '/mikesell-water/',
  '/mikesell-water/index.html',
  '/mikesell-water/css/style.css',
  '/mikesell-water/js/app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});