/*
 * anwar.os service worker. Hand-written and small on purpose.
 *
 * Pages
 * - Network first, always. The key app pages (OFFLINE_PAGES: Today, Inbox,
 *   Tasks, Notes, a new note, Budget, Capture) are also saved when they load,
 *   so offline they open from that copy; the page shows "Offline · showing
 *   saved copy from 14:02" (src/components/offline/offline-banner.tsx asks
 *   this worker how it was served). Every other page offline gets
 *   /offline.html.
 * - The saved copy is the whole response, CSP header included, so its nonce
 *   still matches its scripts. It is the signed-in user's own data on their
 *   own device; it is deleted on sign-out (the app clears it, and so does this
 *   worker when one of those pages redirects to /login), and only ever served
 *   when the network fails or takes longer than NETWORK_TIMEOUT_MS.
 * - Only plain addresses are saved (no ?query), only 200 HTML, never a redirect.
 *
 * Never touched (the browser handles them as if there were no worker):
 * /api/* (auth, the sync API, everything else), anything that isn't GET,
 * other origins, and React Server Component requests (RSC header,
 * Next-Router-* headers, ?_rsc=). A client-side navigation that can't reach
 * the server falls back to a full page load, which lands in the page handler.
 *
 * Assets: /_next/static/ (content-hashed, immutable) and /icons/ are cache
 * first, but only plain public 200s: nothing private or no-store, nothing
 * redirected, nothing that set a cookie.
 *
 * Background Sync (Chromium; iOS has none, the app syncs when it opens):
 * replays the offline outbox (src/lib/offline) with the same contract as
 * src/lib/offline/sync.ts. The database and lock names are shared with
 * src/lib/offline/outbox.ts and client.ts; outbox.test.ts checks them.
 *
 * Versioning: every cache name carries a version; on activate, any anwar-os-*
 * cache that isn't current is deleted. Bump VERSION when the offline page or
 * the precache list changes, PAGES_VERSION when saved pages must be dropped
 * (e.g. their markup can't run with new assets), STATIC_VERSION likewise.
 */
const VERSION = "2"
const PAGES_VERSION = "1"
const STATIC_VERSION = "1"
const SHELL_CACHE = `anwar-os-shell-v${VERSION}`
const PAGES_CACHE = `anwar-os-pages-v${PAGES_VERSION}`
const STATIC_CACHE = `anwar-os-static-v${STATIC_VERSION}`
const CURRENT_CACHES = [SHELL_CACHE, PAGES_CACHE, STATIC_CACHE]
const OFFLINE_URL = "/offline.html"
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"]
const MAX_STATIC_ENTRIES = 300
const OFFLINE_PAGES = ["/app", "/app/inbox", "/app/tasks", "/app/notes", "/app/notes/new", "/app/budget", "/app/capture"]
/** A saved page is shown when the network hasn't answered by then (iOS "connected" with no internet). */
const NETWORK_TIMEOUT_MS = 6000
const SAVED_AT_HEADER = "x-anwar-saved-at"

const OUTBOX_DB = "anwar-os-offline"
const OUTBOX_DB_VERSION = 1
const OUTBOX_STORE = "outbox"
const SYNC_LOCK = "anwar-os-outbox-sync"
const BACKGROUND_SYNC_TAG = "anwar-os-outbox"

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
        if (key.startsWith("anwar-os-") && !CURRENT_CACHES.includes(key)) await caches.delete(key)
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
    event.respondWith(navigation(event, url))
    return
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request))
  }
})

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** The cache key for a page that may be saved, or null. Trailing slashes don't count. */
function pageKey(url) {
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname
  return OFFLINE_PAGES.includes(path) ? path : null
}

/** Pages served from the cache, by the client they were served to (and by key as a fallback). */
const servedFromCache = new Map()

function noteServed(event, key, savedAt) {
  const entry = { savedAt, at: Date.now() }
  if (event.resultingClientId) servedFromCache.set(event.resultingClientId, entry)
  servedFromCache.set(key, entry)
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
}

async function navigation(event, url) {
  const key = url.search ? null : pageKey(url)
  const lookupKey = pageKey(url)

  const fromNetwork = (async () => {
    const response = (await event.preloadResponse) || (await fetch(event.request))
    event.waitUntil(remember(response, key ?? lookupKey, Boolean(key)))
    return response
  })()
  // Keep going after a timeout, so a slow load still refreshes the saved copy.
  event.waitUntil(fromNetwork.then(() => undefined, () => undefined))

  const saved = lookupKey ? await savedPage(lookupKey) : undefined
  try {
    return saved ? await Promise.race([fromNetwork, timeout(NETWORK_TIMEOUT_MS)]) : await fromNetwork
  } catch {
    if (saved) {
      noteServed(event, lookupKey, saved.headers.get(SAVED_AT_HEADER))
      return saved
    }
    return (await caches.match(OFFLINE_URL)) || Response.error()
  }
}

async function savedPage(key) {
  const cache = await caches.open(PAGES_CACHE)
  return cache.match(key)
}

