// Minimal offline cache for the app shell. The app's data lives in
// localStorage, so once the shell is cached the app works fully offline.
const CACHE = "pantry-v5";
// Note: do NOT list "./index.html" — on Vercel cleanUrls 308-redirects it to "./",
// and a redirected response makes cache.addAll reject, aborting SW install.
const SHELL = [
  "./",
  "./src/styles.css",
  "./src/app.js",
  "./src/sync.js",
  "./src/config.js",
  "./manifest.webmanifest",
  "./public/app-icon.svg",
];

self.addEventListener("install", (event) => {
  // Cache each URL independently so one redirect/404 can't abort the whole install.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(SHELL.map((url) =>
        fetch(url, { cache: "no-cache" })
          .then((res) => (res.ok && !res.redirected ? cache.put(url, res) : null))
          .catch(() => null)
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ---- Web Push: show the morning summary ----
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) {}
  const title = d.title || "Pantry";
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || "You have items to check.",
    icon: "./public/app-icon.svg",
    badge: "./public/app-icon.svg",
    tag: "pantry-morning",
    data: { url: d.url || "./" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
