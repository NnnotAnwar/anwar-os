import { timingSafeEqual } from "node:crypto"
import { sql } from "drizzle-orm"
import { db, withViewer } from "@/db"
import { feedEventsFor } from "../actions"
import { categoryInfo } from "../lib/categories"
import { serializeCalendar } from "../lib/ics"

const FEED = /^([A-Za-z0-9_-]{43})\.ics$/

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } })

/**
 * GET /api/calendar/<token>.ics — the private subscription feed. No session:
 * calendar apps fetch it on their own. The token's selector is looked up
 * through a security-definer function, the full token is compared in constant
 * time, and events are then read as their owner through RLS.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/calendar/[feed]">) {
  const { feed } = await ctx.params
  const match = FEED.exec(feed)
  if (!match) return notFound()
  const token = match[1]!

  const rows = await db.execute<{ owner_id: string; token: string }>(
    sql`select owner_id, token from app.calendar_feed_lookup(${token.slice(0, 12)})`,
  )
  const row = rows[0]
  const given = Buffer.from(token)
  const stored = Buffer.from(row?.token ?? "".padEnd(token.length, "\0"))
  // Compare even when nothing matched, so both paths take the same time.
  const valid = stored.length === given.length && timingSafeEqual(stored, given) && row !== undefined
  if (!valid) return notFound()

  const { events, reminders } = await withViewer(row.owner_id, feedEventsFor)
  const byEvent = new Map<string, number[]>()
  for (const r of reminders) byEvent.set(r.eventId, [...(byEvent.get(r.eventId) ?? []), r.minutes])

  const host = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost").hostname
  const body = serializeCalendar({
    name: "anwar.os",
    host,
    now: new Date(),
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      notes: e.notes,
      location: e.location,
      category: categoryInfo[e.category].label,
      start: e.startAt,
      end: e.endAt,
      allDay: e.allDay,
      timezone: e.timezone,
      rrule: e.rrule,
      reminders: (byEvent.get(e.id) ?? []).sort((a, b) => a - b),
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    })),
  })

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="anwar-os.ics"',
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  })
}
