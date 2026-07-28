// ============================================================
// WellRead Co. — sw.js
// Service Worker for PWA installability and basic caching
// ============================================================

// ⚠️ Bump this version number every time you deploy changes.
// This forces the old cache to be cleared and fresh files fetched.
const CACHE_NAME    = "wellread-v25";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/search.html",
  "/book.html",
  "/library.html",
  "/wishlist-public.html",
  "/profile.html",
  "/settings.html",
  "/clubs.html",
  "/club.html",
  "/messages.html",
  "/login.html",
  "/setup.html",
  "/reset.html",
  "/share.html",
  "/admin.html",
  "/common.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

// ─── Install ─────────────────────────────────────────────────
// Cache all static assets on first install
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      // Activate immediately without waiting for old SW to idle
      return self.skipWaiting();
    })
  );
});

// ─── Activate ────────────────────────────────────────────────
// Clean up old caches when a new service worker takes control
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => {
      // Take control of all open pages immediately
      return self.clients.claim();
    })
  );
});

// ─── Fetch Strategy ──────────────────────────────────────────
// Network-first for HTML pages and API calls (always fresh)
// Cache-first for static assets (icons, js, css)
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // Skip Firebase, Google APIs, Cloudflare Worker — always go network
  const bypassHosts = [
    "firestore.googleapis.com",
    "firebase.googleapis.com",
    "identitytoolkit.googleapis.com",
    "securetoken.googleapis.com",
    "www.googleapis.com",        // Google Books API
    "googleapis.com",
    "firebaseapp.com",
    "firebasestorage.googleapis.com",
    "workers.dev"                // Cloudflare Worker
  ];
  if (bypassHosts.some(host => url.hostname.includes(host))) return;

  // Network-first for HTML pages and common.js — always try to get the latest
  const isHtml = request.headers.get("accept")?.includes("text/html");
  const isCommonJs = url.pathname === "/common.js";

  if (isHtml || isCommonJs) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return res;
        })
        .catch(() => {
          return caches.match(request).then(cached => {
            return cached || caches.match("/index.html");
          });
        })
    );
    return;
  }

  // Cache-first for JS, images, fonts, icons
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((res) => {
        // Only cache successful responses
        if (!res || res.status !== 200 || res.type === "opaque") return res;

        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        return res;
      });
    })
  );
});

// ─── Background Sync (future use) ────────────────────────────
// Placeholder for offline write queuing (e.g. adding a book while offline)
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-books") {
    // Future: flush any queued offline writes to Firestore
    console.log("[SW] Background sync: sync-books");
  }
});

// ─── Push Notifications (future use) ─────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();

  event.waitUntil(
    self.registration.showNotification(data.title || "WellRead Co.", {
      body:  data.body  || "",
      icon:  "/icons/icon-192.png",
      badge: "/icons/icon-96.png",
      data:  data
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
