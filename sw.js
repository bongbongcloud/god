// Service worker.
//  - App shell (html/js/css): NETWORK FIRST, cache fallback → an online phone always runs the latest build.
//  - Bible chapters: CACHE FIRST (they never change) → offline reading.
//  - feed.json: network first, cache fallback.
const VERSION = "abide-v4.0";
const SHELL = ["./", "./index.html", "./style.css", "./app.js", "./content.js", "./firebase-config.js", "./manifest.json", "./icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  // Bible chapters: cache first.
  if (url.pathname.includes("/data/bible/") || url.pathname.includes("/data/study/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok) caches.open(VERSION).then((c) => c.put(e.request, r.clone()));
      return r;
    })));
    return;
  }

  // Everything else (shell, feed.json): network first, cache fallback.
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then((r) => {
      if (r.ok) caches.open(VERSION).then((c) => c.put(e.request, r.clone()));
      return r;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});
