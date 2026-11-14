/* Openmi's service worker: build assets only.
 *
 * It exists so the app is installable and a repeat load does not refetch the
 * same hashed chunks — not so the app works offline. HTML, API responses, auth
 * callbacks and anything under /api always come from the network: a cached page
 * here would be a signed-in shell from another session, or a stale balance.
 *
 * The registration is production-only (components/ServiceWorker.tsx), so `next
 * dev` never serves through this file.
 */

const CACHE = "openmi-static-v1";

/* Hashed build output and image/font files are immutable for their lifetime. */
const IMMUTABLE = /^\/_next\/static\//;
const ASSET = /\.(?:png|jpg|jpeg|svg|webp|gif|ico|woff2?)$/i;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE).map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (!IMMUTABLE.test(url.pathname) && !ASSET.test(url.pathname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);

      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => hit || Response.error());

      return hit || network;
    })()
  );
});
