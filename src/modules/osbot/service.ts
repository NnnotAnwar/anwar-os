import "server-only"
import { and, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm"
import { z } from "zod"
import { asViewer } from "@/core/auth"
import {
  calendarEvents,
  calendarReminderDeliveries,
  calendarReminders,
  feedbackItems,
  osbotFeedbackAlerts,
  osbotHeartbeats,
} from "@/db/schema"
import { actions as calendar } from "@/modules/calendar/actions"
import { formatDayMonth, formatTimeRange, formatWeekdayLong } from "@/modules/calendar/lib/format"
import { addDays, startOfLocalDay, wallClock } from "@/modules/calendar/lib/zoned"
import { actions as feedback } from "@/modules/feedback/actions"
import { kindLabels, preview } from "@/modules/feedback/schema"
import { deliveryKey, dueReminders, MAX_LOOKBACK_MINUTES, parseDeliveryKey, type DueReminder } from "./reminders"

// What the internal osbot API does. Every function here runs inside actAs(owner)
// (see api.ts), so asViewer() and the module actions act as the site owner and
// RLS scopes every query to them.

/** Bot heartbeats older than this mean "not connected". The bot beats every 60 s. */
export const HEARTBEAT_STALE_MS = 3 * 60_000
/** New feedback older than this is not alerted any more (e.g. after a long outage). */
const FEEDBACK_ALERT_WINDOW_MS = 3 * 86_400_000
const DELIVERY_RETENTION_DAYS = 60

function baseUrl() {
  return (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

export { capture, CaptureError, captureInput, listCaptureTargets } from "./capture"

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

/** Epoch milliseconds (what the bot sends: no characters to escape) or an ISO date. */
const instant = z
  .string()
  .max(40)
  .transform((value, ctx) => {
    const date = /^\d{1,15}$/.test(value) ? new Date(Number(value)) : new Date(value)
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "Expected epoch milliseconds or an ISO date." })
      return z.NEVER
    }
    return date
  })

export const dueInput = z.object({
  until: instant.optional(),
  lookback: z.coerce.number().int().min(1).max(MAX_LOOKBACK_MINUTES).optional(),
})

export async function remindersDue(
  { until, lookback }: z.infer<typeof dueInput>,
  ownerTimezone: string,
  now = new Date(),
): Promise<DueReminder[]> {
  // The bot may look a little ahead (to send on the minute), never far.
  const limit = until ? Math.min(until.getTime(), now.getTime() + 5 * 60_000) : now.getTime()
  const end = new Date(limit)
  return asViewer(async (tx) => {
    const reminders = await tx
      .select({ eventId: calendarReminders.eventId, minutesBefore: calendarReminders.minutesBefore })
      .from(calendarReminders)
    if (!reminders.length) return []
    const eventIds = [...new Set(reminders.map((r) => r.eventId))]
    // Anything that could still have an occurrence in the window (series or not).
    const events = await tx
      .select()
      .from(calendarEvents)
      .where(
        and(
          inArray(calendarEvents.id, eventIds),
          lt(calendarEvents.startAt, new Date(end.getTime() + 29 * 86_400_000)),
          or(isNotNull(calendarEvents.rrule), gte(calendarEvents.endAt, new Date(end.getTime() - 2 * 86_400_000))),
        ),
      )
    if (!events.length) return []
    const delivered = await tx
      .select({
        eventId: calendarReminderDeliveries.eventId,
        occurrenceStart: calendarReminderDeliveries.occurrenceStart,
        minutesBefore: calendarReminderDeliveries.minutesBefore,
      })
      .from(calendarReminderDeliveries)
      .where(
        and(
          inArray(calendarReminderDeliveries.eventId, events.map((e) => e.id)),
          gte(calendarReminderDeliveries.occurrenceStart, new Date(end.getTime() - 3 * 86_400_000)),
        ),
      )
    const deliveredKeys = new Set(delivered.map((d) => deliveryKey(d.eventId, d.occurrenceStart, d.minutesBefore)))
    return dueReminders({
      events,
      reminders,
      delivered: deliveredKeys,
      ownerTimezone,
      until: end,
      now,
      lookbackMinutes: lookback,
    })
  })
}

export const ackRemindersInput = z.object({ keys: z.array(z.string().max(120)).min(1).max(200) })

