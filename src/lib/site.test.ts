import { afterEach, describe, expect, it, vi } from "vitest"
import { absoluteUrl, getSiteUrl, pageMetadata, siteVerification } from "./site"

// The image is built with BETTER_AUTH_URL=http://localhost:3000 and gets the real
// origin at container start, so the origin must be read when asked, never at import.

afterEach(() => vi.unstubAllEnvs())

describe("getSiteUrl / absoluteUrl", () => {
  it("reads BETTER_AUTH_URL at call time, not at import", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://anwar.example")
    expect(getSiteUrl().origin).toBe("https://anwar.example")
    expect(absoluteUrl("/sitemap.xml")).toBe("https://anwar.example/sitemap.xml")
    vi.stubEnv("BETTER_AUTH_URL", " https://other.example/ ")
    expect(absoluteUrl("/cv")).toBe("https://other.example/cv")
  })

  it("falls back to localhost when unset", () => {
    expect(getSiteUrl({}).toString()).toBe("http://localhost:3000/")
  })
})

describe("siteVerification", () => {
  it("is nothing until a token is set", () => {
    expect(siteVerification({})).toBeUndefined()
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: "  " })).toBeUndefined()
  })

  it("maps Google and Bing tokens to their meta names", () => {
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: " abc123 " })).toEqual({ google: "abc123" })
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: "g", BING_SITE_VERIFICATION: "b" })).toEqual({
      google: "g",
      other: { "msvalidate.01": "b" },
    })
  })
})

describe("pageMetadata", () => {
  it("keeps canonical and og:url relative, for the runtime metadataBase", () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000")
    const meta = pageMetadata({ title: "CV", description: "d", path: "/cv" })
    expect(meta.alternates?.canonical).toBe("/cv")
    expect(meta.openGraph?.url).toBe("/cv")
  })
})
