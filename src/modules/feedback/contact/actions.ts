import "server-only"
import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm"
import { z } from "zod"
import { asViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import { contactMessages } from "@/db/schema"
import { likeContains } from "@/lib/sql-like"
import {
  contactIdInput,
  listContactInput,
  setContactStatusInput,
  type ContactMessage,
  type ContactStatus,
} from "./schema"

const columns = {
  id: contactMessages.id,
  topic: contactMessages.topic,
  name: contactMessages.name,
  email: contactMessages.email,
  company: contactMessages.company,
  message: contactMessages.message,
  status: contactMessages.status,
  createdAt: contactMessages.createdAt,
  updatedAt: contactMessages.updatedAt,
}

type Row = Pick<typeof contactMessages.$inferSelect, keyof typeof columns>

function toMessage(row: Row): ContactMessage {
  return {
    id: row.id,
    topic: row.topic,
    name: row.name,
    email: row.email,
    company: row.company,
    message: row.message,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

// Contact messages (the public /contact form): RLS shows each user only the
// messages addressed to them. They arrive through contact/submit.ts only.
// Part of the feedback module's actions (named contact*), so the assistant,
// MCP and osbot see them too.
export const contactActions = {
  contactList: defineAction({
    description:
      "List contact messages (job offers, freelance projects) people sent through the public contact form, newest first. Filter 'open' shows everything except archived; or pass one status (new, replied, archived). Optionally search name, email, company and message.",
    kind: "read",
    input: listContactInput,
    handler: ({ filter, query, limit }): Promise<ContactMessage[]> =>
      asViewer(async (tx) => {
        const pattern = query ? likeContains(query) : null
        const rows = await tx
          .select(columns)
          .from(contactMessages)
          .where(
            and(
              filter === "open" ? ne(contactMessages.status, "archived") : eq(contactMessages.status, filter),
              pattern
                ? or(
                    ilike(contactMessages.message, pattern),
                    ilike(contactMessages.name, pattern),
                    ilike(contactMessages.email, pattern),
                    ilike(contactMessages.company, pattern),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(contactMessages.createdAt))
          .limit(limit)
        return rows.map(toMessage)
      }),
  }),
  contactCounts: defineAction({
    description: "Count the user's contact messages by status (new, replied, archived).",
    kind: "read",
    input: z.object({}),
    handler: (): Promise<Record<ContactStatus, number>> =>
      asViewer(async (tx) => {
        const rows = await tx
          .select({ status: contactMessages.status, count: sql<number>`count(*)::int` })
          .from(contactMessages)
          .groupBy(contactMessages.status)
        const counts: Record<ContactStatus, number> = { new: 0, replied: 0, archived: 0 }
        for (const r of rows) counts[r.status] = r.count
        return counts
      }),
  }),
  contactGet: defineAction({
    description: "Get one contact message by id. Null if it doesn't exist.",
    kind: "read",
    input: contactIdInput,
    handler: ({ id }): Promise<ContactMessage | null> =>
      asViewer(async (tx) => {
        const [row] = await tx.select(columns).from(contactMessages).where(eq(contactMessages.id, id))
        return row ? toMessage(row) : null
      }),
  }),
  contactSetStatus: defineAction({
    description: "Set a contact message's status: new, replied or archived. Returns the previous status.",
    kind: "write",
    input: setContactStatusInput,
    handler: ({ id, status }): Promise<ContactStatus | null> =>
      asViewer(async (tx) => {
        const [before] = await tx
          .select({ status: contactMessages.status })
          .from(contactMessages)
          .where(eq(contactMessages.id, id))
          .for("update")
        if (!before) return null
        await tx.update(contactMessages).set({ status }).where(eq(contactMessages.id, id))
        return before.status
      }),
  }),
  contactDelete: defineAction({
    description: "Permanently delete one contact message by id.",
    kind: "write",
    input: contactIdInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.delete(contactMessages).where(eq(contactMessages.id, id))
      }),
  }),
}
