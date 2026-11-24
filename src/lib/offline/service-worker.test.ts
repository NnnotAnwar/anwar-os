// public/sw.js, run in a sandbox with an in-memory Cache API and a fake
// network: what it saves, what it serves offline, what it never touches, and
// the update path (a new version deletes the old version's caches).
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ORIGIN = "https://anwar.example"
const source = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8")

const keyOf = (input: string | { url: string }) => new URL(typeof input === "string" ? input : input.url, ORIGIN).href

class FakeCache {
  entries = new Map<string, Response>()
  async match(input: string | { url: string }) {
    return this.entries.get(keyOf(input))?.clone()
  }
  async put(input: string | { url: string }, response: Response) {
    this.entries.set(keyOf(input), response)
  }
  async delete(input: string | { url: string }) {
    return this.entries.delete(keyOf(input))
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url))
  }
  async addAll(urls: string[]) {
    for (const url of urls) this.entries.set(keyOf(url), new Response(`precached ${url}`))
  }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>()
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache())
    return this.stores.get(name)!
  }
  async keys() {
    return [...this.stores.keys()]
  }
  async delete(name: string) {
    return this.stores.delete(name)
  }
  async match(input: string | { url: string }) {
    for (const cache of this.stores.values()) {
      const hit = await cache.match(input)
      if (hit) return hit
    }
    return undefined
  }
}

/** A Response with the fields a browser sets and Node's doesn't (type, redirected, url). */
function served(body: string | null, init: ResponseInit & { type?: string; redirected?: boolean; url?: string } = {}) {
  const response = new Response(body, init)
  Object.defineProperty(response, "type", { value: init.type ?? "basic" })
  Object.defineProperty(response, "redirected", { value: init.redirected ?? false })
  if (init.url) Object.defineProperty(response, "url", { value: init.url })
  return response
}

const html = (text: string) =>
  served(`<!doctype html><title>${text}</title>`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "script-src 'nonce-abc'" },
  })

type Listener = (event: unknown) => void

function loadWorker(cacheStorage = new FakeCacheStorage()) {
  const listeners = new Map<string, Listener>()
  let network: (request: { url: string }) => Promise<Response> = async () => {
    throw new TypeError("Failed to fetch")
  }
  const self = {
    location: new URL(ORIGIN),
    registration: { navigationPreload: { enable: async () => {} } },
    clients: { claim: async () => {}, matchAll: async () => [] },
    skipWaiting: async () => {},
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
  }
  runInNewContext(source, {
    self,
    caches: cacheStorage,
    fetch: (request: string | { url: string }) => network(typeof request === "string" ? { url: keyOf(request) } : request),
    URL,
    Request,
    Response,
    Headers,
    Promise,
    Date,
    Map,
    console,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  })

  async function lifecycle(type: "install" | "activate") {
    const waits: Promise<unknown>[] = []
    listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => waits.push(p) })
    await Promise.all(waits)
  }

  function fetchEvent(url: string, { mode = "navigate", headers = {}, clientId = "client-1" }: { mode?: string; headers?: Record<string, string>; clientId?: string } = {}) {
    let response: Promise<Response> | undefined
    const waits: Promise<unknown>[] = []
    listeners.get("fetch")!({
      request: { url: new URL(url, ORIGIN).href, method: "GET", mode, headers: new Headers(headers) },
      preloadResponse: Promise.resolve(undefined),
      resultingClientId: clientId,
      respondWith: (p: Promise<Response>) => {
        response = p
      },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    })
    return {
      response,
      /** Background work (saving a copy) finished. */
      settled: async () => {
        await response?.catch(() => undefined)
        for (let i = 0; i < waits.length; i++) await waits[i]
      },
    }
  }

  async function message(data: Record<string, unknown>, sourceId = "client-1") {
    let reply: unknown
    const waits: Promise<unknown>[] = []
    listeners.get("message")!({
      data,
      source: { id: sourceId },
      ports: [{ postMessage: (m: unknown) => (reply = m) }],
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    })
    await Promise.all(waits)
    return reply
  }

  return {
    caches: cacheStorage,
    setNetwork: (fn: typeof network) => {
      network = fn
    },
    lifecycle,
    fetchEvent,
    message,
    pages: async () => [...((await cacheStorage.open("anwar-os-pages-v1")).entries.keys())].map((u) => new URL(u).pathname),
  }
}

