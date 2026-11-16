import "server-only"
import { randomBytes } from "node:crypto"
import { z } from "zod"
import { and, asc, eq, gte, ilike, inArray, isNotNull, lt, or } from "drizzle-orm"
import { asViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import type { Tx } from "@/db"
import { calendarEvents, calendarFeedTokens, calendarReminders } from "@/db/schema"
import { likeContains } from "@/lib/sql-like"
import { describeRecurrence, expandEvent, parseRRule } from "./lib/recurrence"
import {
  createEventInput,
  eventIdInput,
  rangeInput,
  searchEventsInput,
  toEventFields,
  toEventRow,
  updateEventInput,
  type EventDetail,
  type FeedInfo,
  type Occurrence,
} from "./schema"

type EventRecord = typeof calendarEvents.$inferSelect

/** Instances of `events` overlapping [from, to), in start order. */
export function occurrencesOf(events: EventRecord[], from: Date, to: Date): Occurrence[] {
  const out: Occurrence[] = []
  for (const e of events) {
    const instances = expandEvent(
      { start: e.startAt, end: e.endAt, allDay: e.allDay, timezone: e.timezone, rrule: e.rrule },
      from,
      to,
    )
    for (const i of instances) {
      out.push({
        key: `${e.id}:${i.start.toISOString()}`,
        eventId: e.id,
        title: e.title,
        location: e.location,
        category: e.category,
        start: i.start.toISOString(),
        end: i.end.toISOString(),
        allDay: e.allDay,
        timezone: e.timezone,
        recurring: e.rrule !== null,
      })
    }
  }
  // All-day first within the same start, then by start, then title.
  return out.sort(
    (a, b) => a.start.localeCompare(b.start) || Number(b.allDay) - Number(a.allDay) || a.title.localeCompare(b.title),
  )
}

/** Events that could overlap [from, to): one-offs that do, and every series that started before `to`. */
async function eventsIn(tx: Tx, from: Date, to: Date) {
  return tx
    .select()
    .from(calendarEvents)
    .where(
      and(
        lt(calendarEvents.startAt, to),
        or(isNotNull(calendarEvents.rrule), gte(calendarEvents.endAt, from)),
      ),
    )
}

async function replaceReminders(tx: Tx, eventId: string, minutes: number[]) {
  await tx.delete(calendarReminders).where(eq(calendarReminders.eventId, eventId))
  const unique = [...new Set(minutes)]
  if (unique.length) {
    await tx.insert(calendarReminders).values(unique.map((minutesBefore) => ({ eventId, minutesBefore })))
  }
}

function newToken() {
  const token = randomBytes(32).toString("base64url")
  return { token, selector: token.slice(0, 12) }
}

export function feedUrl(token: string) {
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")
  return `${base}/api/calendar/${token}.ics`
}

// Every action runs through asViewer(), so RLS scopes it to the signed-in user.
export const actions = {
  range: defineAction({
    description:
      "List the user's calendar between two instants, with recurring events expanded into individual occurrences (each with start, end, all-day flag and category).",
    kind: "read",
    input: rangeInput,
    handler: ({ from, to }): Promise<Occurrence[]> =>
      asViewer(async (tx) => occurrencesOf(await eventsIn(tx, from, to), from, to)),
  }),
  get: defineAction({
    description: "Get one event with its full details, repeat rule and reminders. Null if it doesn't exist.",
    kind: "read",
    input: eventIdInput,
    handler: ({ id }): Promise<EventDetail | null> =>
      asViewer(async (tx) => {
        const [row] = await tx.select().from(calendarEvents).where(eq(calendarEvents.id, id))
        if (!row) return null
        const reminders = await tx
          .select({ minutes: calendarReminders.minutesBefore })
          .from(calendarReminders)
          .where(eq(calendarReminders.eventId, id))
        const rule = parseRRule(row.rrule)
        return {
          id: row.id,
          ...toEventFields({ ...row, reminders: reminders.map((r) => r.minutes) }),
          recurrenceText: rule ? describeRecurrence(rule, "en", row.allDay, row.timezone) : null,
        }
      }),
  }),
  create: defineAction({
    description:
      "Create an event. Dates are YYYY-MM-DD and times HH:MM in the given IANA time zone; all-day events omit times. Optional repeat (daily/weekly/monthly/yearly, interval, weekdays, end) and reminders in minutes before the start.",
    kind: "write",
    input: createEventInput,
    handler: (fields): Promise<{ id: string }> =>
      asViewer(async (tx) => {
        const [row] = await tx.insert(calendarEvents).values(toEventRow(fields)).returning({ id: calendarEvents.id })
        await replaceReminders(tx, row!.id, fields.reminders)
        return { id: row!.id }
      }),
  }),
  update: defineAction({
    description: "Replace an event's details. For a repeating event the change applies to every occurrence.",
    kind: "write",
    input: updateEventInput,
    handler: ({ id, ...fields }): Promise<void> =>
      asViewer(async (tx) => {
        const rows = await tx.update(calendarEvents).set(toEventRow(fields)).where(eq(calendarEvents.id, id)).returning({ id: calendarEvents.id })
        if (!rows.length) throw new Error("Event not found")
        await replaceReminders(tx, id, fields.reminders)
      }),
  }),
  delete: defineAction({
    description: "Permanently delete an event (all occurrences of a repeating one).",
    kind: "write",
    input: eventIdInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.delete(calendarEvents).where(eq(calendarEvents.id, id))
      }),
  }),
  search: defineAction({
    description: "Find events by text in the title, location or notes. Returns each with its next occurrence from now (or its last one).",
    kind: "read",
    input: searchEventsInput,
    handler: ({ query, limit }): Promise<(Occurrence & { notes: string })[]> =>
      asViewer(async (tx) => {
        const pattern = likeContains(query)
        const rows = await tx
          .select()
          .from(calendarEvents)
          .where(or(ilike(calendarEvents.title, pattern), ilike(calendarEvents.location, pattern), ilike(calendarEvents.notes, pattern)))
          .orderBy(asc(calendarEvents.startAt))
          .limit(limit)
        const now = new Date()
        const yearAhead = new Date(now.getTime() + 400 * 86_400_000)
        return rows.map((e) => {
          const next = occurrencesOf([e], now, yearAhead)[0] ?? occurrencesOf([{ ...e, rrule: null }], e.startAt, new Date(e.endAt.getTime() + 1))[0]
          return { ...next!, notes: e.notes }
        })
      }),
  }),

  getFeed: defineAction({
    description: "The user's private ICS subscription URL, or null if they haven't created one.",
    kind: "read",
    input: z.object({}),
    handler: (): Promise<FeedInfo> =>
      asViewer(async (tx) => {
        const [row] = await tx.select().from(calendarFeedTokens)
        return row ? { url: feedUrl(row.token), createdAt: row.updatedAt.toISOString() } : null
      }),
  }),
  rotateFeed: defineAction({
    description: "Create the private ICS feed URL, or replace it with a new one (the old URL stops working).",
    kind: "write",
    input: z.object({}),
    handler: (): Promise<FeedInfo> =>
      asViewer(async (tx) => {
        const { token, selector } = newToken()
        const [row] = await tx
          .insert(calendarFeedTokens)
          .values({ token, selector })
          .onConflictDoUpdate({ target: calendarFeedTokens.ownerId, set: { token, selector } })
          .returning()
        return { url: feedUrl(row!.token), createdAt: row!.updatedAt.toISOString() }
      }),
  }),
  disableFeed: defineAction({
    description: "Turn the private ICS feed off; its URL stops working.",
    kind: "write",
    input: z.object({}),
    handler: (): Promise<void> =>
      asViewer(async (tx) => {
        await tx.delete(calendarFeedTokens)
      }),
  }),
}

/** All events and their reminders for the ICS feed, read as `ownerId` through RLS. */
export async function feedEventsFor(tx: Tx) {
  const events = await tx.select().from(calendarEvents).orderBy(asc(calendarEvents.startAt))
  const reminders = events.length
    ? await tx
        .select({ eventId: calendarReminders.eventId, minutes: calendarReminders.minutesBefore })
        .from(calendarReminders)
        .where(inArray(calendarReminders.eventId, events.map((e) => e.id)))
    : []
  return { events, reminders }
}