/**
 * Saves a copy of a page that came from the network, when `save` and it's a
 * plain 200 HTML page. A saved page that now redirects means the session is
 * gone (src/proxy.ts sends signed-out visitors to /login): drop every copy.
 */
async function remember(response, key, save) {
  if (!key) return
  const signedOut =
    response.type === "opaqueredirect" || (response.redirected && new URL(response.url).pathname === "/login")
  if (signedOut) {
    await caches.delete(PAGES_CACHE)
    return
  }
  if (!save || response.status !== 200 || response.type !== "basic" || response.redirected) return
  if (!(response.headers.get("content-type") || "").includes("text/html")) return
  const headers = new Headers(response.headers)
  headers.set(SAVED_AT_HEADER, new Date().toISOString())
  const copy = response.clone()
  const body = await copy.blob()
  const cache = await caches.open(PAGES_CACHE)
  await cache.put(key, new Response(body, { status: 200, statusText: copy.statusText, headers }))
}

/** Saves the offline pages that aren't saved yet (a page's first visit offline would otherwise fail). */
async function warm() {
  const cache = await caches.open(PAGES_CACHE)
  for (const key of OFFLINE_PAGES) {
    if (await cache.match(key)) continue
    try {
      const response = await fetch(key, { credentials: "same-origin", redirect: "manual", headers: { Accept: "text/html" } })
      await remember(response, key, true)
      // Signed out: stop here; remember() dropped the cache.
      if (response.type === "opaqueredirect") return
    } catch {
      return
    }
  }
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Messages from the app
// ---------------------------------------------------------------------------

self.addEventListener("message", (event) => {
  const data = event.data || {}
  const reply = (message) => {
    if (event.ports && event.ports[0]) event.ports[0].postMessage(message)
  }
  switch (data.type) {
    case "page-info": {
      // How was this client's page served? { fromCache, savedAt }.
      const byClient = event.source && servedFromCache.get(event.source.id)
      const byKey = data.path && servedFromCache.get(data.path)
      const entry = byClient || (byKey && Date.now() - byKey.at < 30_000 ? byKey : null)
      reply({ fromCache: Boolean(entry), savedAt: entry ? entry.savedAt : null })
      break
    }
    case "warm-pages":
      event.waitUntil(warm().then(() => reply({ ok: true }), () => reply({ ok: false })))
      break
    case "forget-pages":
      event.waitUntil(caches.delete(PAGES_CACHE).then(() => reply({ ok: true })))
      break
  }
})

// ---------------------------------------------------------------------------
// Background Sync: replay the outbox while the app is closed
// ---------------------------------------------------------------------------

self.addEventListener("sync", (event) => {
  if (event.tag === BACKGROUND_SYNC_TAG) event.waitUntil(replayOutbox())
})

function idb(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function openOutbox() {
  const request = indexedDB.open(OUTBOX_DB, OUTBOX_DB_VERSION)
  request.onupgradeneeded = () => {
    const db = request.result
    if (!db.objectStoreNames.contains(OUTBOX_STORE)) db.createObjectStore(OUTBOX_STORE, { keyPath: "id" }).createIndex("seq", "seq")
  }
  return idb(request)
}

function storeOp(db, mode, op) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, mode)
    const request = op(tx.objectStore(OUTBOX_STORE))
    let result
    request.onsuccess = () => {
      result = request.result
    }
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

async function tellClients() {
  for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage({ type: "outbox:changed" })
}

/** Same rules as syncOutbox() in src/lib/offline/sync.ts. Throws to make the browser try again later. */
async function replayOutbox() {
  const run = async () => {
    const db = await openOutbox()
    try {
      const items = (await storeOp(db, "readonly", (s) => s.index("seq").getAll())).filter((i) => i.status === "pending")
      for (const item of items) {
        let response
        try {
          response = await fetch(`/api/sync/${item.kind}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: item.id, userId: item.userId, capturedAt: item.capturedAt, payload: item.payload }),
            credentials: "same-origin",
            cache: "no-store",
          })
        } catch {
          throw new Error("offline")
        }
        let body = null
        try {
          body = await response.json()
        } catch {
          // not JSON
        }
        if (response.ok && body && body.ok === true) {
          await storeOp(db, "readwrite", (s) => s.delete(item.id))
          continue
        }
        if (response.status === 401) break
        if (response.status === 409 && body && body.error === "other_user") continue
        if (response.status === 408 || response.status === 429 || response.status >= 500 || response.ok) {
          throw new Error(`server ${response.status}`)
        }
        const message = (body && typeof body.message === "string" && body.message) || "The server didn't accept this. Edit it in the app or discard it."
        await storeOp(db, "readwrite", (s) =>
          s.put({ ...item, status: "failed", error: message, attempts: item.attempts + 1, lastAttemptAt: new Date().toISOString() }),
        )
      }
    } finally {
      db.close()
      await tellClients()
    }
  }
  if (self.navigator && self.navigator.locks) return self.navigator.locks.request(SYNC_LOCK, run)
  return run()
}
