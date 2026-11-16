import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"
import { user } from "./auth"

// Module: calendar. One implicit calendar per user; categories are a fixed set.
// RLS policies, triggers, grants and the feed-token lookup live in
// db/modules/calendar.sql.

export const calendarCategories = ["personal", "work", "health", "social", "travel", "birthday", "deadline"] as const
export type CalendarCategory = (typeof calendarCategories)[number]

const ownerId = () =>
  text("owner_id")
    .notNull()
    .default(sql`app.current_user_id()`)
    .references(() => user.id, { onDelete: "cascade" })

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Timed events: start/end are instants; `timezone` is the IANA zone recurrence
 * expands in (so "every Monday 09:00" stays 09:00 across DST).
 * All-day events: start/end are UTC midnights of the first day and the day
 * after the last (exclusive), i.e. floating dates independent of any zone.
 * `rrule` holds an RFC 5545 RRULE subset (see modules/calendar/lib/recurrence.ts);
 * instances are expanded on read, never stored.
 */
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    location: text("location").notNull().default(""),
    category: text("category", { enum: calendarCategories }).notNull().default("personal"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    timezone: text("timezone").notNull().default("Europe/Prague"),
    rrule: text("rrule"),
    ...timestamps(),
  },
  (t) => [
    unique("calendar_events_owner_id_key").on(t.ownerId, t.id),
    index("calendar_events_owner_start_idx").on(t.ownerId, t.startAt),
    check("calendar_events_title_length", sql`char_length(${t.title}) between 1 and 200`),
    check("calendar_events_notes_length", sql`char_length(${t.notes}) <= 10000`),
    check("calendar_events_location_length", sql`char_length(${t.location}) <= 300`),
    check("calendar_events_rrule_length", sql`char_length(${t.rrule}) <= 300`),
    check("calendar_events_timezone_length", sql`char_length(${t.timezone}) between 1 and 64`),
    check("calendar_events_ends_after_start", sql`${t.endAt} >= ${t.startAt}`),
    check(
      "calendar_events_category_valid",
      sql`${t.category} in ('personal', 'work', 'health', 'social', 'travel', 'birthday', 'deadline')`,
    ),
  ],
)

export const calendarReminders = pgTable(
  "calendar_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    eventId: uuid("event_id").notNull(),
    minutesBefore: integer("minutes_before").notNull(),
    ...timestamps(),
  },
  (t) => [
    // Composite key: a reminder can only hang off an event of the same owner.
    foreignKey({
      name: "calendar_reminders_event_fk",
      columns: [t.ownerId, t.eventId],
      foreignColumns: [calendarEvents.ownerId, calendarEvents.id],
    }).onDelete("cascade"),
    unique("calendar_reminders_event_minutes_key").on(t.eventId, t.minutesBefore),
    index("calendar_reminders_owner_event_idx").on(t.ownerId, t.eventId),
    check("calendar_reminders_minutes_range", sql`${t.minutesBefore} between 0 and 40320`),
  ],
)

/**
 * Secret for the private ICS feed. Split token: `selector` (first 12 chars) is
 * looked up, then the full token is compared in constant time in the app.
 * Stored readable so the owner can copy the URL again; it only grants read
 * access to rows in this same database.
 */
export const calendarFeedTokens = pgTable(
  "calendar_feed_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId().unique("calendar_feed_tokens_owner_key"),
    selector: text("selector").notNull().unique("calendar_feed_tokens_selector_key"),
    token: text("token").notNull(),
    ...timestamps(),
  },
  (t) => [
    check("calendar_feed_tokens_token_shape", sql`${t.token} ~ '^[A-Za-z0-9_-]{43}$'`),
    check("calendar_feed_tokens_selector_prefix", sql`starts_with(${t.token}, ${t.selector})`),
  ],
)
