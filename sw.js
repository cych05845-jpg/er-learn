// 離線快取：先用網路，失敗時用快取
const C = "ed-hub-v50";
const FILES = ["./", "index.html", "handouts.html", "config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "board.json", "works.json"];
self.addEventListener("install", e => e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(C).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
