// checkCertificate against a real TLS server on 127.0.0.1 with a throwaway
// self-signed certificate (openssl; skipped where it isn't installed).
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import tls from "node:tls"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const { checkCertificate, ownDomain } = await import("./tls")

function hasOpenssl() {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!hasOpenssl())("checkCertificate", () => {
  let server: tls.Server
  let port = 0
  const dir = mkdtempSync(join(tmpdir(), "ops-tls-"))

  beforeAll(async () => {
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "10", "-subj", "/CN=site.test",
        "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")],
      { stdio: "ignore" },
    )
    server = tls.createServer({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }, (s) => s.end())
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    port = (server.address() as { port: number }).port
  })

  afterAll(() => {
    server?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it("reads the expiry of a certificate it doesn't trust", async () => {
    const c = await checkCertificate("site.test", { host: "127.0.0.1", port })
    expect(c.domain).toBe("site.test")
    expect(c.trusted).toBe(false)
    expect(c.error).toMatch(/SELF_SIGNED/)
    const days = (new Date(c.validTo!).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(9)
    expect(days).toBeLessThanOrEqual(10)
  })

  it("reports a refused connection without throwing", async () => {
    const closed = tls.createServer()
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve))
    const freePort = (closed.address() as { port: number }).port
    await new Promise<void>((resolve) => closed.close(() => resolve()))
    const c = await checkCertificate("site.test", { host: "127.0.0.1", port: freePort, timeoutMs: 2000 })
    expect(c).toMatchObject({ validTo: null, trusted: false })
    expect(c.error).toMatch(/ECONNREFUSED/)
  })
})

describe("ownDomain", () => {
  it("is the HTTPS hostname of the site, never localhost", () => {
    expect(ownDomain("https://anwar-os.com")).toBe("anwar-os.com")
    expect(ownDomain("http://127.0.0.1:3303")).toBeNull()
    expect(ownDomain("https://localhost:3000")).toBeNull()
    expect(ownDomain(undefined)).toBeNull()
  })
})
