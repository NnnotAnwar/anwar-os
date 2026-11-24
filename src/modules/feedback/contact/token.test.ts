import { describe, expect, it } from "vitest"
import { createToken, TOKEN, tokenKey, verifyToken } from "./token"

const key = tokenKey("x".repeat(40))
const T0 = 1_794_830_400_000

describe("contact form token", () => {
  it("is accepted once a person could have written something, with its nonce", () => {
    const token = createToken(key, T0)
    const verdict = verifyToken(token, key, T0 + 5_000)
    expect(verdict).toEqual({ ok: true, nonce: token.split(".")[0] })
  })

  it("refuses a send within 3 seconds of loading", () => {
    expect(verifyToken(createToken(key, T0), key, T0 + TOKEN.minAgeMs - 1)).toEqual({ ok: false, reason: "too_fast" })
  })

  it("expires after two hours, and refuses tokens from the future", () => {
    const token = createToken(key, T0)
    expect(verifyToken(token, key, T0 + TOKEN.ttlMs + 1)).toEqual({ ok: false, reason: "expired" })
    expect(verifyToken(token, key, T0 - 120_000)).toEqual({ ok: false, reason: "expired" })
  })

  it("refuses tokens it didn't sign or that were altered", () => {
    const token = createToken(key, T0)
    const [nonce, , signature] = token.split(".")
    expect(verifyToken(createToken(tokenKey("y".repeat(40)), T0), key, T0 + 5_000).ok).toBe(false)
    // An older timestamp to dodge the time check: the signature no longer matches.
    expect(verifyToken(`${nonce}.${T0 - 10_000}.${signature}`, key, T0 + 1_000)).toEqual({ ok: false, reason: "invalid" })
    expect(verifyToken("", key).ok).toBe(false)
    expect(verifyToken("not.a.token", key).ok).toBe(false)
  })

  it("uses a key of its own", () => {
    expect(tokenKey("s".repeat(40)).equals(tokenKey("s".repeat(40)))).toBe(true)
    expect(tokenKey("s".repeat(40)).equals(tokenKey("t".repeat(40)))).toBe(false)
  })
})
