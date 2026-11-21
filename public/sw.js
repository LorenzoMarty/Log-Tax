// Minimal service worker (#189): makes the app installable and shows a clear page when a navigation fails offline.
// It caches ONLY the static offline page and icons. Pages, API responses and Supabase calls are never cached:
// everything else goes straight to the network (no fetch handler result is stored).
const CACHE = "log-tax-offline-v1";
const OFFLINE_URL = "/offline.html";
const STATIC = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  if (STATIC.includes(url.pathname)) event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  // anything else: no respondWith, the browser hits the network untouched
});
