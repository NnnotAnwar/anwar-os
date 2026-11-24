import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { expiryDate, tokenExpiryOptions } from "./options"
import { bearerToken, canWrite, generateToken, hashToken, isTokenFormat, scopesFor, tokenPrefix } from "./token"

describe("API tokens", () => {
  it("generates aos_ tokens of 48 base62 characters, all different", () => {
    const tokens = Array.from({ length: 200 }, generateToken)
    for (const token of tokens) {
      expect(token).toMatch(/^aos_[A-Za-z0-9]{48}$/)
      expect(isTokenFormat(token)).toBe(true)
    }
    expect(new Set(tokens).size).toBe(tokens.length)
    expect(new Set(tokens.map(tokenPrefix)).size).toBe(tokens.length)
  })

  it("uses the whole base62 alphabet (no modulo bias towards a few characters)", () => {
    const counts = new Map<string, number>()
    for (let i = 0; i < 400; i++) for (const c of generateToken().slice(4)) counts.set(c, (counts.get(c) ?? 0) + 1)
    expect(counts.size).toBe(62)
    // 19,200 characters / 62 ≈ 310 each; a skewed generator would show up far outside this band.
    for (const n of counts.values()) expect(n).toBeGreaterThan(200)
  })

  it("keeps a 12-character prefix for lookup and display", () => {
    const token = "aos_AbCd1234" + "x".repeat(40)
    expect(tokenPrefix(token)).toBe("aos_AbCd1234")
  })

  it("stores SHA-256 hex of the whole token, never the token", () => {
    const token = generateToken()
    const hash = hashToken(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"))
    expect(hash).not.toContain(token.slice(4, 12))
    expect(hashToken(`${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`)).not.toBe(hash)
  })

  it("reads only well-formed Bearer headers", () => {
    const token = generateToken()
    expect(bearerToken(`Bearer ${token}`)).toBe(token)
    expect(bearerToken(`bearer  ${token} `)).toBe(token)
    expect(bearerToken(null)).toBeNull()
    expect(bearerToken("")).toBeNull()
    expect(bearerToken(token)).toBeNull()
    expect(bearerToken(`Basic ${token}`)).toBeNull()
    expect(bearerToken(`Bearer ${token.slice(0, -1)}`)).toBeNull()
    expect(bearerToken(`Bearer ${token}x`)).toBeNull()
    expect(bearerToken(`Bearer ${token} extra`)).toBeNull()
    expect(bearerToken("Bearer sk-not-ours")).toBeNull()
  })

  it("gives read always and write only on request", () => {
    expect(scopesFor(false)).toEqual(["read"])
    expect(scopesFor(true)).toEqual(["read", "write"])
    expect(canWrite(["read"])).toBe(false)
    expect(canWrite(["read", "write"])).toBe(true)
    expect(canWrite([])).toBe(false)
  })

  it("turns an expiry choice into a date", () => {
    const now = new Date("2026-11-24T10:00:00Z")
    expect(expiryDate("30", now)?.toISOString()).toBe("2026-12-24T10:00:00.000Z")
    expect(expiryDate("365", now)?.toISOString()).toBe("2027-11-24T10:00:00.000Z")
    expect(expiryDate("never", now)).toBeNull()
    expect(() => expiryDate("forever", now)).toThrow()
    expect(tokenExpiryOptions.map((o) => o.id)).toContain("90")
  })
})
