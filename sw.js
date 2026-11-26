// Service worker: deixa o sistema instalável como app e abre a tela certa ao tocar num aviso.
// Os dados vêm sempre do servidor (rede primeiro); o cache só serve de reserva sem internet.
const CACHE = 'pedacito-v1';
const BASE = ['./', 'index.html', 'css/app.css', 'img/icon.svg', 'img/icon-192.png', 'manifest.json'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // Supabase e CDNs: direto na rede
  e.respondWith(fetch(e.request).then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const alvo = `./#${e.notification.data?.link || '/gestao/atividades'}`;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ('focus' in c) { c.navigate(alvo); return c.focus(); } }
    return self.clients.openWindow(alvo);
  }));
});
