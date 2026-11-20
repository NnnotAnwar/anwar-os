import type { Metadata } from "next"

// Site identity for metadata, canonical URLs, the sitemap and social images.

export const siteName = "anwar.os"
export const siteTitle = "Anwar — economics student and web developer in Prague"
export const siteDescription =
  "Anwar studies Economics and Management at UCT Prague and builds web products. CV, projects, ideas and small tools."

/**
 * The public origin, e.g. https://anwar.example. Better Auth already needs it
 * (BETTER_AUTH_URL), so canonical URLs and the sitemap read the same value.
 */
export const siteUrl = new URL(process.env.BETTER_AUTH_URL?.trim() || "http://localhost:3000")

/** Absolute URL for a path on this site. */
export const absoluteUrl = (path: string) => new URL(path, siteUrl).toString()

/**
 * Metadata for one public page: title, description, canonical URL and the
 * matching Open Graph fields (a page's openGraph replaces the layout's, so the
 * shared ones are repeated here). The image comes from the nearest
 * opengraph-image file.
 */
export function pageMetadata({
  title,
  description,
  path,
  type = "website",
}: {
  /** null: the site title, unchanged by the "· Anwar" template. */
  title: string | null
  description: string
  path: string
  type?: "website" | "article" | "profile"
}): Metadata {
  return {
    title: title ?? { absolute: siteTitle },
    description,
    alternates: { canonical: absoluteUrl(path) },
    openGraph: {
      type,
      siteName,
      locale: "en_US",
      url: absoluteUrl(path),
      title: title ?? siteTitle,
      description,
    },
    twitter: { card: "summary_large_image", title: title ?? siteTitle, description },
  }
}
