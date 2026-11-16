import "server-only"
import { and, arrayContains, desc, eq, ilike, or, sql } from "drizzle-orm"
import { asViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import { linksLinks } from "@/db/schema"
import { likeContains } from "@/lib/sql-like"
import { fetchPageMetadata } from "./fetch-metadata"
import type { PageMetadata } from "./html-meta"
import {
  createLinkInput,
  fallbackTitle,
  linkIdInput,
  listLinksInput,
  noInput,
  restoreLinkInput,
  setLinkFlagsInput,
  updateLinkInput,
  type Link,
} from "./schema"

export const columns = {
  id: linksLinks.id,
  url: linksLinks.url,
  title: linksLinks.title,
  description: linksLinks.description,
  siteName: linksLinks.siteName,
  faviconUrl: linksLinks.faviconUrl,
  tags: linksLinks.tags,
  note: linksLinks.note,
  isPublic: linksLinks.isPublic,
  readLater: linksLinks.readLater,
  createdAt: linksLinks.createdAt,
  updatedAt: linksLinks.updatedAt,
}

type Row = Pick<typeof linksLinks.$inferSelect, keyof typeof columns>

export function toLink(row: Row): Link {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    site_name: row.siteName,
    favicon_url: row.faviconUrl,
    tags: row.tags,
    note: row.note,
    is_public: row.isPublic,
    read_later: row.readLater,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

// The "read published" policy lets everyone see the site owner's public links,
// so private queries must also say "only mine".
const mine = eq(linksLinks.ownerId, sql`app.current_user_id()`)

/** Best effort: a page that's slow, private or broken still gets saved. */
async function metadataFor(url: string): Promise<PageMetadata | null> {
  try {
    return await fetchPageMetadata(url)
  } catch {
    return null
  }
}

function isUniqueViolation(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } }
  return (e.cause?.code ?? e.code) === "23505"
}

export type CreateLinkResult = { id: string; duplicate: boolean; fetched: boolean; title: string }

