import { describe, expect, it } from "vitest"
import { noteJsonLd, noteMetadata } from "./seo"
import type { PublicNote } from "./schema"

const note: PublicNote = {
  id: "0f6a1c52-3a43-4d3e-8f55-2f6a6d0e9b21",
  title: "Why I self-host",
  slug: "why-i-self-host",
  excerpt: "",
  body: "One server, one domain. **Boring** and recoverable.",
  publishedAt: "2026-11-20T08:00:00.000Z",
  updatedAt: "2026-11-22T09:30:00.000Z",
}

describe("noteMetadata", () => {
  const meta = noteMetadata(note)

  it("has the title, a description from the body and a relative canonical", () => {
    expect(meta.title).toBe("Why I self-host")
    expect(meta.description).toBe("One server, one domain. Boring and recoverable.")
    expect(meta.alternates?.canonical).toBe("/writing/why-i-self-host")
  })

  it("shares as an article with its dates and a large card", () => {
    expect(meta.openGraph).toMatchObject({
      type: "article",
      url: "/writing/why-i-self-host",
      publishedTime: "2026-11-20T08:00:00.000Z",
      modifiedTime: "2026-11-22T09:30:00.000Z",
    })
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" })
  })

  it("prefers the excerpt the owner wrote", () => {
    expect(noteMetadata({ ...note, excerpt: "Short version." }).description).toBe("Short version.")
  })
})

describe("noteJsonLd", () => {
  it("is a BlogPosting with headline, dates, author, image and breadcrumbs", () => {
    const [post, crumbs] = noteJsonLd(note, "https://anwar.example")
    expect(post).toMatchObject({
      "@type": "BlogPosting",
      headline: "Why I self-host",
      url: "https://anwar.example/writing/why-i-self-host",
      datePublished: "2026-11-20T08:00:00.000Z",
      dateModified: "2026-11-22T09:30:00.000Z",
      author: { "@id": "https://anwar.example/#person" },
      image: "https://anwar.example/writing/why-i-self-host/opengraph-image",
      wordCount: 7,
    })
    expect(crumbs).toMatchObject({ "@type": "BreadcrumbList" })
  })
})
