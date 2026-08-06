const CACHE_NAME = "railnavigator-cz-v8-0";
const APP_FILES = [
  "./",
  "./index.html",
  "./css/style.css?v=0.8.0",
  "./js/app.js?v=0.8.0",
  "./js/dmvs.js?v=0.8.0",
  "./js/railway.js?v=0.8.0",
  "./js/gps.js?v=0.8.0",
  "./data/dmvs-railways.geojson",
  "./data/osm-railways.geojson",
  "./manifest.json",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/proj4@2.11.0/dist/proj4.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && event.request.mode !== "navigate") {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      return response;
    })));
    return;
  }
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((cached) =>
    cached || (event.request.mode === "navigate"
      ? caches.match("./index.html")
      : new Response("Offline", { status: 503, statusText: "Offline" }))
  )));
});
