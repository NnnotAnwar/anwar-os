import "server-only"
import { asc, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { asViewer } from "@/core/auth"
import { documentsDocuments as d } from "@/db/schema"
import { deliveredKeys, recordDeliveries } from "@/modules/osbot/deliveries"
import { DocumentInputError, documentColumns } from "./actions"
import { addDaysIso, daysBetween, formatDate, formatShortDate, ownerClock } from "./lib/dates"
import { candidateKeys, dueReminders, REMINDER_KEY, REMINDER_TIME } from "./lib/reminders"
import { kindEmoji, kindLabels, type DocumentKind } from "./schema"

// What osbot needs from documents: the expiry reminders due now (one card per
// document, at 10:00 in the owner's clock on each reminder day, late once if
// the bot was down) and "Remind tomorrow". Runs inside actAs(owner) (the osbot
// API wrapper), so RLS scopes everything to the owner. The schedule itself is
// pure: lib/reminders.ts.

function baseUrl() {
  return (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")
}

const documentUrl = (id: string) => `${baseUrl()}/app/documents/${id}`

export type DocumentReminder = {
  id: string
  name: string
  kind: DocumentKind
  kindLabel: string
  emoji: string
  expiresOn: string
  /** "24 Dec 2026". */
  dateLabel: string
  /** Days from today to the expiry date; negative once expired. */
  daysLeft: number
  /** "90" … "0", "expired", or "snooze" (a snoozed card on a day without a stage). */
  stage: string
  /** True when the bot missed the day and sends it now. */
  late: boolean
  dueOn: string
  /** "24 Nov", for "This was due on 24 Nov". */
  dueLabel: string
  snoozed: boolean
  /** What documents/reminders/ack takes once sent. */
  keys: string[]
  url: string
  /** Opens the document with "Renewed" ready (expiry date focused). */
  renewUrl: string
}

export type DocumentRemindersDue = { today: string; time: string; reminderTime: string; items: DocumentReminder[]; url: string }

/** The reminder cards due now that osbot hasn't sent yet. Nothing is marked sent until reminders/ack. */
export async function remindersDue(timezone: string, now = new Date()): Promise<DocumentRemindersDue> {
  const clock = ownerClock(timezone, now)
  const rows = await asViewer((tx) => tx.select(documentColumns).from(d).orderBy(asc(d.expiresOn), asc(d.name)))
  const sent = await deliveredKeys("document", rows.flatMap(candidateKeys))
  const items = dueReminders(rows, clock, sent).map(({ doc, ...due }) => ({
    id: doc.id,
    name: doc.name,
    kind: doc.kind,
    kindLabel: kindLabels[doc.kind],
    emoji: kindEmoji[doc.kind],
    expiresOn: doc.expiresOn,
    dateLabel: formatDate(doc.expiresOn),
    daysLeft: daysBetween(clock.today, doc.expiresOn),
    stage: due.stage,
    late: due.late,
    dueOn: due.dueOn,
    dueLabel: formatShortDate(due.dueOn),
    snoozed: due.snoozed,
    keys: due.keys,
    url: documentUrl(doc.id),
    renewUrl: `${documentUrl(doc.id)}?renew=1`,
  }))
  return { ...clock, reminderTime: REMINDER_TIME, items, url: `${baseUrl()}/app/documents` }
}

export const ackRemindersInput = z.object({
  keys: z.array(z.string().regex(REMINDER_KEY, "Expected <document id>:<expires on>:<stage>.")).min(1).max(200),
})

/** Records cards as sent. Keys of documents the owner can't see are skipped; repeats are no-ops. */
export async function ackReminders({ keys }: z.infer<typeof ackRemindersInput>): Promise<{ acked: number }> {
  const idOf = (key: string) => REMINDER_KEY.exec(key)![1]!
  const ids = [...new Set(keys.map(idOf))]
  const visible = await asViewer((tx) => tx.select({ id: d.id }).from(d).where(inArray(d.id, ids)))
  const mine = new Set(visible.map((v) => v.id))
  const acked = await recordDeliveries("document", keys.filter((k) => mine.has(idOf(k))))
  return { acked }
}

export const snoozeInput = z.object({ id: z.uuid() })

export type SnoozeResult = { id: string; name: string; snoozedUntil: string; label: string; time: string }

/** "Remind tomorrow": one more card at 10:00 on the owner's tomorrow. */
export async function snoozeReminder({ id }: z.infer<typeof snoozeInput>, timezone: string, now = new Date()): Promise<SnoozeResult> {
  const until = addDaysIso(ownerClock(timezone, now).today, 1)
  const [row] = await asViewer((tx) => tx.update(d).set({ snoozedUntil: until }).where(eq(d.id, id)).returning({ id: d.id, name: d.name }))
  if (!row) throw new DocumentInputError("That document doesn't exist anymore.")
  return { id: row.id, name: row.name, snoozedUntil: until, label: formatShortDate(until), time: REMINDER_TIME }
}
