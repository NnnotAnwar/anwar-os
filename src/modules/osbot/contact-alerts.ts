import "server-only"
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import { actAs, asViewer, loadViewer } from "@/core/auth"
import { db } from "@/db"
import { contactMessages } from "@/db/schema"
import { runModuleAction } from "@/core/module-actions"
import {
  contactStatuses,
  topicLabels,
  type ContactStatus,
  type ContactTopic,
} from "@/modules/feedback/contact/schema"
import { notifyOwner } from "@/modules/feedback/notify"
import { preview } from "@/modules/feedback/schema"
import { OsbotApiError } from "./api"
import { osbotStatus } from "./service"

// New contact messages (the public /contact form) → Telegram. Same split as
// feedback-alerts.ts: osbot polls GET contact/new every minute and acks what it
// sent; without a connected bot the web sends a plain message itself. The
// "already told" mark is contact_messages.alerted_at, so a message is
// announced once whichever path sent it.

/** Messages older than this are not announced any more (e.g. after a long outage). */
const ALERT_WINDOW_MS = 3 * 86_400_000

export type ContactAlert = {
  id: string
  topic: ContactTopic
  topicLabel: string
  name: string
  email: string
  company: string | null
  message: string
  createdAt: string
  url: string
}

function baseUrl() {
  return (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")
}

/** New, unannounced contact messages from the last few days, oldest first. Runs as the owner. */
export async function newContact(now = new Date()): Promise<ContactAlert[]> {
  const rows = await asViewer((tx) =>
    tx
      .select()
      .from(contactMessages)
      .where(
        and(
          eq(contactMessages.status, "new"),
          isNull(contactMessages.alertedAt),
          gt(contactMessages.createdAt, new Date(now.getTime() - ALERT_WINDOW_MS)),
        ),
      )
      .orderBy(asc(contactMessages.createdAt))
      .limit(50),
  )
  const base = baseUrl()
  return rows.map((m) => ({
    id: m.id,
    topic: m.topic,
    topicLabel: topicLabels[m.topic],
    name: m.name,
    email: m.email,
    company: m.company,
    message: preview(m.message, 1500),
    createdAt: m.createdAt.toISOString(),
    url: `${base}/app/feedback/contact/${m.id}`,
  }))
}

export const ackContactInput = z.object({ ids: z.array(z.uuid()).min(1).max(100) })

/** Marks messages as announced. RLS limits it to the owner's own; already-marked ones don't count. */
export async function ackContact(ids: string[]): Promise<{ acked: number }> {
  return asViewer(async (tx) => {
    const rows = await tx
      .update(contactMessages)
      .set({ alertedAt: sql`now()` })
      .where(and(inArray(contactMessages.id, [...new Set(ids)]), isNull(contactMessages.alertedAt)))
      .returning({ id: contactMessages.id })
    return { acked: rows.length }
  })
}

export const contactStatusInput = z.object({ id: z.uuid(), status: z.enum(contactStatuses) })

/** Mark replied / Archive and their Undo on the bot's cards. */
export async function contactStatus({
  id,
  status,
}: z.infer<typeof contactStatusInput>): Promise<{ id: string; status: ContactStatus; previous: ContactStatus }> {
  const previous = await runModuleAction<ContactStatus | null>("feedback", "contactSetStatus", { id, status })
  if (previous === null) throw new OsbotApiError(404, "gone", "That message no longer exists.")
  return { id, status, previous }
}

type Deps = {
  notify?: typeof notifyOwner
  env?: { OSBOT_API_SECRET?: string }
}

/** After a submission: leave it to osbot when it's connected, else notify directly. Never throws. */
export async function alertNewContact(contactId: string, text: string, deps: Deps = {}): Promise<"osbot" | "direct" | "none"> {
  const { notify = notifyOwner, env = process.env } = deps
  try {
    const ownerRows = await db.execute<{ id: string | null }>(sql`select app.site_owner_id() as id`)
    const ownerId = ownerRows[0]?.id ?? null
    const owner = ownerId ? await loadViewer(ownerId) : null
    if (owner && env.OSBOT_API_SECRET) {
      const status = await actAs(owner, () => osbotStatus())
      if (status.connected) return "osbot"
    }
    const sent = await notify(text)
    if (sent && owner) await actAs(owner, () => ackContact([contactId]))
    return sent ? "direct" : "none"
  } catch (error) {
    console.error("contact alert failed", error)
    return "none"
  }
}
