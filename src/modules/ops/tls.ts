import "server-only"
import tls from "node:tls"
import { toCertCheck, type CertCheck, type PeerCert } from "./lib/server"

// Certificate expiry per site the edge serves. Web does the dialling, not
// ops-agent: the agent sits on the `internal` network with no route out, web
// is on `edge` (and reaches the server's own public address like a visitor).
// Results are cached: a certificate changes every ~60 days, the panel and the
// alert loop ask every few minutes.

const OK_TTL_MS = 60 * 60_000
const ERROR_TTL_MS = 5 * 60_000
const cache = new Map<string, { at: number; result: CertCheck }>()

/** Dials domain:443 with SNI and reads the leaf certificate. Never throws. */
export function checkCertificate(domain: string, { host = domain, port = 443, timeoutMs = 8000 } = {}): Promise<CertCheck> {
  return new Promise((resolve) => {
    let settled = false
    const done = (result: CertCheck) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    const fail = (message: string) =>
      done({ domain, validTo: null, issuer: null, trusted: false, error: message, checkedAt: new Date().toISOString() })

    // rejectUnauthorized: false, so an expired or wrong certificate is still
    // read (and reported as untrusted) instead of only failing the handshake.
    const socket = tls.connect({ host, port, servername: domain, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] }, () =>
      done(toCertCheck(domain, socket.getPeerCertificate() as PeerCert, socket.authorized, socket.authorizationError, new Date())),
    )
    socket.setTimeout(timeoutMs, () => fail("Timed out."))
    socket.on("error", (e: NodeJS.ErrnoException) => fail(e.code ? `${e.code}: ${e.message}` : e.message))
  })
}

/** Every domain, in parallel, from the cache when fresh. */
export async function checkCertificates(domains: string[], now = Date.now()): Promise<CertCheck[]> {
  return Promise.all(
    domains.map(async (domain) => {
      const hit = cache.get(domain)
      if (hit && now - hit.at < (hit.result.validTo ? OK_TTL_MS : ERROR_TTL_MS)) return hit.result
      const result = await checkCertificate(domain)
      cache.set(domain, { at: now, result })
      return result
    }),
  )
}

/** The site's own hostname, when it is served over HTTPS (production). */
export function ownDomain(url = process.env.BETTER_AUTH_URL): string | null {
  try {
    const u = new URL(url ?? "")
    return u.protocol === "https:" && u.hostname.includes(".") ? u.hostname : null
  } catch {
    return null
  }
}
