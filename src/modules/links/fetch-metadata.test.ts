import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { gzipSync } from "node:zlib"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { fetchPageMetadata, type FetchOptions } from "./fetch-metadata"
import { isPublicAddress, type GuardPolicy, type LookupAll } from "./url-guard"

// A local server stands in for the internet. The default policy would (rightly)
// refuse 127.0.0.1, so these tests use a policy that allows exactly the test
// server's loopback address on any port — and nothing else private.
const testPolicy: GuardPolicy = {
  isAllowedAddress: (ip) => ip === "127.0.0.1" || isPublicAddress(ip),
  allowedPorts: null,
}

// Fake DNS: friendly names for the test server, and names that point inside.
const lookupAll: LookupAll = async (host) => {
  const table: Record<string, string> = {
    "site.example.com": "127.0.0.1",
    "evil.example.com": "10.0.0.1",
    "metadata.example.com": "169.254.169.254",
  }
  const address = table[host]
  if (!address) throw new Error("ENOTFOUND")
  return [{ address, family: 4 }]
}

let server: Server
let base = ""
let port = 0
let requests: string[] = []

const html = (title: string) =>
  `<!doctype html><html><head><title>${title}</title><meta name="description" content="About ${title}"></head><body>${"x".repeat(100)}</body></html>`

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(req.url ?? "")
    const url = new URL(req.url ?? "/", "http://x")
    switch (url.pathname) {
      case "/ok":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html("Hello"))
        return
      case "/gzip":
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }).end(gzipSync(html("Zipped")))
        return
      case "/cp1251":
        res
          .writeHead(200, { "content-type": "text/html; charset=windows-1251" })
          // "Привет" in windows-1251
          .end(Buffer.concat([Buffer.from("<title>"), Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]), Buffer.from("</title>")]))
        return
      case "/json":
        res.writeHead(200, { "content-type": "application/json" }).end("{}")
        return
      case "/missing":
        res.writeHead(404, { "content-type": "text/html" }).end("nope")
        return
      case "/slow":
        // Headers arrive, the body never does.
        res.writeHead(200, { "content-type": "text/html" })
        res.write("<html><head>")
        return
      case "/huge": {
        // A <head> that never closes and goes on far past the limit.
        res.writeHead(200, { "content-type": "text/html" })
        res.write("<html><head><title>Huge</title>")
        const chunk = `<meta name="x" content="${"y".repeat(10_000)}">`
        let sent = 0
        const pump = () => {
          while (sent < 5_000_000) {
            sent += chunk.length
            if (!res.write(chunk)) return void res.once("drain", pump)
          }
          res.end()
        }
        pump()
        return
      }
      case "/bomb":
        // 50 MB of zeros compresses to ~50 KB; reading must stop at the limit.
        res
          .writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" })
          .end(gzipSync(Buffer.concat([Buffer.from("<html><head><title>Bomb</title>"), Buffer.alloc(50_000_000, 0x20)])))
        return
      case "/redirect": {
        const n = Number(url.searchParams.get("n") ?? 0)
        res.writeHead(302, { location: n > 0 ? `/redirect?n=${n - 1}` : "/ok" }).end()
        return
      }
      case "/to": {
        res.writeHead(301, { location: url.searchParams.get("u") ?? "/" }).end()
        return
      }
      default:
        res.writeHead(500).end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  port = (server.address() as AddressInfo).port
  base = `http://127.0.0.1:${port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const opts = (extra: FetchOptions = {}): FetchOptions => ({ policy: testPolicy, lookupAll, ...extra })

describe("fetchPageMetadata", () => {
  it("reads title and description", async () => {
    const meta = await fetchPageMetadata(`${base}/ok`, opts())
    expect(meta).toMatchObject({ title: "Hello", description: "About Hello", faviconUrl: `${base}/favicon.ico` })
  })

  it("resolves hostnames through the guarded lookup", async () => {
    const meta = await fetchPageMetadata(`http://site.example.com:${port}/ok`, opts())
    expect(meta.title).toBe("Hello")
  })

  it("decompresses gzip and decodes declared charsets", async () => {
    expect((await fetchPageMetadata(`${base}/gzip`, opts())).title).toBe("Zipped")
    expect((await fetchPageMetadata(`${base}/cp1251`, opts())).title).toBe("Привет")
  })

  it("follows up to 3 redirects and reports where it landed", async () => {
    const meta = await fetchPageMetadata(`${base}/redirect?n=2`, opts())
    expect(meta.title).toBe("Hello")
    expect(meta.finalUrl).toBe(`${base}/ok`)
  })

  it("gives up after 3 redirects", async () => {
    await expect(fetchPageMetadata(`${base}/redirect?n=3`, opts())).rejects.toThrow("too many redirects")
  })

  it("re-checks every redirect hop against the guard", async () => {
    const to = (u: string) => `${base}/to?u=${encodeURIComponent(u)}`
    await expect(fetchPageMetadata(to("http://10.0.0.1/"), opts())).rejects.toThrow("private address")
    await expect(fetchPageMetadata(to("http://169.254.169.254/latest/meta-data/"), opts())).rejects.toThrow(
      "private address",
    )
    await expect(fetchPageMetadata(to("file:///etc/passwd"), opts())).rejects.toThrow("only http and https")
    await expect(fetchPageMetadata(to("http://localhost/"), opts())).rejects.toThrow("not a public hostname")
  })

  it("refuses a hostname whose DNS points at a private address, at connect time", async () => {
    await expect(fetchPageMetadata(`http://evil.example.com:${port}/ok`, opts())).rejects.toThrow("private address")
    await expect(fetchPageMetadata(`${base}/to?u=${encodeURIComponent("http://metadata.example.com/")}`, opts())).rejects.toThrow(
      "private address",
    )
  })

  it("refuses the test server itself under the strict default policy", async () => {
    requests = []
    await expect(fetchPageMetadata(`${base}/ok`)).rejects.toThrow()
    await expect(fetchPageMetadata(`http://site.example.com:${port}/ok`, { lookupAll })).rejects.toThrow()
    expect(requests).toEqual([])
  })

  it("accepts only HTML", async () => {
    await expect(fetchPageMetadata(`${base}/json`, opts())).rejects.toThrow("not an HTML page")
  })

  it("fails on error statuses", async () => {
    await expect(fetchPageMetadata(`${base}/missing`, opts())).rejects.toThrow("status 404")
  })

  it("times out the whole chain", async () => {
    const started = Date.now()
    await expect(fetchPageMetadata(`${base}/slow`, opts({ timeoutMs: 300 }))).rejects.toThrow("timed out")
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it("stops reading at the size limit", async () => {
    const meta = await fetchPageMetadata(`${base}/huge`, opts({ maxBytes: 50_000 }))
    expect(meta.title).toBe("Huge")
  })

  it("stops a decompression bomb at the size limit", async () => {
    const started = Date.now()
    const meta = await fetchPageMetadata(`${base}/bomb`, opts())
    expect(meta.title).toBe("Bomb")
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})
