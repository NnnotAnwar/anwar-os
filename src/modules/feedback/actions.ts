import "server-only"
import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm"
import { asViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import { feedbackItems } from "@/db/schema"
import { likeContains } from "@/lib/sql-like"
import {
  feedbackIdInput,
  listFeedbackInput,
  saveReplyNoteInput,
  setStatusInput,
  type FeedbackItem,
  type FeedbackStatus,
} from "./schema"
import { z } from "zod"

const columns = {
  id: feedbackItems.id,
  kind: feedbackItems.kind,
  message: feedbackItems.message,
  name: feedbackItems.name,
  contact: feedbackItems.contact,
  status: feedbackItems.status,
  replyNote: feedbackItems.replyNote,
  createdAt: feedbackItems.createdAt,
  updatedAt: feedbackItems.updatedAt,
}

type Row = Pick<typeof feedbackItems.$inferSelect, keyof typeof columns>

function toItem(row: Row): FeedbackItem {
  return {
    id: row.id,
    kind: row.kind,
    message: row.message,
    name: row.name,
    contact: row.contact,
    status: row.status,
    reply_note: row.replyNote,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

// The inbox: RLS shows each user only feedback addressed to them (in practice,
// the site owner). Submissions arrive through submit.ts, never through here.
export const actions = {
  list: defineAction({
    description:
      "List feedback visitors sent to the user, newest first. Filter 'inbox' shows everything except spam; or pass one status (new, read, in_progress, done, spam). Optionally search the message, name and contact.",
    kind: "read",
    input: listFeedbackInput,
    handler: ({ filter, query, limit }): Promise<FeedbackItem[]> =>
      asViewer(async (tx) => {
        const pattern = query ? likeContains(query) : null
        const rows = await tx
          .select(columns)
          .from(feedbackItems)
          .where(
            and(
              filter === "inbox" ? ne(feedbackItems.status, "spam") : eq(feedbackItems.status, filter),
              pattern
                ? or(
                    ilike(feedbackItems.message, pattern),
                    ilike(feedbackItems.name, pattern),
                    ilike(feedbackItems.contact, pattern),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(feedbackItems.createdAt))
          .limit(limit)
        return rows.map(toItem)
      }),
  }),
  counts: defineAction({
    description: "Count the user's feedback by status (new, read, in_progress, done, spam).",
    kind: "read",
    input: z.object({}),
    handler: (): Promise<Record<FeedbackStatus, number>> =>
      asViewer(async (tx) => {
        const rows = await tx
          .select({ status: feedbackItems.status, count: sql<number>`count(*)::int` })
          .from(feedbackItems)
          .groupBy(feedbackItems.status)
        const counts: Record<FeedbackStatus, number> = { new: 0, read: 0, in_progress: 0, done: 0, spam: 0 }
        for (const r of rows) counts[r.status] = r.count
        return counts
      }),
  }),
  get: defineAction({
    description: "Get one piece of feedback by id, with the user's private reply note. Null if it doesn't exist.",
    kind: "read",
    input: feedbackIdInput,
    handler: ({ id }): Promise<FeedbackItem | null> =>
      asViewer(async (tx) => {
        const [row] = await tx.select(columns).from(feedbackItems).where(eq(feedbackItems.id, id))
        return row ? toItem(row) : null
      }),
  }),
  setStatus: defineAction({
    description: "Set a feedback item's status: new, read, in_progress, done or spam. Returns the previous status.",
    kind: "write",
    input: setStatusInput,
    handler: ({ id, status }): Promise<FeedbackStatus | null> =>
      asViewer(async (tx) => {
        const [before] = await tx
          .select({ status: feedbackItems.status })
          .from(feedbackItems)
          .where(eq(feedbackItems.id, id))
          .for("update")
        if (!before) return null
        await tx.update(feedbackItems).set({ status }).where(eq(feedbackItems.id, id))
        return before.status
      }),
  }),
  saveReplyNote: defineAction({
    description: "Replace the user's private note on a feedback item (how they replied, what they did about it).",
    kind: "write",
    input: saveReplyNoteInput,
    handler: ({ id, replyNote }): Promise<string> =>
      asViewer(async (tx) => {
        const [row] = await tx
          .update(feedbackItems)
          .set({ replyNote })
          .where(eq(feedbackItems.id, id))
          .returning({ updatedAt: feedbackItems.updatedAt })
        if (!row) throw new Error("Feedback not found")
        return row.updatedAt.toISOString()
      }),
  }),
  delete: defineAction({
    description: "Permanently delete one feedback item by id.",
    kind: "write",
    input: feedbackIdInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.delete(feedbackItems).where(eq(feedbackItems.id, id))
      }),
  }),
}