/** Records reminders as sent. Unknown or foreign events are skipped (RLS + FK), repeats are no-ops. */
export async function ackReminders({ keys }: z.infer<typeof ackRemindersInput>): Promise<{ acked: number }> {
  const rows = keys.map(parseDeliveryKey).filter((k) => k !== null)
  if (!rows.length) return { acked: 0 }
  return asViewer(async (tx) => {
    // Only events the owner can see; anything else would fail the foreign key.
    const visible = await tx
      .select({ id: calendarEvents.id })
      .from(calendarEvents)
      .where(inArray(calendarEvents.id, [...new Set(rows.map((r) => r.eventId))]))
    const ids = new Set(visible.map((v) => v.id))
    const values = rows.filter((r) => ids.has(r.eventId))
    let acked = 0
    if (values.length) {
      const inserted = await tx
        .insert(calendarReminderDeliveries)
        .values(values)
        .onConflictDoNothing({
          target: [
            calendarReminderDeliveries.eventId,
            calendarReminderDeliveries.occurrenceStart,
            calendarReminderDeliveries.minutesBefore,
          ],
        })
        .returning({ id: calendarReminderDeliveries.id })
      acked = inserted.length
    }
    await tx
      .delete(calendarReminderDeliveries)
      .where(lt(calendarReminderDeliveries.deliveredAt, sql`now() - make_interval(days => ${DELIVERY_RETENTION_DAYS})`))
    return { acked }
  })
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

export type TodayItem = { title: string; location: string; allDay: boolean; start: string; end: string; time: string }
export type Today = { date: string; timezone: string; events: TodayItem[]; newFeedback: number; url: string }

export async function today(ownerTimezone: string, now = new Date()): Promise<Today> {
  const local = wallClock(now, ownerTimezone)
  const from = startOfLocalDay(local, ownerTimezone)
  const to = startOfLocalDay(addDays(local, 1), ownerTimezone)
  const [occurrences, counts] = await Promise.all([calendar.range.handler({ from, to }), feedback.counts.handler({})])
  return {
    date: `${formatWeekdayLong(now, "en", ownerTimezone)} ${formatDayMonth(now, "en", ownerTimezone)}`,
    timezone: ownerTimezone,
    events: occurrences.map((o) => ({
      title: o.title,
      location: o.location,
      allDay: o.allDay,
      start: o.start,
      end: o.end,
      time: o.allDay ? "All day" : formatTimeRange(new Date(o.start), new Date(o.end), ownerTimezone),
    })),
    newFeedback: counts.new,
    url: `${baseUrl()}/app/calendar`,
  }
}

// ---------------------------------------------------------------------------
// Feedback alerts
// ---------------------------------------------------------------------------

export type FeedbackAlert = {
  id: string
  kind: string
  kindLabel: string
  message: string
  name: string | null
  contact: string | null
  createdAt: string
  url: string
}

/** New feedback from the last few days that nobody has alerted the owner about yet. */
export async function newFeedback(now = new Date()): Promise<FeedbackAlert[]> {
  const items = await feedback.list.handler({ filter: "new", limit: 50 })
  const recent = items.filter((i) => now.getTime() - new Date(i.created_at).getTime() < FEEDBACK_ALERT_WINDOW_MS)
  if (!recent.length) return []
  const alerted = await asViewer((tx) =>
    tx
      .select({ id: osbotFeedbackAlerts.feedbackId })
      .from(osbotFeedbackAlerts)
      .where(inArray(osbotFeedbackAlerts.feedbackId, recent.map((i) => i.id))),
  )
  const done = new Set(alerted.map((a) => a.id))
  const base = baseUrl()
  return recent
    .filter((i) => !done.has(i.id))
    .reverse() // oldest first, the order they arrived in
    .map((i) => ({
      id: i.id,
      kind: i.kind,
      kindLabel: kindLabels[i.kind],
      message: preview(i.message, 1500),
      name: i.name,
      contact: i.contact,
      createdAt: i.created_at,
      url: `${base}/app/feedback/${i.id}`,
    }))
}

export const ackFeedbackInput = z.object({ ids: z.array(z.uuid()).min(1).max(100) })

export async function ackFeedback(ids: string[], channel: "osbot" | "direct" = "osbot"): Promise<{ acked: number }> {
  return asViewer(async (tx) => {
    // RLS on feedback_items hides everyone else's feedback, so only the
    // owner's ids survive; the insert policy would refuse the rest anyway.
    const mine = await tx
      .select({ id: feedbackItems.id })
      .from(feedbackItems)
      .where(inArray(feedbackItems.id, [...new Set(ids)]))
    if (!mine.length) return { acked: 0 }
    const inserted = await tx
      .insert(osbotFeedbackAlerts)
      .values(mine.map((m) => ({ feedbackId: m.id, channel })))
      .onConflictDoNothing({ target: osbotFeedbackAlerts.feedbackId })
      .returning({ id: osbotFeedbackAlerts.feedbackId })
    return { acked: inserted.length }
  })
}

// ---------------------------------------------------------------------------
// Heartbeat and status
// ---------------------------------------------------------------------------

export const heartbeatInput = z.object({
  version: z.string().trim().min(1).max(80).default("dev"),
  startedAt: z.coerce.date(),
})

export async function heartbeat({ version, startedAt }: z.infer<typeof heartbeatInput>): Promise<void> {
  await asViewer(async (tx) => {
    await tx
      .insert(osbotHeartbeats)
      .values({ version, startedAt, lastBeatAt: new Date() })
      .onConflictDoUpdate({
        target: osbotHeartbeats.ownerId,
        set: { version, startedAt, lastBeatAt: new Date() },
      })
  })
}

export type OsbotStatus = {
  configured: boolean
  connected: boolean
  lastBeatAt: string | null
  version: string | null
  startedAt: string | null
}

/** Settings → Telegram, and the feedback fallback: is the bot alive? Runs as the current viewer. */
export async function osbotStatus(now = new Date()): Promise<OsbotStatus> {
  const configured = Boolean(process.env.OSBOT_API_SECRET)
  const [row] = await asViewer((tx) =>
    tx.select().from(osbotHeartbeats).where(eq(osbotHeartbeats.ownerId, sql`app.current_user_id()`)),
  )
  return {
    configured,
    connected: Boolean(row && now.getTime() - row.lastBeatAt.getTime() < HEARTBEAT_STALE_MS),
    lastBeatAt: row?.lastBeatAt.toISOString() ?? null,
    version: row?.version ?? null,
    startedAt: row?.startedAt.toISOString() ?? null,
  }
}
