import "server-only"
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm"
import { z } from "zod"
import { asViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import { ideasIdeas as i } from "@/db/schema"
import { likeContains } from "@/lib/sql-like"
import {
  createIdeaInput,
  ideaIdInput,
  listIdeasInput,
  setIdeaPublicInput,
  setIdeaStatusInput,
  updateIdeaInput,
  type Idea,
} from "./schema"

export const ideaColumns = {
  id: i.id,
  title: i.title,
  body: i.body,
  status: i.status,
  tags: i.tags,
  isPublic: i.isPublic,
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
}

type Row = Omit<Idea, "createdAt" | "updatedAt"> & { createdAt: Date; updatedAt: Date }

export function toIdea(row: Row): Idea {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
}

/** Pipeline order: active work first, then the raw pile, then what's finished. */
export const statusOrder = sql`array_position(array['building', 'exploring', 'raw', 'shipped', 'dropped'], ${i.status})`

// The "read published" policy lets everyone see the site owner's public ideas,
// so private queries must also say "only mine" (same as links).
const mine = eq(i.ownerId, sql`app.current_user_id()`)

export const actions = {
  list: defineAction({
    description:
      "List the user's ideas, active ones first (building, exploring, raw, shipped, dropped), newest edit first within each. Optionally filter by statuses or by text in the title, notes or tags.",
    kind: "read",
    input: listIdeasInput,
    handler: ({ status, query, limit }): Promise<Idea[]> =>
      asViewer(async (tx) => {
        const pattern = query ? likeContains(query) : null
        const rows = await tx
          .select(ideaColumns)
          .from(i)
          .where(
            and(
              mine,
              status?.length ? inArray(i.status, status) : undefined,
              pattern
                ? or(
                    ilike(i.title, pattern),
                    ilike(i.body, pattern),
                    sql`exists (select 1 from unnest(${i.tags}) t where t ilike ${pattern})`,
                  )
                : undefined,
            ),
          )
          .orderBy(statusOrder, desc(i.updatedAt))
          .limit(limit)
        return rows.map(toIdea)
      }),
  }),
  counts: defineAction({
    description: "Count the user's ideas per status.",
    kind: "read",
    input: z.object({}),
    handler: (): Promise<Record<string, number>> =>
      asViewer(async (tx) => {
        const rows = await tx
          .select({ status: i.status, n: sql<number>`count(*)::int` })
          .from(i)
          .where(mine)
          .groupBy(i.status)
        return Object.fromEntries(rows.map((r) => [r.status, r.n]))
      }),
  }),
  get: defineAction({
    description: "Get one idea by id with its full notes. Returns null if it doesn't exist.",
    kind: "read",
    input: ideaIdInput,
    handler: ({ id }): Promise<Idea | null> =>
      asViewer(async (tx) => {
        const [row] = await tx.select(ideaColumns).from(i).where(and(mine, eq(i.id, id)))
        return row ? toIdea(row) : null
      }),
  }),
  create: defineAction({
    description:
      "Capture an idea. Only the title is required; it starts as raw and private unless a status or isPublic is given.",
    kind: "write",
    input: createIdeaInput,
    handler: (input): Promise<{ id: string; updatedAt: string }> =>
      asViewer(async (tx) => {
        const [row] = await tx.insert(i).values(input).returning({ id: i.id, updatedAt: i.updatedAt })
        return { id: row!.id, updatedAt: row!.updatedAt.toISOString() }
      }),
  }),
  update: defineAction({
    description: "Replace an idea's title, notes, status, tags and public flag.",
    kind: "write",
    input: updateIdeaInput,
    handler: ({ id, ...fields }): Promise<{ updatedAt: string }> =>
      asViewer(async (tx) => {
        const [row] = await tx.update(i).set(fields).where(eq(i.id, id)).returning({ updatedAt: i.updatedAt })
        if (!row) throw new Error("Idea not found")
        return { updatedAt: row.updatedAt.toISOString() }
      }),
  }),
  setStatus: defineAction({
    description: "Move an idea along the pipeline: raw → exploring → building → shipped, or dropped.",
    kind: "write",
    input: setIdeaStatusInput,
    handler: ({ id, status }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.update(i).set({ status }).where(eq(i.id, id))
      }),
  }),
  setPublic: defineAction({
    description: "Publish an idea on the public /ideas page, or make it private again.",
    kind: "write",
    input: setIdeaPublicInput,
    handler: ({ id, value }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.update(i).set({ isPublic: value }).where(eq(i.id, id))
      }),
  }),
  delete: defineAction({
    description: "Permanently delete one of the user's ideas by id.",
    kind: "write",
    input: ideaIdInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.delete(i).where(eq(i.id, id))
      }),
  }),
}
