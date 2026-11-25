import "server-only"
import { and, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm"
import { z } from "zod"
import { asViewer } from "@/core/auth"
import { hasModule, runModuleAction } from "@/core/module-actions"
import {
  calendarEvents,
  calendarReminderDeliveries,
  calendarReminders,
  feedbackItems,
  osbotFeedbackAlerts,
  osbotHeartbeats,
} from "@/db/schema"
import { formatDayMonth, formatTimeRange, formatWeekdayLong } from "@/modules/calendar/lib/format"
import { calendarHref } from "@/modules/calendar/lib/links"
import { addDays, formatIsoDate, startOfLocalDay, wallClock } from "@/modules/calendar/lib/zoned"
import type { Occurrence } from "@/modules/calendar/schema"
import { feedbackStatuses, kindLabels, preview, type FeedbackItem, type FeedbackStatus } from "@/modules/feedback/schema"
import type { Task } from "@/modules/tasks/schema"
import { OsbotApiError } from "./api"
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

export { capture, CaptureError, captureInput, captureUndoInput, listCaptureTargets, undoCapture } from "./capture"

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

/** A due reminder plus a link to its occurrence in the calendar (the bot's "Open" button). */
export type DueReminderWithUrl = DueReminder & { url: string }

export async function remindersDue(
  input: z.infer<typeof dueInput>,
  ownerTimezone: string,
  now = new Date(),
): Promise<DueReminderWithUrl[]> {
  const base = baseUrl()
  const due = await dueRemindersFor(input, ownerTimezone, now)
  return due.map((r) => ({
    ...r,
    url: `${base}${calendarHref({ view: "week", date: wallClock(new Date(r.start), ownerTimezone), event: r.eventId })}`,
  }))
}

async function dueRemindersFor(
  { until, lookback }: z.infer<typeof dueInput>,
  ownerTimezone: string,
  now: Date,
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
export type TodayTask = { id: string; title: string; overdue: boolean; dueDate: string; time: string | null; url: string }
export type Today = {
  /** "Monday 16 Nov". */
  date: string
  /** The same day as YYYY-MM-DD. */
  day: string
  timezone: string
  events: TodayItem[]
  tasks: TodayTask[]
  /** Open tasks due today or earlier, including any beyond the listed ones. */
  tasksTotal: number
  newFeedback: number
  url: string
}

export async function today(ownerTimezone: string, now = new Date()): Promise<Today> {
  const local = wallClock(now, ownerTimezone)
  const from = startOfLocalDay(local, ownerTimezone)
  const to = startOfLocalDay(addDays(local, 1), ownerTimezone)
  const base = baseUrl()
  const [occurrences, due, counts] = await Promise.all([
    runModuleAction<Occurrence[]>("calendar", "range", { from, to }),
    (await hasModule("tasks"))
      ? runModuleAction<{ tasks: Task[]; total: number; today: string }>("tasks", "dueToday", { limit: 15 })
      : null,
    runModuleAction<Record<string, number>>("feedback", "counts", {}),
  ])
  return {
    date: `${formatWeekdayLong(now, "en", ownerTimezone)} ${formatDayMonth(now, "en", ownerTimezone)}`,
    day: formatIsoDate(local),
    timezone: ownerTimezone,
    events: occurrences.map((o) => ({
      title: o.title,
      location: o.location,
      allDay: o.allDay,
      start: o.start,
      end: o.end,
      time: o.allDay ? "All day" : formatTimeRange(new Date(o.start), new Date(o.end), ownerTimezone),
    })),
    tasks: (due?.tasks ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      overdue: t.dueDate !== null && t.dueDate < due!.today,
      dueDate: t.dueDate ?? due!.today,
      time: t.dueTime,
      url: `${base}/app/tasks?task=${t.id}`,
    })),
    tasksTotal: due?.total ?? 0,
    newFeedback: counts.new ?? 0,
    url: `${base}/app/calendar`,
  }
}

// ---------------------------------------------------------------------------
// Task buttons (Done, Tomorrow and their Undo in the bot's /today)
// ---------------------------------------------------------------------------

export const taskActionInput = z
  .object({
    id: z.uuid(),
    action: z.enum(["complete", "reopen", "postpone", "schedule"]),
    /** schedule only (the Undo of postpone): YYYY-MM-DD, or null for no date. */
    dueDate: z.iso.date().nullable().optional(),
  })
  .refine((v) => v.action !== "schedule" || v.dueDate !== undefined, {
    message: "schedule needs a dueDate",
    path: ["dueDate"],
  })

export type TaskSnapshot = {
  id: string
  title: string
  done: boolean
  dueDate: string | null
  dueTime: string | null
  overdue: boolean
  url: string
  /** The due date before this action (what Undo puts back). */
  previousDueDate: string | null
  /** complete on a repeating task: the next occurrence's date. */
  nextDue: string | null
}

/**
 * complete / reopen: the tasks module's own actions. postpone: due tomorrow
 * (the owner's tomorrow). schedule: an explicit date, for Undo.
 */
export async function taskAction(
  { id, action, dueDate }: z.infer<typeof taskActionInput>,
  ownerTimezone: string,
  now = new Date(),
): Promise<TaskSnapshot> {
  if (!(await hasModule("tasks"))) throw new OsbotApiError(404, "gone", "Tasks are switched off.")
  const before = await runModuleAction<Task | null>("tasks", "get", { id })
  if (!before) throw new OsbotApiError(404, "gone", "That task no longer exists.")
  const local = wallClock(now, ownerTimezone)
  let nextDue: string | null = null
  if (action === "complete") {
    nextDue = (await runModuleAction<{ nextDue: string | null }>("tasks", "complete", { id })).nextDue
  } else if (action === "reopen") {
    await runModuleAction("tasks", "reopen", { id })
  } else {
    const date = action === "postpone" ? formatIsoDate(addDays(local, 1)) : (dueDate ?? null)
    await runModuleAction("tasks", "schedule", { id, dueDate: date })
  }
  const after = (await runModuleAction<Task | null>("tasks", "get", { id })) ?? before
  const today = formatIsoDate(local)
  return {
    id,
    title: after.title,
    done: after.doneAt !== null,
    dueDate: after.dueDate,
    dueTime: after.dueTime,
    overdue: after.doneAt === null && after.dueDate !== null && after.dueDate < today,
    url: `${baseUrl()}/app/tasks?task=${id}`,
    previousDueDate: before.dueDate,
    nextDue,
  }
}

// ---------------------------------------------------------------------------
// Feedback status (Mark read / Spam and their Undo on the bot's alerts)
// ---------------------------------------------------------------------------

export const feedbackStatusInput = z.object({ id: z.uuid(), status: z.enum(feedbackStatuses) })

export async function feedbackStatus({
  id,
  status,
}: z.infer<typeof feedbackStatusInput>): Promise<{ id: string; status: FeedbackStatus; previous: FeedbackStatus }> {
  const previous = await runModuleAction<FeedbackStatus | null>("feedback", "setStatus", { id, status })
  if (previous === null) throw new OsbotApiError(404, "gone", "That feedback no longer exists.")
  return { id, status, previous }
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
  const items = await runModuleAction<FeedbackItem[]>("feedback", "list", { filter: "new", limit: 50 })
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
