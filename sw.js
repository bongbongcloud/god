// Minimal service worker: app shell cached, feed.json always tries the network first.
const VERSION = "abide-v3.1";
const SHELL = ["./", "./index.html", "./style.css", "./app.js", "./content.js", "./firebase-config.js", "./manifest.json", "./icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Feed: network first, fall back to cache.
  if (url.pathname.endsWith("/data/feed.json")) {
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  // Shell: stale-while-revalidate.
  e.respondWith(caches.match(e.request).then((cached) => {
    const net = fetch(e.request).then((r) => { if (r.ok) caches.open(VERSION).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => cached);
    return cached || net;
  }));
});
