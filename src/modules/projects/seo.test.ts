import { describe, expect, it } from "vitest"
import { projectJsonLd, projectMetadata } from "./seo"
import type { PublicProject } from "./schema"

const project: PublicProject = {
  id: "8d2c5d0e-5b5f-4a51-9a39-0f1e5b8f1a11",
  title: "Shiftella",
  slug: "shiftella",
  summary: "Shift planning for cafés and shops.",
  body: "## Problem\n…",
  status: "live",
  role: "Founder, full-stack",
  stack: ["Next.js", "Supabase"],
  liveUrl: "https://shiftella.example",
  repoUrl: null,
  demoUrl: null,
  coverUrl: "/case-studies/shiftella/cover.png",
  featured: true,
  updatedAt: "2026-11-24T12:00:00.000Z",
}

describe("projectMetadata", () => {
  const meta = projectMetadata(project)

  it("has the title, the summary as description and a relative canonical", () => {
    expect(meta.title).toBe("Shiftella")
    expect(meta.description).toBe("Shift planning for cafés and shops.")
    expect(meta.alternates?.canonical).toBe("/projects/shiftella")
  })

  it("shares as an article with a large card", () => {
    expect(meta.openGraph).toMatchObject({
      type: "article",
      url: "/projects/shiftella",
      title: "Shiftella · Anwar",
      modifiedTime: "2026-11-24T12:00:00.000Z",
    })
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", title: "Shiftella · Anwar" })
  })

  it("writes a description when the project has no summary", () => {
    expect(projectMetadata({ ...project, summary: "" }).description).toBe("Shiftella — a case study by Anwar.")
  })
})

describe("projectJsonLd", () => {
  it("is a CreativeWork with an absolute cover and breadcrumbs back to the projects", () => {
    const [work, crumbs] = projectJsonLd(project, "https://anwar.example/")
    expect(work).toMatchObject({
      "@type": "CreativeWork",
      name: "Shiftella",
      url: "https://anwar.example/projects/shiftella",
      image: "https://anwar.example/case-studies/shiftella/cover.png",
      dateModified: "2026-11-24T12:00:00.000Z",
      author: { "@id": "https://anwar.example/#person" },
    })
    expect(crumbs).toMatchObject({ "@type": "BreadcrumbList" })
    expect((crumbs!.itemListElement as { item: string }[]).map((i) => i.item)).toEqual([
      "https://anwar.example/",
      "https://anwar.example/projects",
      "https://anwar.example/projects/shiftella",
    ])
  })

  it("uses the generated social card when there's no cover", () => {
    const [work] = projectJsonLd({ ...project, coverUrl: null }, "https://anwar.example/")
    expect(work!.image).toBe("https://anwar.example/projects/shiftella/opengraph-image")
  })
})
