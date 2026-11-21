import { describe, expect, it } from "vitest"
import { clientIp, retryMessage } from "./rate-limit"

describe("clientIp", () => {
  it("takes the address the nearest proxy appended", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7")
    // A client-sent value can't push its way in front of the proxy's entry.
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe("203.0.113.7")
  })

  it("falls back to X-Real-IP, then one shared bucket", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.1" }))).toBe("198.51.100.1")
    expect(clientIp(new Headers())).toBe("unknown")
  })
})

describe("retryMessage", () => {
  it("rounds up to whole minutes", () => {
    expect(retryMessage(30)).toBe("Too many attempts. Try again in 1 minute.")
    expect(retryMessage(601)).toBe("Too many attempts. Try again in 11 minutes.")
    expect(retryMessage(null)).toBe("Too many attempts. Try again in 1 minute.")
  })
})