export const actions = {
  list: defineAction({
    description:
      "List the user's saved links, newest first. Optionally filter by text (title, URL, description, note), by one tag, by the read-later flag or by whether the link is public.",
    kind: "read",
    input: listLinksInput,
    handler: ({ limit, query, tag, readLater, isPublic }): Promise<Link[]> =>
      asViewer(async (tx) => {
        const pattern = query ? likeContains(query) : null
        const rows = await tx
          .select(columns)
          .from(linksLinks)
          .where(
            and(
              mine,
              pattern
                ? or(
                    ilike(linksLinks.title, pattern),
                    ilike(linksLinks.url, pattern),
                    ilike(linksLinks.description, pattern),
                    ilike(linksLinks.note, pattern),
                  )
                : undefined,
              tag ? arrayContains(linksLinks.tags, [tag]) : undefined,
              readLater === undefined ? undefined : eq(linksLinks.readLater, readLater),
              isPublic === undefined ? undefined : eq(linksLinks.isPublic, isPublic),
            ),
          )
          .orderBy(desc(linksLinks.createdAt))
          .limit(limit)
        return rows.map(toLink)
      }),
  }),
  tags: defineAction({
    description: "List every tag the user has used on links, with how many links carry it, most used first.",
    kind: "read",
    input: noInput,
    handler: (): Promise<{ tag: string; count: number }[]> =>
      asViewer(async (tx) => {
        const rows = await tx.execute<{ tag: string; count: number }>(sql`
          select t.tag, count(*)::int as count
          from ${linksLinks}, unnest(${linksLinks.tags}) as t(tag)
          where ${mine}
          group by t.tag
          order by count desc, t.tag`)
        return [...rows]
      }),
  }),
  get: defineAction({
    description: "Get one saved link by id. Returns null if it doesn't exist.",
    kind: "read",
    input: linkIdInput,
    handler: ({ id }): Promise<Link | null> =>
      asViewer(async (tx) => {
        const [row] = await tx.select(columns).from(linksLinks).where(and(mine, eq(linksLinks.id, id)))
        return row ? toLink(row) : null
      }),
  }),
  create: defineAction({
    description:
      "Save a link by URL. The page's title, description, site name and icon are fetched automatically. Saving a URL that's already saved returns the existing link.",
    kind: "write",
    input: createLinkInput,
    handler: async ({ url, tags, note, isPublic, readLater }): Promise<CreateLinkResult> => {
      const meta = await metadataFor(url)
      const title = meta?.title || fallbackTitle(url)
      return asViewer(async (tx) => {
        const [existing] = await tx
          .select({ id: linksLinks.id, title: linksLinks.title })
          .from(linksLinks)
          .where(and(mine, eq(linksLinks.url, url)))
        if (existing) return { ...existing, duplicate: true, fetched: Boolean(meta) }
        try {
          const [row] = await tx
            .insert(linksLinks)
            .values({
              url,
              title,
              description: meta?.description ?? "",
              siteName: meta?.siteName ?? "",
              faviconUrl: meta?.faviconUrl ?? "",
              tags,
              note,
              isPublic,
              readLater,
            })
            .returning({ id: linksLinks.id })
          return { id: row!.id, duplicate: false, fetched: Boolean(meta?.title), title }
        } catch (error) {
          if (isUniqueViolation(error)) throw new Error("This link is already saved.")
          throw error
        }
      })
    },
  }),
  update: defineAction({
    description: "Replace a saved link's URL, title, description, tags, note and flags.",
    kind: "write",
    input: updateLinkInput,
    handler: ({ id, url, title, description, tags, note, isPublic, readLater }): Promise<Link> =>
      asViewer(async (tx) => {
        const [row] = await tx
          .update(linksLinks)
          .set({ url, title, description, tags, note, isPublic, readLater })
          .where(and(mine, eq(linksLinks.id, id)))
          .returning(columns)
        if (!row) throw new Error("Link not found")
        return toLink(row)
      }),
  }),
  setFlags: defineAction({
    description: "Mark a link to read later (or not), and publish it on the public links page (or hide it).",
    kind: "write",
    input: setLinkFlagsInput,
    handler: ({ id, isPublic, readLater }): Promise<void> =>
      asViewer(async (tx) => {
        if (isPublic === undefined && readLater === undefined) return
        await tx
          .update(linksLinks)
          .set({ isPublic, readLater })
          .where(and(mine, eq(linksLinks.id, id)))
      }),
  }),
  refreshMetadata: defineAction({
    description: "Fetch a saved link's page again and update its title, description, site name and icon.",
    kind: "write",
    input: linkIdInput,
    handler: async ({ id }): Promise<Link | null> => {
      const link = await actions.get.handler({ id })
      if (!link) return null
      const meta = await metadataFor(link.url)
      if (!meta) return null
      return asViewer(async (tx) => {
        const [row] = await tx
          .update(linksLinks)
          .set({
            title: meta.title || link.title,
            description: meta.description,
            siteName: meta.siteName,
            faviconUrl: meta.faviconUrl,
          })
          .where(and(mine, eq(linksLinks.id, id)))
          .returning(columns)
        return row ? toLink(row) : null
      })
    },
  }),
  delete: defineAction({
    description: "Delete one of the user's saved links by id. Returns the deleted link so it can be restored.",
    kind: "write",
    input: linkIdInput,
    handler: ({ id }): Promise<Link | null> =>
      asViewer(async (tx) => {
        const [row] = await tx
          .delete(linksLinks)
          .where(and(mine, eq(linksLinks.id, id)))
          .returning(columns)
        return row ? toLink(row) : null
      }),
  }),
  restore: defineAction({
    description: "Put back a link that was just deleted, with its original id and dates.",
    kind: "write",
    input: restoreLinkInput,
    handler: (link): Promise<void> =>
      asViewer(async (tx) => {
        await tx
          .insert(linksLinks)
          .values({
            id: link.id,
            url: link.url,
            title: link.title,
            description: link.description,
            siteName: link.site_name,
            faviconUrl: link.favicon_url,
            tags: link.tags,
            note: link.note,
            isPublic: link.is_public,
            readLater: link.read_later,
            createdAt: new Date(link.created_at),
          })
          .onConflictDoNothing()
      }),
  }),
}
