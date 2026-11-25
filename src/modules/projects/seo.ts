import type { Metadata } from "next"
import { breadcrumbJsonLd, caseStudyJsonLd } from "@/lib/json-ld"
import { pageMetadata } from "@/lib/site"
import type { PublicProject } from "./schema"

// Search and sharing for a case study: the head (metadata) and the structured
// data. Pure, so both are unit tested.

export const projectPath = (slug: string) => `/projects/${slug}`

export function projectDescription(project: Pick<PublicProject, "title" | "summary">) {
  return project.summary || `${project.title} — a case study by Anwar.`
}

export function projectMetadata(project: PublicProject): Metadata {
  const meta = pageMetadata({
    title: project.title,
    description: projectDescription(project),
    path: projectPath(project.slug),
    type: "article",
  })
  return { ...meta, openGraph: { ...meta.openGraph, type: "article", modifiedTime: project.updatedAt } }
}

/** CreativeWork + breadcrumbs. `siteUrl` is the runtime origin (request time). */
export function projectJsonLd(project: PublicProject, siteUrl: string) {
  const url = new URL(projectPath(project.slug), siteUrl).toString()
  const image = project.coverUrl
    ? new URL(project.coverUrl, siteUrl).toString()
    : new URL(`${projectPath(project.slug)}/opengraph-image`, siteUrl).toString()
  return [
    caseStudyJsonLd({
      siteUrl,
      url,
      name: project.title,
      description: projectDescription(project),
      image,
      dateModified: project.updatedAt,
      keywords: project.stack,
      liveUrl: project.liveUrl,
    }),
    breadcrumbJsonLd([
      { name: "Home", url: new URL("/", siteUrl).toString() },
      { name: "Projects", url: new URL("/projects", siteUrl).toString() },
      { name: project.title, url },
    ]),
  ]
}
