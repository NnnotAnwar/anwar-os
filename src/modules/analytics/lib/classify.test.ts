import { describe, expect, it } from "vitest"
import { change, pageLabel, parseRange } from "../schema"
import { countryFrom, createLimiter, deviceClass, isBot, normalizePath, optedOut, referrerHost } from "./classify"

const chromeMac =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
const iphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1"
const pixel =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"
const ipad =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
const androidTablet =
  "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"

describe("isBot", () => {
  it("lets real browsers through", () => {
    for (const ua of [chromeMac, iphone, pixel, ipad]) expect(isBot(ua), ua).toBe(false)
  })

  it("drops crawlers, previews, headless browsers, HTTP libraries and empty agents", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0 Safari/537.36",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "TelegramBot (like TwitterBot)",
      "curl/8.7.1",
      "python-requests/2.32.3",
      "node",
      "",
      null,
    ]) {
      expect(isBot(ua), String(ua)).toBe(true)
    }
  })
})

describe("deviceClass", () => {
  it("tells phones, tablets and desktops apart", () => {
    expect(deviceClass(chromeMac)).toBe("desktop")
    expect(deviceClass(iphone)).toBe("mobile")
    expect(deviceClass(pixel)).toBe("mobile")
    expect(deviceClass(ipad)).toBe("tablet")
    expect(deviceClass(androidTablet)).toBe("tablet")
  })
})

describe("optedOut", () => {
  it("honours Do Not Track and Global Privacy Control", () => {
    expect(optedOut(new Headers({ dnt: "1" }))).toBe(true)
    expect(optedOut(new Headers({ "sec-gpc": "1" }))).toBe(true)
    expect(optedOut(new Headers({ dnt: "0" }))).toBe(false)
    expect(optedOut(new Headers())).toBe(false)
  })
})

describe("normalizePath", () => {
  const tools = ["calculator", "calories"]

  it("keeps known public routes, without query, hash or trailing slash", () => {
    expect(normalizePath("/", tools)).toBe("/")
    expect(normalizePath("/cv", tools)).toBe("/cv")
    expect(normalizePath("/writing/", tools)).toBe("/writing")
    expect(normalizePath("/contact", tools)).toBe("/contact")
    expect(normalizePath("/now", tools)).toBe("/now")
    expect(normalizePath("/projects/planuj-smeny?ref=x#top", tools)).toBe("/projects/planuj-smeny")
    expect(normalizePath("/writing/why-i-self-host", tools)).toBe("/writing/why-i-self-host")
    expect(normalizePath("/tools/calculator", tools)).toBe("/tools/calculator")
  })

  it("refuses everything else", () => {
    for (const path of [
      "/app",
      "/app/notes",
      "/login",
      "/api/a",
      "/tools/unknown",
      "/projects/Bad_Slug",
      "/writing/a/b",
      "/no-such-page",
      "//evil.com",
      "https://evil.com/cv",
      "/" + "a".repeat(300),
      42,
      null,
    ]) {
      expect(normalizePath(path, tools), String(path)).toBeNull()
    }
  })
})

describe("referrerHost", () => {
  const own = ["anwar.example"]

  it("keeps only the host of an external web referrer", () => {
    expect(referrerHost("https://news.ycombinator.com/item?id=1", own)).toBe("news.ycombinator.com")
    expect(referrerHost("https://www.Google.com/", own)).toBe("google.com")
  })

  it("treats internal, missing, non-web and malformed referrers as direct", () => {
    expect(referrerHost("https://anwar.example/projects", own)).toBe("")
    expect(referrerHost("https://www.anwar.example/", own)).toBe("")
    expect(referrerHost("", own)).toBe("")
    expect(referrerHost(undefined, own)).toBe("")
    expect(referrerHost("android-app://com.slack/", own)).toBe("")
    expect(referrerHost("http://localhost:3000/", own)).toBe("")
    expect(referrerHost("not a url", own)).toBe("")
  })
})

describe("countryFrom", () => {
  it("reads a two-letter code from an edge header, or nothing", () => {
    expect(countryFrom(new Headers({ "cf-ipcountry": "cz" }))).toBe("CZ")
    expect(countryFrom(new Headers({ "cf-ipcountry": "XX" }))).toBe("")
    expect(countryFrom(new Headers({ "x-country-code": "Czechia" }))).toBe("")
    expect(countryFrom(new Headers())).toBe("")
  })
})

describe("createLimiter", () => {
  it("allows max hits per window and key, then resets", () => {
    let t = 0
    const limiter = createLimiter({ max: 2, windowMs: 1000, now: () => t })
    expect([limiter.take("a"), limiter.take("a"), limiter.take("a")]).toEqual([true, true, false])
    expect(limiter.take("b")).toBe(true)
    t = 1000
    expect(limiter.take("a")).toBe(true)
  })
})

describe("dashboard helpers", () => {
  it("parses the range, falling back to 30 days", () => {
    expect(parseRange("7")).toBe(7)
    expect(parseRange("90")).toBe(90)
    expect(parseRange("365")).toBe(30)
    expect(parseRange(undefined)).toBe(30)
  })

  it("compares with the previous period", () => {
    expect(change(120, 100)).toBe(20)
    expect(change(50, 100)).toBe(-50)
    expect(change(5, 0)).toBeNull()
  })

  it("names pages", () => {
    expect(pageLabel("/")).toBe("Home")
    expect(pageLabel("/cv")).toBe("CV")
    expect(pageLabel("/writing")).toBe("Writing")
    expect(pageLabel("/projects/shiftella")).toBe("Projects · shiftella")
  })
})
