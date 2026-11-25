import type { Metadata } from "next"
import { articleJsonLd, breadcrumbJsonLd } from "@/lib/json-ld"
import { markdownToText } from "@/lib/markdown"
import { pageMetadata } from "@/lib/site"
import { summaryOf, type PublicNote } from "./schema"

// Search and sharing for a published note: the head (metadata) and the
// structured data. Pure, so both are unit tested.

export const notePath = (slug: string) => `/writing/${slug}`

export function noteDescription(note: PublicNote) {
  return summaryOf(note, 160) || `${note.title} — a note by Anwar.`
}

export function noteMetadata(note: PublicNote): Metadata {
  const meta = pageMetadata({
    title: note.title,
    description: noteDescription(note),
    path: notePath(note.slug),
    type: "article",
  })
  return {
    ...meta,
    openGraph: { ...meta.openGraph, type: "article", publishedTime: note.publishedAt, modifiedTime: note.updatedAt },
  }
}

/** BlogPosting + breadcrumbs. `siteUrl` is the runtime origin (request time). */
export function noteJsonLd(note: PublicNote, siteUrl: string) {
  const url = new URL(notePath(note.slug), siteUrl).toString()
  return [
    articleJsonLd({
      siteUrl,
      url,
      headline: note.title,
      description: noteDescription(note),
      // The note's own social card (title and date), drawn by opengraph-image.tsx.
      image: new URL(`${notePath(note.slug)}/opengraph-image`, siteUrl).toString(),
      datePublished: note.publishedAt,
      dateModified: note.updatedAt,
      wordCount: markdownToText(note.body).split(/\s+/).filter(Boolean).length,
    }),
    breadcrumbJsonLd([
      { name: "Home", url: new URL("/", siteUrl).toString() },
      { name: "Writing", url: new URL("/writing", siteUrl).toString() },
      { name: note.title, url },
    ]),
  ]
}
