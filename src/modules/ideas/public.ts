import "server-only"
import { desc, eq } from "drizzle-orm"
import { cacheLife, cacheTag } from "next/cache"
import { asPublic } from "@/db"
import { ideasIdeas as i } from "@/db/schema"
import { ideaColumns, statusOrder, toIdea } from "./actions"
import { PUBLIC_IDEAS_TAG, type Idea, type PublicIdea } from "./schema"

// Reads for visitors: no viewer, so RLS returns only the site owner's published
// ideas. Cached across requests; server actions drop the tag on every edit.
// Render after `await connection()` inside <Suspense> (no database at build).

function toPublic(idea: Idea): PublicIdea {
  const rest: Partial<Idea> = { ...idea }
  delete rest.isPublic
  return rest as PublicIdea
}

export async function getPublishedIdeas(): Promise<PublicIdea[]> {
  "use cache"
  cacheTag(PUBLIC_IDEAS_TAG)
  cacheLife("days")
  const rows = await asPublic((tx) =>
    tx.select(ideaColumns).from(i).where(eq(i.isPublic, true)).orderBy(statusOrder, desc(i.updatedAt)),
  )
  return rows.map((row) => toPublic(toIdea(row)))
}

export async function getLatestPublishedIdeas(limit = 4): Promise<PublicIdea[]> {
  "use cache"
  cacheTag(PUBLIC_IDEAS_TAG)
  cacheLife("days")
  const rows = await asPublic((tx) =>
    tx.select(ideaColumns).from(i).where(eq(i.isPublic, true)).orderBy(desc(i.updatedAt)).limit(limit),
  )
  return rows.map((row) => toPublic(toIdea(row)))
}
