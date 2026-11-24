import { describe, expect, it } from "vitest"
import { captureDay } from "./capture-day"

describe("captureDay", () => {
  const now = new Date("2026-11-24T09:00:00Z")

  it("is the day it was captured in the user's timezone, not the day it synced", () => {
    // 23:50 in Prague on the 23rd is 22:50 UTC; it reaches the server the next morning.
    expect(captureDay("2026-11-23T22:50:00Z", "Europe/Prague", now)).toBe("2026-11-23")
    // 00:10 on the 24th in Prague is still the 23rd in UTC.
    expect(captureDay("2026-11-23T23:10:00Z", "Europe/Prague", now)).toBe("2026-11-24")
    expect(captureDay("2026-11-23T23:10:00Z", "UTC", now)).toBe("2026-11-23")
  })

  it("never runs ahead of the server's today", () => {
    expect(captureDay("2027-01-01T10:00:00Z", "Europe/Prague", now)).toBe("2026-11-24")
    expect(captureDay("not a date", "Europe/Prague", now)).toBe("2026-11-24")
  })
})
