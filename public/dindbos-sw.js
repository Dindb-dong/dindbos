const CACHE_NAME = "dindbos-boot-v1";
const BOOT_ASSETS = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(BOOT_ASSETS))
      .catch(() => null)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "dindbos:boot:hello") return;
  event.source?.postMessage?.({
    type: "dindbos:boot:ready",
    protocol: "dindbos-sw-boot.v1",
    closedPageExecution: false,
    cache: CACHE_NAME,
  });
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME)
          .then((cache) => cache.put(event.request, copy))
          .catch(() => null);
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/index.html"))),
  );
});
