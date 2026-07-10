// SOLOC' CRM — Service Worker
// Stratégie : réseau d'abord (pour toujours avoir la dernière version en ligne),
// cache uniquement en secours quand il n'y a pas de connexion.
const CACHE = "soloc-crm-v1";
const SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  // Navigation (ouverture de l'app) : réseau d'abord, cache si hors-ligne
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
        return res;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Autres requêtes même origine : cache si présent, sinon réseau.
  // Les appels Firebase (autre origine) passent directement au réseau.
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req)));
  }
});
