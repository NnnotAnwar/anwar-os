import { describe, expect, it } from "vitest"
import { newest, sitemapEntries, type SitemapInput } from "./sitemap"

const deployed = new Date("2026-11-20T09:00:00.000Z")

const input: SitemapInput = {
  origin: "https://anwar.example",
  projects: [
    { slug: "shiftella", updatedAt: "2026-11-24T12:00:00.000Z" },
    { slug: "anwar-os", updatedAt: "2026-11-10T12:00:00.000Z" },
  ],
  notes: [{ slug: "why-i-self-host", updatedAt: "2026-11-22T08:00:00.000Z" }],
  ideas: [{ updatedAt: "2026-11-23T08:00:00.000Z" }],
  links: [{ updatedAt: "2026-10-01T08:00:00.000Z" }],
  toolSlugs: ["calories", "calculator"],
  cvUpdatedAt: "2026-11-18T08:00:00.000Z",
  nowUpdatedAt: "2026-11-25T07:00:00.000Z",
  deployedAt: deployed,
}

const paths = (entries: { url: string }[]) => entries.map((e) => new URL(e.url).pathname)

describe("sitemapEntries", () => {
  const entries = sitemapEntries(input)

  it("lists every public page and every published case study and note, on the one origin", () => {
    expect(paths(entries)).toEqual([
      "/",
      "/cv",
      "/now",
      "/projects",
      "/writing",
      "/ideas",
      "/links",
      "/tools",
      "/tools/calories",
      "/tools/calculator",
      "/feedback",
      "/contact",
      "/projects/shiftella",
      "/projects/anwar-os",
      "/writing/why-i-self-host",
    ])
    for (const e of entries) expect(new URL(e.url).origin).toBe("https://anwar.example")
  })

  it("never lists private, sign-in, API or confirmation paths, and no trailing-slash twins", () => {
    for (const path of paths(entries)) {
      expect(path).not.toMatch(/^\/(app|api|login)(\/|$)/)
      expect(path).not.toBe("/contact/sent")
      if (path !== "/") expect(path.endsWith("/")).toBe(false)
    }
    expect(new Set(paths(entries)).size).toBe(entries.length)
  })

  it("gives every entry a lastmod: content dates for content, the deploy for code-only pages", () => {
    for (const e of entries) expect(e.lastModified, e.url).toBeInstanceOf(Date)
    const at = (path: string) => (entries.find((e) => new URL(e.url).pathname === path)!.lastModified as Date).toISOString()
    expect(at("/")).toBe("2026-11-24T12:00:00.000Z")
    expect(at("/projects")).toBe("2026-11-24T12:00:00.000Z")
    expect(at("/writing")).toBe("2026-11-22T08:00:00.000Z")
    expect(at("/ideas")).toBe("2026-11-23T08:00:00.000Z")
    expect(at("/links")).toBe("2026-10-01T08:00:00.000Z")
    expect(at("/cv")).toBe("2026-11-18T08:00:00.000Z")
    expect(at("/now")).toBe("2026-11-25T07:00:00.000Z")
    expect(at("/projects/anwar-os")).toBe("2026-11-10T12:00:00.000Z")
    expect(at("/tools/calories")).toBe(deployed.toISOString())
    expect(at("/contact")).toBe(deployed.toISOString())
  })

  it("falls back to the deploy for sections with nothing published", () => {
    const empty = sitemapEntries({ ...input, projects: [], notes: [], ideas: [], links: [], cvUpdatedAt: null, nowUpdatedAt: null })
    for (const e of empty) expect((e.lastModified as Date).toISOString(), e.url).toBe(deployed.toISOString())
  })
})

describe("newest", () => {
  it("picks the latest valid date and ignores junk", () => {
    expect(newest(["2026-01-01T00:00:00Z", null, "nope", new Date("2026-02-01T00:00:00Z")])?.toISOString()).toBe(
      "2026-02-01T00:00:00.000Z",
    )
    expect(newest([undefined, ""])).toBeUndefined()
  })
})
