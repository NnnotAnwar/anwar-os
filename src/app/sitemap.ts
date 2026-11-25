import { statSync } from "node:fs"
import { join } from "node:path"
import type { MetadataRoute } from "next"
import { connection } from "next/server"
import { getSiteUrl } from "@/lib/site"
import { sitemapEntries } from "@/lib/sitemap"
import { getPublicCv } from "@/modules/cv/public"
import { cvUpdatedAt } from "@/modules/cv/seo"
import { getPublishedIdeas } from "@/modules/ideas/public"
import { listPublishedLinks } from "@/modules/links/public"
import { getPublishedNotes } from "@/modules/notes/public"
import { getNowPage } from "@/modules/now/public"
import { getPublishedProjects } from "@/modules/projects/public"
import { TOOLS } from "@/modules/tools/catalog"

/** When this build was made (.next/BUILD_ID is written once per build); undefined in dev. */
function deployedAt(): Date | undefined {
  try {
    return statSync(join(process.cwd(), ".next", "BUILD_ID")).mtime
  } catch {
    return undefined
  }
}

/**
 * Public pages plus every published case study and note, each with a lastmod
 * (src/lib/sitemap.ts decides what's listed). Request time (the build has no
 * database); the reads themselves are cached and dropped on the owner's edits.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection()
  // A database hiccup shouldn't take the static part of the sitemap down with it.
  const [projects, notes, ideas, links, cv, now] = await Promise.all([
    getPublishedProjects().catch(() => []),
    getPublishedNotes().catch(() => []),
    getPublishedIdeas().catch(() => []),
    listPublishedLinks().catch(() => []),
    getPublicCv().catch(() => null),
    getNowPage().catch(() => null),
  ])
  return sitemapEntries({
    origin: getSiteUrl().origin,
    projects,
    notes,
    ideas,
    links: links.map((l) => ({ updatedAt: l.updated_at })),
    toolSlugs: TOOLS.map((t) => t.slug),
    cvUpdatedAt: cvUpdatedAt(cv),
    nowUpdatedAt: now?.updatedAt,
    deployedAt: deployedAt(),
  })
}
