const CACHE = 'agrians-v28-shell';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Network-first for HTML/JS/CSS prevents an older attendance calculation
  // from surviving a new deployment because of the PWA shell cache.
  const networkFirst = req.destination === 'document' || req.destination === 'script' || req.destination === 'style';
  if (networkFirst) {
    event.respondWith(
      fetch(req).then(res => {
        // clone() must run before the response body is consumed anywhere else
        // (e.g. by the caller reading `res`) — cloning it inside the async
        // caches.open().then() below happens too late and throws "Response
        // body is already used".
        if (res.ok) {
          const resToCache = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, resToCache));
        }
        return res;
      }).catch(() => caches.match(req).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res.ok && (req.destination === 'image' || req.destination === 'font')) {
        const resToCache = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, resToCache));
      }
      return res;
    }).catch(() => caches.match('/index.html')))
  );
});
});
