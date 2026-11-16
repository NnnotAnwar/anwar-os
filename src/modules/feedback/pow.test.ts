import { describe, expect, it } from "vitest"
import { clientIp, createChallenge, deriveKey, hashIp, POW, verifySolution, type Solution } from "./pow"
import { solveChallenge } from "./pow-solver"

const key = deriveKey("test-secret-0123456789abcdef0123456789", "pow")
const t0 = 1_800_000_000_000

async function solved(maxNumber = 2_000, now = t0): Promise<Solution> {
  const { algorithm, challenge, salt, signature } = createChallenge(key, now, maxNumber)
  const number = await solveChallenge({ challenge, salt, maxNumber })
  expect(number).not.toBeNull()
  return { algorithm, challenge, salt, signature, number: number! }
}

describe("proof of work", () => {
  it("round-trips: the browser solver finds what the server hid", async () => {
    const solution = await solved()
    expect(verifySolution(solution, key, t0 + 5_000)).toEqual({ ok: true })
  })

  it("solves a full-size challenge in reasonable time", async () => {
    const started = Date.now()
    const c = createChallenge(key, t0)
    expect(c.maxNumber).toBe(POW.maxNumber)
    const n = await solveChallenge(c)
    expect(n).not.toBeNull()
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it("refuses submissions faster than a person could type", async () => {
    const solution = await solved()
    expect(verifySolution(solution, key, t0 + 1_000)).toEqual({ ok: false, reason: "too_fast" })
  })

  it("refuses expired challenges", async () => {
    const solution = await solved()
    expect(verifySolution(solution, key, t0 + POW.ttlMs + 1)).toEqual({ ok: false, reason: "expired" })
  })

  it("refuses a wrong number", async () => {
    const solution = await solved()
    expect(verifySolution({ ...solution, number: solution.number + 1 }, key, t0 + 5_000).ok).toBe(false)
  })

  it("refuses a challenge signed with another key", async () => {
    const solution = await solved()
    const other = deriveKey("another-secret-0123456789abcdef01234", "pow")
    expect(verifySolution(solution, other, t0 + 5_000)).toEqual({ ok: false, reason: "invalid" })
  })

  it("refuses a tampered salt (e.g. a pushed-out expiry)", async () => {
    const solution = await solved()
    const [rand, issued] = solution.salt.split(".")
    const salt = `${rand}.${issued}.${t0 + 10 * POW.ttlMs}`
    expect(verifySolution({ ...solution, salt }, key, t0 + 5_000)).toEqual({ ok: false, reason: "invalid" })
  })

  it("refuses a self-made challenge without our signature", async () => {
    const solution = await solved()
    expect(verifySolution({ ...solution, signature: "0".repeat(64) }, key, t0 + 5_000).ok).toBe(false)
    expect(verifySolution({ ...solution, signature: "zz" }, key, t0 + 5_000).ok).toBe(false)
  })

  it("refuses out-of-range numbers and other algorithms", async () => {
    const solution = await solved()
    expect(verifySolution({ ...solution, number: -1 }, key, t0 + 5_000).ok).toBe(false)
    expect(verifySolution({ ...solution, number: 1.5 }, key, t0 + 5_000).ok).toBe(false)
    expect(
      verifySolution({ ...solution, algorithm: "SHA-1" as "SHA-256" }, key, t0 + 5_000).ok,
    ).toBe(false)
  })

  it("stops when aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await solveChallenge(createChallenge(key, t0), controller.signal)).toBeNull()
  })
})

describe("deriveKey", () => {
  it("gives different keys per purpose", () => {
    const secret = "s".repeat(40)
    expect(deriveKey(secret, "pow").equals(deriveKey(secret, "ip"))).toBe(false)
  })
})

describe("clientIp", () => {
  const h = (init: Record<string, string>) => new Headers(init)

  it("trusts only the right-most X-Forwarded-For entry (the one our proxy added)", () => {
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe("203.0.113.7")
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.2" }))).toBe("198.51.100.2")
  })

  it("falls back to X-Real-IP, then to a shared bucket", () => {
    expect(clientIp(h({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9")
    expect(clientIp(h({}))).toBe("unknown")
    expect(clientIp(h({ "x-forwarded-for": " , " }))).toBe("unknown")
  })
})

describe("hashIp", () => {
  const ipKey = deriveKey("s".repeat(40), "ip")

  it("is a stable 64-character hex digest that never contains the IP", () => {
    const hash = hashIp("203.0.113.7", ipKey)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashIp("203.0.113.7", ipKey)).toBe(hash)
    expect(hash).not.toContain("203")
  })

  it("differs per IP and per key", () => {
    expect(hashIp("203.0.113.7", ipKey)).not.toBe(hashIp("203.0.113.8", ipKey))
    expect(hashIp("203.0.113.7", ipKey)).not.toBe(hashIp("203.0.113.7", deriveKey("t".repeat(40), "ip")))
  })
})
