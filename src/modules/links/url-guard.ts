import { isIP } from "node:net"

// SSRF guard for server-side fetches of user-supplied URLs. The rule: only
// http(s) on standard ports, no credentials, and every address the host
// resolves to must be a public unicast address. Checking happens again for
// every redirect hop and at connect time (see fetch-metadata.ts), so a DNS
// answer can't change between the check and the connection.

export const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"])

/** What a fetch may reach. Only tests swap this out (to reach a local server). */
export type GuardPolicy = {
  isAllowedAddress: (ip: string) => boolean
  allowedPorts: ReadonlySet<string> | null
}

export const strictPolicy: GuardPolicy = {
  isAllowedAddress: (ip) => isPublicAddress(ip),
  allowedPorts: ALLOWED_PORTS,
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string }

/** Syntax-level checks that need no network. Hostnames are checked again after DNS. */
export function checkUrl(raw: string | URL, policy: GuardPolicy = strictPolicy): UrlCheck {
  let url: URL
  try {
    url = typeof raw === "string" ? new URL(raw.trim()) : new URL(raw.href)
  } catch {
    return { ok: false, reason: "not a valid URL" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "only http and https" }
  if (url.username || url.password) return { ok: false, reason: "credentials in URL" }
  if (policy.allowedPorts && !policy.allowedPorts.has(url.port)) return { ok: false, reason: "non-standard port" }

  const host = hostnameOf(url)
  if (!host) return { ok: false, reason: "missing host" }
  if (isIP(host)) {
    return policy.isAllowedAddress(host) ? { ok: true, url } : { ok: false, reason: "private address" }
  }
  // Single-label names ("localhost", "db", "ops-agent") only resolve inside a
  // private network; so do these reserved suffixes.
  if (!host.includes(".")) return { ok: false, reason: "not a public hostname" }
  if (/\.(localhost|local|internal|home\.arpa|lan|intranet|corp|test|invalid|example)$/i.test(host)) {
    return { ok: false, reason: "not a public hostname" }
  }
  return { ok: true, url }
}

/** URL.hostname without IPv6 brackets or a trailing root dot. */
export function hostnameOf(url: URL) {
  return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase()
}

// --- addresses -------------------------------------------------------------

/** Parses a dotted-quad IPv4 address to a 32-bit unsigned integer. */
export function parseIPv4(ip: string): number | null {
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    value = value * 256 + n
  }
  return value
}

