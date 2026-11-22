import type { Metadata } from "next"

// Site identity for metadata, canonical URLs, the sitemap and social images.

export const siteName = "anwar.os"
export const siteTitle = "Anwar — economics student and web developer in Prague"
export const siteDescription =
  "Anwar studies Economics and Management at UCT Prague and builds web products. CV, projects, ideas and small tools."

/**
 * The public origin, e.g. https://anwar.example. Better Auth already needs it
 * (BETTER_AUTH_URL), so canonical URLs and the sitemap read the same value.
 *
 * Read at call time, and call it only at request time (after `connection()` or
 * another runtime read): the image is built without runtime env, where this is
 * the http://localhost:3000 placeholder, and anything prerendered with it keeps
 * that origin (robots.txt shipped "Sitemap: http://localhost:3000/sitemap.xml").
 */
export function getSiteUrl(env: Record<string, string | undefined> = process.env) {
  return new URL(env.BETTER_AUTH_URL?.trim() || "http://localhost:3000")
}

/** Absolute URL for a path on this site. Request time only, see getSiteUrl. */
export const absoluteUrl = (path: string) => new URL(path, getSiteUrl()).toString()

/**
 * Metadata for one public page: title, description, canonical URL and the
 * matching Open Graph fields (a page's openGraph replaces the layout's, so the
 * shared ones are repeated here). The image comes from the nearest
 * opengraph-image file.
 *
 * URLs stay relative: Next resolves them against the public layout's
 * metadataBase, computed per request. Absolute URLs built here would be frozen
 * into the prerendered segments with the build's placeholder origin.
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
  // Shared cards carry the same "· Anwar" suffix the tab title gets from the template.
  const social = title ? `${title} · Anwar` : siteTitle
  return {
    title: title ?? { absolute: siteTitle },
    description,
    alternates: { canonical: path },
    openGraph: { type, siteName, locale: "en_US", url: path, title: social, description },
    twitter: { card: "summary_large_image", title: social, description },
  }
}
