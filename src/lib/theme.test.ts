import { afterEach, describe, expect, it, vi } from "vitest"
import { findCity, parseCoordinates } from "./cities"
import {
  DEFAULT_THEME,
  decodeThemeCookie,
  encodeThemeCookie,
  evaluateTheme,
  themeScript,
  type ThemeConfig,
} from "./theme"

const prague = { lat: 50.1, lon: 14.4 }
const tromso = { lat: 69.6, lon: 19 }
const sun = (place: { lat: number; lon: number }): ThemeConfig => ({ ...DEFAULT_THEME, mode: "scheduled", schedule: "sun", ...place })
const hours = (from: string, until: string): ThemeConfig => ({ ...DEFAULT_THEME, mode: "scheduled", schedule: "hours", from, until })
const utc = (iso: string) => Date.parse(iso)

describe("evaluateTheme", () => {
  it("follows the system, or a fixed choice", () => {
    expect(evaluateTheme(null, 0, true).dark).toBe(true)
    expect(evaluateTheme({ ...DEFAULT_THEME, mode: "system" }, 0, false).dark).toBe(false)
    expect(evaluateTheme({ ...DEFAULT_THEME, mode: "dark" }, 0, false).dark).toBe(true)
    expect(evaluateTheme({ ...DEFAULT_THEME, mode: "light" }, 0, true).dark).toBe(false)
  })

  describe("fixed hours (local time)", () => {
    afterEach(() => vi.useRealTimers())
    const at = (h: number, m = 0) => new Date(2026, 10, 24, h, m).getTime()

    it("crosses midnight", () => {
      const c = hours("20:00", "07:00")
      expect(evaluateTheme(c, at(19, 59), false).dark).toBe(false)
      expect(evaluateTheme(c, at(20, 0), false).dark).toBe(true)
      expect(evaluateTheme(c, at(23, 30), false).dark).toBe(true)
      expect(evaluateTheme(c, at(3, 0), false).dark).toBe(true)
      expect(evaluateTheme(c, at(6, 59), false).dark).toBe(true)
      expect(evaluateTheme(c, at(7, 0), false).dark).toBe(false)
      expect(evaluateTheme(c, at(12, 0), true).dark).toBe(false)
    })

    it("works within one day, and an empty window is never dark", () => {
      expect(evaluateTheme(hours("13:00", "14:30"), at(14, 0), false).dark).toBe(true)
      expect(evaluateTheme(hours("13:00", "14:30"), at(14, 30), false).dark).toBe(false)
      expect(evaluateTheme(hours("09:00", "09:00"), at(9, 0), true).dark).toBe(false)
    })
  })

  describe("sunset to sunrise", () => {
    it("Prague in midsummer: sunrise ≈ 02:52 UTC, sunset ≈ 19:14 UTC", () => {
      const s = evaluateTheme(sun(prague), utc("2026-06-21T12:00:00Z"), true)
      expect(s.dark).toBe(false)
      expect(Math.abs(s.rise! - utc("2026-06-21T02:52:00Z"))).toBeLessThan(6 * 60_000)
      expect(Math.abs(s.set! - utc("2026-06-21T19:14:00Z"))).toBeLessThan(6 * 60_000)
      expect(evaluateTheme(sun(prague), utc("2026-06-21T02:30:00Z"), false).dark).toBe(true)
      expect(evaluateTheme(sun(prague), utc("2026-06-21T03:15:00Z"), true).dark).toBe(false)
      expect(evaluateTheme(sun(prague), utc("2026-06-21T19:40:00Z"), false).dark).toBe(true)
      expect(evaluateTheme(sun(prague), utc("2026-06-21T23:59:00Z"), false).dark).toBe(true)
    })

    it("Prague in midwinter: dark by 15:15 UTC, light by 07:15 UTC", () => {
      const s = evaluateTheme(sun(prague), utc("2026-12-21T12:00:00Z"), true)
      expect(Math.abs(s.rise! - utc("2026-12-21T07:00:00Z"))).toBeLessThan(6 * 60_000)
      expect(Math.abs(s.set! - utc("2026-12-21T15:01:00Z"))).toBeLessThan(6 * 60_000)
      expect(evaluateTheme(sun(prague), utc("2026-12-21T15:15:00Z"), false).dark).toBe(true)
      expect(evaluateTheme(sun(prague), utc("2026-12-21T07:15:00Z"), true).dark).toBe(false)
    })

    it("works far from Greenwich (Tokyo, Los Angeles)", () => {
      // Tokyo, 24 Nov: sunrise ≈ 06:22 JST (21:22 UTC the day before), sunset ≈ 16:30 JST.
      const tokyo = sun({ lat: 35.7, lon: 139.7 })
      expect(evaluateTheme(tokyo, utc("2026-11-24T03:00:00Z"), true).dark).toBe(false)
      expect(evaluateTheme(tokyo, utc("2026-11-24T08:00:00Z"), false).dark).toBe(true)
      expect(evaluateTheme(tokyo, utc("2026-11-23T21:00:00Z"), false).dark).toBe(true)
      expect(evaluateTheme(tokyo, utc("2026-11-23T21:45:00Z"), true).dark).toBe(false)
      // Los Angeles, 24 Nov: sunrise ≈ 06:37 PST (14:37 UTC), sunset ≈ 16:46 PST (00:46 UTC next day).
      const la = sun({ lat: 34.1, lon: -118.2 })
      expect(evaluateTheme(la, utc("2026-11-25T00:30:00Z"), false).dark).toBe(false)
      expect(evaluateTheme(la, utc("2026-11-25T01:15:00Z"), false).dark).toBe(true)
      expect(evaluateTheme(la, utc("2026-11-24T14:15:00Z"), false).dark).toBe(true)
      expect(evaluateTheme(la, utc("2026-11-24T15:00:00Z"), true).dark).toBe(false)
    })

    it("handles polar night and midnight sun", () => {
      expect(evaluateTheme(sun(tromso), utc("2026-12-21T11:00:00Z"), false)).toMatchObject({ dark: true, polar: "night" })
      expect(evaluateTheme(sun(tromso), utc("2026-06-21T23:00:00Z"), true)).toMatchObject({ dark: false, polar: "day" })
    })
  })
})

