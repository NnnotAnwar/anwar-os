import { describe, expect, it } from "vitest"
import { ReplayCache, sign, signedHeaders, verifyRequest, type SignedParts } from "./signature"

const SECRET = "test-secret-0123456789abcdef0123456789abcdef"
const NOW = 1_794_830_400_000 // ms
const parts: SignedParts = {
  timestamp: "1794830400",
  nonce: "abcdef0123456789abcdef",
  method: "POST",
  path: "/api/internal/osbot/capture",
  body: '{"kind":"note","text":"Buy milk ✓"}',
}

function headersFor(p: SignedParts, signature = sign(SECRET, p)) {
  return new Headers({ "x-osbot-timestamp": p.timestamp, "x-osbot-nonce": p.nonce, "x-osbot-signature": signature })
}

const verify = (over: Partial<Parameters<typeof verifyRequest>[0]> = {}) =>
  verifyRequest({ secret: SECRET, method: parts.method, path: parts.path, body: parts.body, headers: headersFor(parts), nowMs: NOW, ...over })

describe("osbot request signatures", () => {
  it("match the shared test vector (bots/osbot/tests/test_signing.py)", () => {
    expect(sign(SECRET, parts)).toBe("c61401fbc027c286fbae5844b1862ffaf51c622fc43150d3e44d3ede3bdc469e")
  })

  it("accept a correctly signed request inside the window", () => {
    expect(verify()).toEqual({ ok: true })
    expect(verify({ nowMs: NOW + 60_000 })).toEqual({ ok: true })
    expect(verify({ nowMs: NOW - 60_000 })).toEqual({ ok: true })
  })

  it("refuse requests outside the 60 s window", () => {
    expect(verify({ nowMs: NOW + 61_000 })).toEqual({ ok: false, reason: "expired" })
    expect(verify({ nowMs: NOW - 61_000 })).toEqual({ ok: false, reason: "expired" })
  })

  it("refuse a tampered body, path, method or a different secret", () => {
    expect(verify({ body: parts.body.replace("milk", "beer") })).toEqual({ ok: false, reason: "bad_signature" })
    expect(verify({ path: "/api/internal/osbot/reminders/ack" })).toEqual({ ok: false, reason: "bad_signature" })
    expect(verify({ method: "GET" })).toEqual({ ok: false, reason: "bad_signature" })
    expect(verify({ secret: SECRET.replace("test", "prod") })).toEqual({ ok: false, reason: "bad_signature" })
  })

  it("refuse missing or malformed headers", () => {
    expect(verify({ headers: new Headers() })).toEqual({ ok: false, reason: "missing" })
    expect(verify({ headers: headersFor(parts, "not-hex") })).toEqual({ ok: false, reason: "malformed" })
    expect(verify({ headers: headersFor({ ...parts, nonce: "short" }) })).toEqual({ ok: false, reason: "malformed" })
    expect(verify({ headers: headersFor({ ...parts, timestamp: "1.5" }) })).toEqual({ ok: false, reason: "malformed" })
  })

  it("refuse everything while the secret is unset or too short", () => {
    expect(verify({ secret: undefined })).toEqual({ ok: false, reason: "not_configured" })
    expect(verify({ secret: "short" })).toEqual({ ok: false, reason: "not_configured" })
  })

  it("accept a signature only once", () => {
    const replay = new ReplayCache()
    expect(verify({ replay })).toEqual({ ok: true })
    expect(verify({ replay })).toEqual({ ok: false, reason: "replayed" })
    // A fresh nonce is a new request.
    const again = { ...parts, nonce: "0123456789abcdef0123456789" }
    expect(verify({ replay, headers: headersFor(again) })).toEqual({ ok: true })
  })

  it("signedHeaders produces headers verifyRequest accepts", () => {
    const headers = new Headers(signedHeaders(SECRET, { method: "GET", path: "/api/internal/osbot/today", body: "" }))
    expect(verifyRequest({ secret: SECRET, method: "GET", path: "/api/internal/osbot/today", body: "", headers })).toEqual({ ok: true })
  })
})

describe("ReplayCache", () => {
  it("forgets keys after they expire and stays bounded", () => {
    const cache = new ReplayCache(2)
    expect(cache.claim("a", 1_000, 0)).toBe(true)
    expect(cache.claim("a", 1_000, 500)).toBe(false)
    expect(cache.claim("a", 3_000, 1_000)).toBe(true) // expired, so claimable again
    expect(cache.claim("b", 3_000, 1_000)).toBe(true)
    expect(cache.claim("c", 3_000, 1_000)).toBe(true) // evicts the oldest live entry
    expect(cache.claim("a", 3_000, 1_000)).toBe(true)
  })
})
