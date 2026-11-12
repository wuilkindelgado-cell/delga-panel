// Service worker: app disponible sin conexión; los datos se piden primero a la red.
const CACHE = 'delga-panel-v15';
const BASE = ['./', 'index.html', 'app.js', 'plan.js', 'grabar.js', 'manifest.webmanifest', 'iconos/icono-192.png', 'iconos/icono-512.png', 'iconos/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE.map((b) => new Request(b, {cache: 'reload'})))).then(() => self.skipWaiting()));
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
      fetch(e.request, {cache: 'no-cache'}) // siempre revalida con GitHub (evita la caché HTTP de 10 min)
        .then((r) => {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request.url.split('?')[0], copia));
          return r;
        })
        .catch(() => caches.match(e.request.url.split('?')[0]))
    );
  }
});

// ---------- avisos push (los manda la PC / la nube) ----------
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {titulo: 'Delga Panel', cuerpo: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Delga Panel', {
    body: d.cuerpo || '', icon: 'iconos/icono-192.png', badge: 'iconos/icono-192.png', data: {url: d.url || '#grabar'}, tag: d.titulo || 'delga',
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const u = e.notification.data && e.notification.data.url || '#grabar';
  const destino = u.startsWith('http') ? u : new URL('./' + u, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then((cs) => {
    for (const c of cs) { if (c.url.startsWith(self.registration.scope) && !u.startsWith('http')) { c.navigate(destino); return c.focus(); } }
    return self.clients.openWindow(destino);
  }));
});