describe("theme cookie", () => {
  it("round-trips", () => {
    for (const c of [DEFAULT_THEME, sun(prague), hours("21:30", "06:15"), { ...DEFAULT_THEME, mode: "dark" as const }]) {
      expect(decodeThemeCookie(encodeThemeCookie(c))).toEqual(c)
    }
  })

  it("rejects anything unexpected", () => {
    for (const bad of [
      undefined,
      "",
      "dark",
      "sepia|hours|20:00|07:00||",
      "dark|hours|24:00|07:00||",
      "dark|hours|20:00|07:00|91|10",
      "dark|hours|20:00|07:00|50|",
      "scheduled|sun|20:00|07:00||",
      "dark|hours|20:00|07:00|||extra",
      "x".repeat(200),
    ]) {
      expect(decodeThemeCookie(bad)).toBeNull()
    }
  })
})

describe("themeScript", () => {
  function run(config: ThemeConfig | null, now: number, systemDark: boolean) {
    const classes = new Set<string>(["dark"])
    const html = {
      classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
      style: { colorScheme: "" },
    }
    const fakeWindow = { matchMedia: () => ({ matches: systemDark }) }
    const fakeDate = { now: () => now }
    new Function("window", "document", "Date", themeScript(config))(fakeWindow, { documentElement: html }, fakeDate)
    return { classes: [...classes], colorScheme: html.style.colorScheme }
  }

  it("is self-contained and sets the class and color-scheme", () => {
    expect(run(null, 0, false)).toEqual({ classes: ["light"], colorScheme: "light" })
    expect(run({ ...DEFAULT_THEME, mode: "dark" }, 0, false)).toEqual({ classes: ["dark"], colorScheme: "dark" })
    expect(run(sun(prague), utc("2026-12-21T20:00:00Z"), false)).toEqual({ classes: ["dark"], colorScheme: "dark" })
  })

  it("can't be broken out of by the config", () => {
    expect(themeScript(null)).not.toContain("</script")
  })
})

describe("places", () => {
  it("finds a built-in city regardless of case and accents", () => {
    expect(findCity("plzen")).toMatchObject({ name: "Plzeň" })
    expect(findCity("  ALMATY ")).toMatchObject({ lat: 43.2, lon: 76.9 })
    expect(findCity("Atlantis")).toBeUndefined()
    expect(findCity("")).toBeUndefined()
  })

  it("reads typed coordinates", () => {
    expect(parseCoordinates("50.08, 14.43")).toEqual({ lat: 50.08, lon: 14.43 })
    expect(parseCoordinates("-33.9 151.2")).toEqual({ lat: -33.9, lon: 151.2 })
    expect(parseCoordinates("95, 10")).toBeNull()
    expect(parseCoordinates("Prague")).toBeNull()
  })
})
