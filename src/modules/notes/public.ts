import "server-only"
import { and, desc, eq } from "drizzle-orm"
import { cacheLife, cacheTag } from "next/cache"
import { asPublic } from "@/db"
import { notesNotes as n } from "@/db/schema"
import { PUBLIC_NOTES_TAG, type PublicNote } from "./schema"

// Reads for visitors (/writing, the feeds, the sitemap). No viewer, so RLS
// returns only the site owner's published notes. Cached across requests; every
// write that can change what's public (publish, unpublish, an edit of a
// published note, a delete) drops PUBLIC_NOTES_TAG in its server action.
// Render after `await connection()` (no database at build time).

const columns = {
  id: n.id,
  title: n.title,
  slug: n.slug,
  excerpt: n.excerpt,
  body: n.body,
  publishedAt: n.publishedAt,
  updatedAt: n.updatedAt,
}

type Row = {
  id: string
  title: string
  slug: string | null
  excerpt: string
  body: string
  publishedAt: Date | null
  updatedAt: Date
}

function toPublic(row: Row): PublicNote {
  return {
    id: row.id,
    title: row.title,
    // Both are guaranteed by notes_notes_published_complete while is_public.
    slug: row.slug ?? "",
    excerpt: row.excerpt,
    body: row.body,
    publishedAt: (row.publishedAt ?? row.updatedAt).toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Newest first. */
export async function getPublishedNotes(): Promise<PublicNote[]> {
  "use cache"
  cacheTag(PUBLIC_NOTES_TAG)
  cacheLife("days")
  const rows = await asPublic((tx) =>
    tx.select(columns).from(n).where(eq(n.isPublic, true)).orderBy(desc(n.publishedAt), desc(n.createdAt)),
  )
  return rows.map(toPublic)
}

export async function getPublishedNote(slug: string): Promise<PublicNote | null> {
  "use cache"
  cacheTag(PUBLIC_NOTES_TAG)
  cacheLife("days")
  const [row] = await asPublic((tx) =>
    tx
      .select(columns)
      .from(n)
      .where(and(eq(n.isPublic, true), eq(n.slug, slug)))
      .limit(1),
  )
  return row ? toPublic(row) : null
}
