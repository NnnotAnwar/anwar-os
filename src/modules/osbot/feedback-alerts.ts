import "server-only"
import { sql } from "drizzle-orm"
import { actAs } from "@/core/auth"
import { db } from "@/db"
import { notifyOwner } from "@/modules/feedback/notify"
import { ackFeedback, osbotStatus } from "./service"

// Who tells the owner about new feedback.
//   - OSBOT_API_SECRET set and the bot's heartbeat is fresh: osbot does (it
//     polls GET feedback/new every minute and acks what it sent).
//   - Otherwise: the web's direct Bot API notify (feedback/notify.ts, needs
//     OSBOT_TOKEN + OSBOT_OWNER_CHAT_ID), as before. If that worked and osbot is
//     configured, the item is recorded as alerted so the bot doesn't repeat it
//     when it comes back.
// Never throws: runs after the response (after()) and must not break anything.

type Deps = {
  notify?: typeof notifyOwner
  env?: { OSBOT_API_SECRET?: string }
}

async function siteOwnerId(): Promise<string | null> {
  const rows = await db.execute<{ id: string | null }>(sql`select app.site_owner_id() as id`)
  return rows[0]?.id ?? null
}

export async function alertNewFeedback(feedbackId: string, text: string, deps: Deps = {}): Promise<"osbot" | "direct" | "none"> {
  const { notify = notifyOwner, env = process.env } = deps
  try {
    const osbotConfigured = Boolean(env.OSBOT_API_SECRET)
    const ownerId = osbotConfigured ? await siteOwnerId() : null
    if (ownerId) {
      const status = await actAs(ownerId, () => osbotStatus())
      if (status.connected) return "osbot"
    }
    const sent = await notify(text)
    if (sent && ownerId) await actAs(ownerId, () => ackFeedback([feedbackId], "direct"))
    return sent ? "direct" : "none"
  } catch (error) {
    console.error("feedback alert failed", error)
    return "none"
  }
}