/** Parses an IPv6 address (incl. `::` and an embedded IPv4 tail) to 8 groups. */
export function parseIPv6(ip: string): number[] | null {
  if (ip.includes("%")) return null // zone ids only make sense on a local link
  let text = ip
  const lastColon = text.lastIndexOf(":")
  if (lastColon === -1) return null
  const last = text.slice(lastColon + 1)
  if (last.includes(".")) {
    // "::ffff:1.2.3.4" → "::ffff:102:304"
    const v4 = parseIPv4(last)
    if (v4 === null) return null
    text = `${text.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`
  }
  const halves = text.split("::")
  if (halves.length > 2) return null
  const split = (s: string) => (s === "" ? [] : s.split(":"))
  const left = split(halves[0]!)
  const right = halves.length === 2 ? split(halves[1]!) : []
  if (![...left, ...right].every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null
  const zeros = 8 - left.length - right.length
  if (halves.length === 2 ? zeros < 1 : zeros !== 0) return null
  return [...left, ...Array<string>(zeros).fill("0"), ...right].map((g) => parseInt(g, 16))
}

const v4 = (cidr: string): [number, number] => {
  const [addr, bits] = cidr.split("/")
  return [parseIPv4(addr!)!, Number(bits)]
}

// Everything that isn't globally routable unicast (IANA special-purpose registry).
const BLOCKED_V4 = [
  "0.0.0.0/8", // "this" network
  "10.0.0.0/8", // private
  "100.64.0.0/10", // carrier-grade NAT
  "127.0.0.0/8", // loopback
  "169.254.0.0/16", // link-local, incl. cloud metadata 169.254.169.254
  "172.16.0.0/12", // private (Docker's default bridge lives here)
  "192.0.0.0/24", // IETF protocol assignments
  "192.0.2.0/24", // TEST-NET-1
  "192.88.99.0/24", // 6to4 relay anycast
  "192.168.0.0/16", // private
  "198.18.0.0/15", // benchmarking
  "198.51.100.0/24", // TEST-NET-2
  "203.0.113.0/24", // TEST-NET-3
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved, incl. broadcast
].map(v4)

function inV4(value: number, [base, bits]: [number, number]) {
  if (bits === 0) return true
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return (value & mask) >>> 0 === (base & mask) >>> 0
}

export function isPublicIPv4(ip: string) {
  const value = parseIPv4(ip)
  if (value === null) return false
  return !BLOCKED_V4.some((range) => inV4(value, range))
}

export function isPublicIPv6(ip: string) {
  const g = parseIPv6(ip)
  if (!g) return false
  const embeddedV4 = () => `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`

  if (g.every((x) => x === 0)) return false // :: unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false // ::1 loopback
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d: judge the IPv4.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPublicIPv4(embeddedV4())
  // NAT64 64:ff9b::/96 translates to the embedded IPv4.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPublicIPv4(embeddedV4())
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return false // 64:ff9b:1::/48 local NAT64
  if (g[0] === 0x100 && g.slice(1, 4).every((x) => x === 0)) return false // 100::/64 discard
  if (g[0] === 0x2001 && g[1]! < 0x200) return false // 2001::/23 IETF assignments, incl. Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return false // 2001:db8::/32 documentation
  if (g[0] === 0x2002) return false // 6to4 tunnels to arbitrary IPv4
  if (g[0] === 0x3fff && g[1]! < 0x1000) return false // 3fff::/20 documentation
  if ((g[0]! & 0xfe00) === 0xfc00) return false // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return false // fe80::/10 link-local
  if ((g[0]! & 0xffc0) === 0xfec0) return false // fec0::/10 site-local (deprecated)
  if ((g[0]! & 0xff00) === 0xff00) return false // ff00::/8 multicast
  // Only 2000::/3 is allocated global unicast.
  return (g[0]! & 0xe000) === 0x2000
}

/** True only for a globally routable unicast IPv4 or IPv6 address. */
export function isPublicAddress(ip: string) {
  const bare = ip.replace(/^\[|\]$/g, "")
  switch (isIP(bare)) {
    case 4:
      return isPublicIPv4(bare)
    case 6:
      return isPublicIPv6(bare)
    default:
      return false
  }
}

// --- DNS ---------------------------------------------------------------------

export type LookupAll = (hostname: string) => Promise<{ address: string; family: number }[]>

/**
 * Resolves `hostname` and returns its addresses only if every one is public.
 * A host with even one private record is refused, so a mixed answer can't be
 * used to reach the inside.
 */
export async function resolvePublic(hostname: string, lookupAll: LookupAll, policy: GuardPolicy = strictPolicy) {
  if (isIP(hostname)) {
    if (!policy.isAllowedAddress(hostname)) throw new BlockedUrlError("private address")
    return [{ address: hostname, family: isIP(hostname) }]
  }
  let addresses: { address: string; family: number }[]
  try {
    addresses = await lookupAll(hostname)
  } catch {
    throw new BlockedUrlError("host not found")
  }
  if (addresses.length === 0) throw new BlockedUrlError("host not found")
  if (!addresses.every((a) => policy.isAllowedAddress(a.address))) throw new BlockedUrlError("private address")
  return addresses
}

export class BlockedUrlError extends Error {
  constructor(reason: string) {
    super(`Blocked URL: ${reason}`)
    this.name = "BlockedUrlError"
  }
}