describe("service worker", () => {
  beforeEach(() => {
    vi.useRealTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("updates cleanly: a new version deletes the old version's caches and keeps others", async () => {
    const storage = new FakeCacheStorage()
    for (const name of ["anwar-os-shell-v1", "anwar-os-static", "anwar-os-pages-v0", "someone-elses-cache"]) await storage.open(name)
    const sw = loadWorker(storage)
    await sw.lifecycle("install")
    await sw.lifecycle("activate")
    expect((await storage.keys()).sort()).toEqual(["anwar-os-shell-v2", "someone-elses-cache"])
    expect(await (await storage.open("anwar-os-shell-v2")).match("/offline.html")).toBeTruthy()
  })

  it("saves a visited app page and serves it, CSP and all, when the network is gone", async () => {
    const sw = loadWorker()
    await sw.lifecycle("install")
    sw.setNetwork(async () => html("Inbox live"))
    const online = sw.fetchEvent("/app/inbox")
    expect(await (await online.response!).text()).toContain("Inbox live")
    await online.settled()
    expect(await sw.pages()).toEqual(["/app/inbox"])

    sw.setNetwork(async () => {
      throw new TypeError("Failed to fetch")
    })
    const offline = sw.fetchEvent("/app/inbox", { clientId: "client-2" })
    const response = await offline.response!
    expect(await response.text()).toContain("Inbox live")
    expect(response.headers.get("content-security-policy")).toBe("script-src 'nonce-abc'")
    const savedAt = response.headers.get("x-anwar-saved-at")
    expect(Date.parse(savedAt!)).not.toBeNaN()

    expect(await sw.message({ type: "page-info", path: "/app/inbox" }, "client-2")).toEqual({ fromCache: true, savedAt })
    // A page loaded live isn't reported as a saved copy (after the key's short grace period).
    expect(await sw.message({ type: "page-info", path: "/app/tasks" }, "client-9")).toEqual({ fromCache: false, savedAt: null })
  })

  it("saves only plain addresses, but serves the saved page for any query", async () => {
    const sw = loadWorker()
    await sw.lifecycle("install")
    sw.setNetwork(async () => html("Tasks with a sheet open"))
    const withQuery = sw.fetchEvent("/app/tasks?task=123")
    await withQuery.settled()
    expect(await sw.pages()).toEqual([])

    sw.setNetwork(async () => html("Tasks"))
    await sw.fetchEvent("/app/tasks/").settled()
    expect(await sw.pages()).toEqual(["/app/tasks"])

    sw.setNetwork(async () => {
      throw new TypeError("offline")
    })
    expect(await (await sw.fetchEvent("/app/tasks?view=upcoming").response!).text()).toContain("Tasks")
  })

  it("never saves other pages, errors or non-HTML; offline they get the offline page", async () => {
    const sw = loadWorker()
    await sw.lifecycle("install")
    sw.setNetwork(async () => html("Settings"))
    await sw.fetchEvent("/app/settings").settled()
    sw.setNetwork(async () => served("oops", { status: 500, headers: { "content-type": "text/html" } }))
    await sw.fetchEvent("/app/notes").settled()
    sw.setNetwork(async () => served("{}", { status: 200, headers: { "content-type": "application/json" } }))
    await sw.fetchEvent("/app/budget").settled()
    expect(await sw.pages()).toEqual([])

    sw.setNetwork(async () => {
      throw new TypeError("offline")
    })
    expect(await (await sw.fetchEvent("/app/settings").response!).text()).toBe("precached /offline.html")
  })

  it("drops every saved page when one redirects (signed out)", async () => {
    const sw = loadWorker()
    await sw.lifecycle("install")
    sw.setNetwork(async () => html("Today"))
    await sw.fetchEvent("/app").settled()
    expect(await sw.pages()).toEqual(["/app"])

    sw.setNetwork(async () => served(null, { type: "opaqueredirect" }))
    await sw.fetchEvent("/app/notes").settled()
    expect(await sw.caches.keys()).not.toContain("anwar-os-pages-v1")
  })

  it("shows the saved copy when the network hangs (iOS: connected, no internet)", async () => {
    vi.useFakeTimers()
    const sw = loadWorker()
    await sw.lifecycle("install")
    sw.setNetwork(async () => html("Budget"))
    await sw.fetchEvent("/app/budget").settled()

    sw.setNetwork(() => new Promise(() => {}))
    const event = sw.fetchEvent("/app/budget")
    await vi.advanceTimersByTimeAsync(6000)
    expect(await (await event.response!).text()).toContain("Budget")
  })

  it("forgets saved pages when the app asks (sign-out)", async () => {
    const sw = loadWorker()
    await sw.lifecycle("install")
    sw.setNetwork(async () => html("Notes"))
    await sw.fetchEvent("/app/notes").settled()
    expect(await sw.message({ type: "forget-pages" })).toEqual({ ok: true })
    expect(await sw.caches.keys()).not.toContain("anwar-os-pages-v1")
  })

  it("saves the offline pages not opened yet, once each", async () => {
    const sw = loadWorker()
    await sw.lifecycle("install")
    const fetched: string[] = []
    sw.setNetwork(async (request) => {
      fetched.push(new URL(request.url).pathname)
      return html(request.url)
    })
    await sw.fetchEvent("/app").settled()
    fetched.length = 0
    await sw.message({ type: "warm-pages" })
    expect(fetched).toEqual(["/app/inbox", "/app/tasks", "/app/notes", "/app/notes/new", "/app/budget", "/app/capture"])
    fetched.length = 0
    await sw.message({ type: "warm-pages" })
    expect(fetched).toEqual([])
  })

  it("leaves the API, RSC requests and other origins to the browser", async () => {
    const sw = loadWorker()
    await sw.lifecycle("install")
    expect(sw.fetchEvent("/api/sync/inbox", { mode: "cors" }).response).toBeUndefined()
    expect(sw.fetchEvent("/api/auth/get-session", { mode: "cors" }).response).toBeUndefined()
    expect(sw.fetchEvent("/app/inbox", { mode: "cors", headers: { RSC: "1" } }).response).toBeUndefined()
    expect(sw.fetchEvent("/app/inbox?_rsc=abc", { mode: "cors" }).response).toBeUndefined()
    expect(sw.fetchEvent("https://cdn.fontshare.com/font.woff2", { mode: "cors" }).response).toBeUndefined()
  })

  it("serves build assets cache-first", async () => {
    const sw = loadWorker()
    await sw.lifecycle("install")
    let hits = 0
    sw.setNetwork(async () => {
      hits++
      return served("chunk", { status: 200, headers: { "cache-control": "public, max-age=31536000, immutable" } })
    })
    await (await sw.fetchEvent("/_next/static/chunks/app.js", { mode: "no-cors" }).response!).text()
    expect(await (await sw.fetchEvent("/_next/static/chunks/app.js", { mode: "no-cors" }).response!).text()).toBe("chunk")
    expect(hits).toBe(1)
  })
})
