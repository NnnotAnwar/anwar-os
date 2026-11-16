import "server-only"
import { desc, eq } from "drizzle-orm"
import { asPublic } from "@/db"
import { linksLinks } from "@/db/schema"
import { columns, toLink } from "./actions"
import type { Link } from "./schema"

/**
 * The site owner's published links, for the public /links page. Runs with no
 * viewer: the "read published" policy is the only thing that lets rows through
 * (is_public and owner_id = app.site_owner_id()).
 */
export async function listPublishedLinks(): Promise<Link[]> {
  return asPublic(async (tx) => {
    const rows = await tx
      .select(columns)
      .from(linksLinks)
      .where(eq(linksLinks.isPublic, true))
      .orderBy(desc(linksLinks.createdAt))
      .limit(1000)
    return rows.map(toLink)
  })
}

/** Groups links under each of their tags (a link can appear in several). Untagged go last. */
export function groupByTag(links: Link[]) {
  const groups = new Map<string, Link[]>()
  for (const link of links) {
    for (const tag of link.tags.length ? link.tags : [""]) {
      groups.set(tag, [...(groups.get(tag) ?? []), link])
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([tag, items]) => ({ tag, links: items }))
}
