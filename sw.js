// Service worker: app disponible sin conexión; los datos se piden primero a la red.
const CACHE = 'delga-panel-v11';
const BASE = ['./', 'index.html', 'app.js', 'plan.js', 'grabar.js', 'manifest.webmanifest', 'iconos/icono-192.png', 'iconos/icono-512.png', 'iconos/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // miniaturas externas: directo
  const esDatos = url.pathname.endsWith('datos.enc.json');
  const esApp = BASE.some((b) => url.pathname.endsWith(b.replace('./', '/')) || url.pathname.endsWith('/'));
  if (esDatos || esApp) {
    // red primero, caché si no hay conexión
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request.url.split('?')[0], copia));
          return r;
        })
        .catch(() => caches.match(e.request.url.split('?')[0]))
    );
  }
});
