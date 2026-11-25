import { describe, expect, it } from "vitest"
import {
  articleJsonLd,
  breadcrumbJsonLd,
  caseStudyJsonLd,
  jsonLdDocument,
  personJsonLd,
  personId,
  profileLinks,
  profilePageJsonLd,
  serializeJsonLd,
  websiteJsonLd,
} from "./json-ld"

const site = "https://anwar.example/"

describe("serializeJsonLd", () => {
  it("can't be closed early by owner text, and parses back to the same data", () => {
    const evil = `</script><script>alert(1)</script><!-- & \u2028 \u2029 "quotes"`
    const doc = jsonLdDocument([articleJsonLd({ siteUrl: site, url: `${site}writing/x`, headline: evil, datePublished: "2026-11-01T00:00:00.000Z", dateModified: "2026-11-02T00:00:00.000Z", description: evil })])
    const out = serializeJsonLd(doc)
    expect(out).not.toMatch(/[<>&\u2028\u2029]/)
    expect(out.toLowerCase()).not.toContain("</script")
    expect(JSON.parse(out)).toEqual(doc)
  })
})

describe("jsonLdDocument", () => {
  it("puts one node at the top level and several in an @graph, with the schema.org context", () => {
    const one = jsonLdDocument([breadcrumbJsonLd([{ name: "Home", url: site }])])
    expect(one["@context"]).toBe("https://schema.org")
    expect(one["@type"]).toBe("BreadcrumbList")
    const two = jsonLdDocument([websiteJsonLd({ siteUrl: site, name: "anwar.os", description: "d" }), personJsonLd({ siteUrl: site, name: "Anwar" })])
    expect(two["@context"]).toBe("https://schema.org")
    expect((two["@graph"] as unknown[]).length).toBe(2)
  })
})

describe("personJsonLd", () => {
  it("has the required fields, one stable @id and only web profiles in sameAs", () => {
    const person = personJsonLd({
      siteUrl: site,
      name: "Anwar Kairulla",
      jobTitle: "Web developer",
      location: "Prague, Czech Republic",
      sameAs: ["https://github.com/someone", "mailto:me@example.com", "tel:+420", "not a url", "", null, "https://github.com/someone"],
    })
    expect(person).toMatchObject({
      "@type": "Person",
      "@id": "https://anwar.example/#person",
      name: "Anwar Kairulla",
      url: "https://anwar.example/",
      jobTitle: "Web developer",
      homeLocation: { "@type": "Place", name: "Prague, Czech Republic" },
      sameAs: ["https://github.com/someone"],
    })
  })

  it("leaves out what isn't known instead of sending empty values", () => {
    const person = personJsonLd({ siteUrl: site, name: "Anwar", jobTitle: "", sameAs: ["mailto:x@y.z"] })
    expect(Object.keys(person).sort()).toEqual(["@id", "@type", "name", "url"])
  })
})

describe("websiteJsonLd and profilePageJsonLd", () => {
  it("link the site, its publisher and the profile's person by @id", () => {
    const website = websiteJsonLd({ siteUrl: site, name: "anwar.os", description: "Projects and writing" })
    expect(website).toMatchObject({ "@type": "WebSite", url: "https://anwar.example/", name: "anwar.os", publisher: { "@id": personId(site) } })
    const page = profilePageJsonLd({ siteUrl: site, url: `${site}cv`, person: personJsonLd({ siteUrl: site, name: "Anwar" }), dateModified: "2026-11-20T10:00:00.000Z" })
    expect(page).toMatchObject({ "@type": "ProfilePage", url: "https://anwar.example/cv", mainEntity: { "@type": "Person", name: "Anwar" } })
  })
})

describe("caseStudyJsonLd", () => {
  it("describes a project with name, url, image, dateModified and the owner as author", () => {
    const work = caseStudyJsonLd({
      siteUrl: site,
      url: "https://anwar.example/projects/shiftella",
      name: "Shiftella",
      description: "Shift planning for cafés",
      image: "https://anwar.example/case-studies/shiftella/cover.png",
      dateModified: "2026-11-24T12:00:00.000Z",
      keywords: ["Next.js", "Postgres"],
      liveUrl: "https://shiftella.example",
    })
    expect(work).toMatchObject({
      "@type": "CreativeWork",
      name: "Shiftella",
      url: "https://anwar.example/projects/shiftella",
      image: "https://anwar.example/case-studies/shiftella/cover.png",
      dateModified: "2026-11-24T12:00:00.000Z",
      author: { "@id": "https://anwar.example/#person" },
      keywords: "Next.js, Postgres",
      sameAs: ["https://shiftella.example/"],
    })
  })
})

describe("articleJsonLd", () => {
  it("has headline (at most 110 characters), dates, author and image", () => {
    const article = articleJsonLd({
      siteUrl: site,
      url: "https://anwar.example/writing/why",
      headline: "x".repeat(150),
      image: "https://anwar.example/writing/why/opengraph-image",
      datePublished: "2026-11-01T08:00:00.000Z",
      dateModified: "2026-11-03T08:00:00.000Z",
      wordCount: 420,
    })
    expect(article).toMatchObject({
      "@type": "BlogPosting",
      datePublished: "2026-11-01T08:00:00.000Z",
      dateModified: "2026-11-03T08:00:00.000Z",
      author: { "@id": "https://anwar.example/#person" },
      image: "https://anwar.example/writing/why/opengraph-image",
      wordCount: 420,
    })
    expect((article.headline as string).length).toBe(110)
  })
})

describe("breadcrumbJsonLd", () => {
  it("numbers the trail from 1", () => {
    expect(breadcrumbJsonLd([{ name: "Home", url: site }, { name: "Projects", url: `${site}projects` }])).toEqual({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: site },
        { "@type": "ListItem", position: 2, name: "Projects", item: `${site}projects` },
      ],
    })
  })
})

describe("profileLinks", () => {
  it("keeps http(s) URLs once, normalised", () => {
    expect(profileLinks(["https://LinkedIn.com/in/x", "https://linkedin.com/in/x", "javascript:alert(1)", undefined])).toEqual([
      "https://linkedin.com/in/x",
    ])
  })
})
