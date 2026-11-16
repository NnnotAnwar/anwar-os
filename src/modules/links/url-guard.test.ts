import { describe, expect, it } from "vitest"
import {
  BlockedUrlError,
  checkUrl,
  isPublicAddress,
  parseIPv4,
  parseIPv6,
  resolvePublic,
  type LookupAll,
} from "./url-guard"

describe("parseIPv4", () => {
  it("parses dotted quads", () => {
    expect(parseIPv4("0.0.0.0")).toBe(0)
    expect(parseIPv4("127.0.0.1")).toBe(0x7f000001)
    expect(parseIPv4("255.255.255.255")).toBe(0xffffffff)
  })

  it.each(["1.2.3", "1.2.3.4.5", "256.1.1.1", "1.2.3.-4", "a.b.c.d", "1..2.3", "0x7f.0.0.1", ""])(
    "rejects %j",
    (ip) => expect(parseIPv4(ip)).toBeNull(),
  )
})

describe("parseIPv6", () => {
  it("expands :: and keeps groups in order", () => {
    expect(parseIPv6("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    expect(parseIPv6("fe80::1")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1])
    expect(parseIPv6("2001:db8:0:0:1:0:0:1")).toEqual([0x2001, 0xdb8, 0, 0, 1, 0, 0, 1])
    expect(parseIPv6("2a00:1450:4001:82b::200e")).toEqual([0x2a00, 0x1450, 0x4001, 0x82b, 0, 0, 0, 0x200e])
  })

  it("reads an embedded IPv4 tail", () => {
    expect(parseIPv6("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1])
    expect(parseIPv6("64:ff9b::10.0.0.1")).toEqual([0x64, 0xff9b, 0, 0, 0, 0, 0x0a00, 1])
  })

  it.each(["1:2:3:4:5:6:7:8:9", "1::2::3", "12345::", "fe80::1%eth0", "::ffff:999.0.0.1", "g::1", "1:2:3:4:5:6:7"])(
    "rejects %j",
    (ip) => expect(parseIPv6(ip)).toBeNull(),
  )
})

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.215.14",
    "172.32.0.1", // just outside 172.16/12
    "100.128.0.1", // just outside CGNAT
    "2a00:1450:4001:82b::200e",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
    "[2606:4700:4700::1111]",
  ])("allows public %s", (ip) => expect(isPublicAddress(ip)).toBe(true))

  it.each([
    ["0.0.0.0", "this network"],
    ["10.1.2.3", "private"],
    ["100.64.0.1", "CGNAT"],
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["169.254.169.254", "cloud metadata"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.0.0.8", "IETF"],
    ["192.0.2.1", "TEST-NET-1"],
    ["192.168.1.1", "private"],
    ["198.18.0.1", "benchmark"],
    ["198.51.100.7", "TEST-NET-2"],
    ["203.0.113.9", "TEST-NET-3"],
    ["224.0.0.1", "multicast"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "broadcast"],
    ["::", "unspecified"],
    ["::1", "loopback"],
    ["[::1]", "bracketed loopback"],
    ["::ffff:127.0.0.1", "mapped loopback"],
    ["::ffff:7f00:1", "mapped loopback, hex"],
    ["::ffff:10.0.0.1", "mapped private"],
    ["::ffff:169.254.169.254", "mapped metadata"],
    ["::127.0.0.1", "IPv4-compatible loopback"],
    ["64:ff9b::7f00:1", "NAT64 of loopback"],
    ["64:ff9b:1::1", "local NAT64"],
    ["100::1", "discard"],
    ["2001::1", "Teredo"],
    ["2001:db8::1", "documentation"],
    ["2002:7f00:1::1", "6to4"],
    ["fc00::1", "unique local"],
    ["fd12:3456::1", "unique local"],
    ["fe80::1", "link-local"],
    ["febf::1", "link-local"],
    ["fec0::1", "site-local"],
    ["ff02::1", "multicast"],
    ["fe80::1%lo0", "zone id"],
    ["4000::1", "unallocated"],
    ["localhost", "not an IP"],
    ["", "empty"],
  ])("blocks %s (%s)", (ip) => expect(isPublicAddress(ip)).toBe(false))
})

describe("checkUrl", () => {
  it.each([
    "https://example.com/",
    "http://example.com/path?q=1#x",
    "https://sub.example.co.uk:443/",
    "http://example.com:8080/",
    "https://8.8.8.8/",
    "https://[2606:4700:4700::1111]/",
    "  https://example.com/trimmed  ",
  ])("accepts %s", (url) => expect(checkUrl(url).ok).toBe(true))

  it.each([
    ["not a url", "not a valid URL"],
    ["ftp://example.com/", "only http and https"],
    ["file:///etc/passwd", "only http and https"],
    ["javascript:alert(1)", "only http and https"],
    ["data:text/html,hi", "only http and https"],
    ["gopher://example.com/", "only http and https"],
    ["https://user:pass@example.com/", "credentials in URL"],
    ["https://user@example.com/", "credentials in URL"],
    ["http://example.com:22/", "non-standard port"],
    ["http://example.com:5432/", "non-standard port"],
    ["http://example.com:6379/", "non-standard port"],
    ["http://127.0.0.1/", "private address"],
    ["http://0x7f000001/", "private address"], // WHATWG URL normalizes to 127.0.0.1
    ["http://2130706433/", "private address"],
    ["http://0177.0.0.1/", "private address"],
    ["http://127.1/", "private address"],
    ["http://0/", "private address"],
    ["http://[::1]/", "private address"],
    ["http://[::ffff:127.0.0.1]/", "private address"],
    ["http://169.254.169.254/latest/meta-data/", "private address"],
    ["http://10.0.0.1/", "private address"],
    ["http://localhost/", "not a public hostname"],
    ["http://localhost./", "not a public hostname"],
    ["http://db/", "not a public hostname"],
    ["http://ops-agent:8080/", "not a public hostname"],
    ["http://app.localhost/", "not a public hostname"],
    ["http://printer.local/", "not a public hostname"],
    ["http://metadata.google.internal/", "not a public hostname"],
  ])("rejects %s", (url, reason) => {
    const result = checkUrl(url)
    expect(result).toEqual({ ok: false, reason })
  })
})

describe("resolvePublic", () => {
  const dns =
    (table: Record<string, string[]>): LookupAll =>
    async (host) => {
      const answers = table[host]
      if (!answers) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" })
      return answers.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }))
    }

  it("returns the addresses of a public host", async () => {
    const result = await resolvePublic("example.com", dns({ "example.com": ["93.184.215.14", "2606:2800::1"] }))
    expect(result.map((a) => a.address)).toEqual(["93.184.215.14", "2606:2800::1"])
  })

  it("refuses a host that resolves to a private address (DNS pointing inside)", async () => {
    await expect(resolvePublic("evil.example", dns({ "evil.example": ["127.0.0.1"] }))).rejects.toThrow(BlockedUrlError)
    await expect(resolvePublic("meta.example", dns({ "meta.example": ["169.254.169.254"] }))).rejects.toThrow(
      "private address",
    )
  })

  it("refuses a host with even one private record among public ones", async () => {
    await expect(
      resolvePublic("mixed.example", dns({ "mixed.example": ["93.184.215.14", "10.0.0.5"] })),
    ).rejects.toThrow("private address")
    await expect(
      resolvePublic("mixed6.example", dns({ "mixed6.example": ["93.184.215.14", "::ffff:192.168.0.1"] })),
    ).rejects.toThrow("private address")
  })

  it("refuses unknown and empty answers", async () => {
    await expect(resolvePublic("nope.example", dns({}))).rejects.toThrow("host not found")
    await expect(resolvePublic("empty.example", dns({ "empty.example": [] }))).rejects.toThrow("host not found")
  })

  it("checks IP literals without asking DNS", async () => {
    const never: LookupAll = () => Promise.reject(new Error("should not be called"))
    await expect(resolvePublic("8.8.8.8", never)).resolves.toEqual([{ address: "8.8.8.8", family: 4 }])
    await expect(resolvePublic("192.168.0.1", never)).rejects.toThrow("private address")
  })
})
