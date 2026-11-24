import type { MetadataRoute } from "next"
import { connection } from "next/server"
import { absoluteUrl } from "@/lib/site"
import { TOOLS } from "@/modules/tools/catalog"
import { getPublishedNotes } from "@/modules/notes/public"
import { getPublishedProjects } from "@/modules/projects/public"

/**
 * Public pages plus every published case study and note. Request time (the build has no
 * database); the project read itself is cached and refreshed when the owner
 * edits a project.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection()
  const pages: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/cv"), changeFrequency: "monthly", priority: 0.9 },
    { url: absoluteUrl("/projects"), changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/writing"), changeFrequency: "weekly", priority: 0.7 },
    { url: absoluteUrl("/ideas"), changeFrequency: "weekly", priority: 0.6 },
    { url: absoluteUrl("/links"), changeFrequency: "weekly", priority: 0.5 },
    { url: absoluteUrl("/tools"), changeFrequency: "monthly", priority: 0.6 },
    ...TOOLS.map((t) => ({ url: absoluteUrl(`/tools/${t.slug}`), changeFrequency: "yearly" as const, priority: 0.5 })),
    { url: absoluteUrl("/feedback"), changeFrequency: "yearly", priority: 0.4 },
  ]
  // A database hiccup shouldn't take the static part of the sitemap down with it.
  const [projects, notes] = await Promise.all([
    getPublishedProjects().catch(() => []),
    getPublishedNotes().catch(() => []),
  ])
  return [
    ...pages,
    ...projects.map((p) => ({
      url: absoluteUrl(`/projects/${p.slug}`),
      lastModified: new Date(p.updatedAt),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...notes.map((n) => ({
      url: absoluteUrl(`/writing/${n.slug}`),
      lastModified: new Date(n.updatedAt),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ]
}
