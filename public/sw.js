/*
 * anwar.os service worker. Hand-written and deliberately small:
 *
 * - Pages always come from the network. When the network is gone, a navigation
 *   gets /offline.html instead of the browser's error page. Page HTML is never
 *   cached: it is private, per user, and carries a per-request CSP nonce.
 * - Never touched (the browser handles them as if there were no worker):
 *   /api/*, anything that isn't GET, other origins, and React Server Component
 *   requests (RSC header, Next-Router-* headers, ?_rsc=), so navigations and
 *   view transitions always get fresh data.
 * - Build assets under /_next/static/ (content-hashed, immutable) and /icons/
 *   are cache-first, but only plain public 200s: nothing marked private or
 *   no-store, nothing redirected, nothing that set a cookie.
 *
 * Bump VERSION when the offline page or the precache list changes.
 */
const VERSION = "1"
const SHELL_CACHE = `anwar-os-shell-v${VERSION}`
const STATIC_CACHE = "anwar-os-static"
const OFFLINE_URL = "/offline.html"
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"]
const MAX_STATIC_ENTRIES = 300

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("anwar-os-shell-") && key !== SHELL_CACHE) await caches.delete(key)
      }
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable()
      await self.clients.claim()
    })(),
  )
})

function isRscRequest(request, url) {
  const h = request.headers
  return (
    h.get("RSC") === "1" ||
    h.has("Next-Router-State-Tree") ||
    h.has("Next-Router-Prefetch") ||
    h.has("Next-Router-Segment-Prefetch") ||
    url.searchParams.has("_rsc")
  )
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/") || isRscRequest(request, url)) return

  if (request.mode === "navigate") {
    event.respondWith(networkOrOffline(event))
    return
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request))
  }
})

async function networkOrOffline(event) {
  try {
    const preloaded = await event.preloadResponse
    if (preloaded) return preloaded
    return await fetch(event.request)
  } catch {
    const offline = await caches.match(OFFLINE_URL)
    return offline || Response.error()
  }
}

function isCacheable(response) {
  if (!response.ok || response.type !== "basic" || response.redirected) return false
  if (response.headers.has("set-cookie")) return false
  const cacheControl = response.headers.get("cache-control") || ""
  return !/no-store|private/i.test(cacheControl)
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (isCacheable(response)) {
    await cache.put(request, response.clone())
    trim(cache)
  }
  return response
}

/** Old hashed chunks pile up across deploys; keep the newest entries only. */
async function trim(cache) {
  const keys = await cache.keys()
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_STATIC_ENTRIES))) await cache.delete(key)
}
