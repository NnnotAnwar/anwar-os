import type { MetadataRoute } from "next"

// The sitemap's contents, from data the route reads (src/app/sitemap.ts). Pure,
// so what may and may not be listed is unit tested: public pages only, every
// one with a lastmod.

type Dated = { updatedAt: string }

export type SitemapInput = {
  /** The runtime origin, e.g. https://anwar-os.com. */
  origin: string
  projects: readonly (Dated & { slug: string })[]
  notes: readonly (Dated & { slug: string })[]
  ideas: readonly Dated[]
  links: readonly Dated[]
  toolSlugs: readonly string[]
  cvUpdatedAt?: string | null
  nowUpdatedAt?: string | null
  /**
   * When this build went live: the last-change date of pages that only change
   * with the code (tools, forms), and of sections with nothing published yet.
   */
  deployedAt?: Date | null
}

/** The newest of the dates (ISO strings or Dates); undefined when none is valid. */
export function newest(dates: readonly (string | Date | null | undefined)[]): Date | undefined {
  let best: number | undefined
  for (const d of dates) {
    if (!d) continue
    const t = d instanceof Date ? d.getTime() : Date.parse(d)
    if (Number.isFinite(t) && (best === undefined || t > best)) best = t
  }
  return best === undefined ? undefined : new Date(best)
}

export function sitemapEntries(input: SitemapInput): MetadataRoute.Sitemap {
  const url = (path: string) => new URL(path, input.origin).toString()
  // Content pages date from their content; the deploy only stands in when
  // there's none (and for pages that change with the code alone).
  const orDeployed = (d: Date | undefined) => d ?? input.deployedAt ?? undefined
  const projectsAt = newest(input.projects.map((p) => p.updatedAt))
  const notesAt = newest(input.notes.map((n) => n.updatedAt))
  const ideasAt = newest(input.ideas.map((i) => i.updatedAt))
  const linksAt = newest(input.links.map((l) => l.updatedAt))

  const pages: MetadataRoute.Sitemap = [
    // The landing shows featured projects and the latest ideas.
    { url: url("/"), lastModified: orDeployed(newest([projectsAt, ideasAt])), changeFrequency: "weekly", priority: 1 },
    { url: url("/cv"), lastModified: orDeployed(newest([input.cvUpdatedAt])), changeFrequency: "monthly", priority: 0.9 },
    { url: url("/now"), lastModified: orDeployed(newest([input.nowUpdatedAt])), changeFrequency: "weekly", priority: 0.7 },
    { url: url("/projects"), lastModified: orDeployed(projectsAt), changeFrequency: "weekly", priority: 0.9 },
    { url: url("/writing"), lastModified: orDeployed(notesAt), changeFrequency: "weekly", priority: 0.7 },
    { url: url("/ideas"), lastModified: orDeployed(ideasAt), changeFrequency: "weekly", priority: 0.6 },
    { url: url("/links"), lastModified: orDeployed(linksAt), changeFrequency: "weekly", priority: 0.5 },
    { url: url("/tools"), lastModified: orDeployed(undefined), changeFrequency: "monthly", priority: 0.6 },
    ...input.toolSlugs.map((slug) => ({
      url: url(`/tools/${slug}`),
      lastModified: orDeployed(undefined),
      changeFrequency: "yearly" as const,
      priority: 0.5,
    })),
    { url: url("/feedback"), lastModified: orDeployed(undefined), changeFrequency: "yearly", priority: 0.4 },
    { url: url("/contact"), lastModified: orDeployed(undefined), changeFrequency: "yearly", priority: 0.6 },
  ]
  return [
    ...pages,
    ...input.projects.map((p) => ({
      url: url(`/projects/${p.slug}`),
      lastModified: new Date(p.updatedAt),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...input.notes.map((n) => ({
      url: url(`/writing/${n.slug}`),
      lastModified: new Date(n.updatedAt),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ]
}
