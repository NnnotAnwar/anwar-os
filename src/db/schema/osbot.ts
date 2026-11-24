import { sql } from "drizzle-orm"
import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"
import { calendarEvents } from "./calendar"
import { feedbackItems } from "./feedback"

// osbot: the platform's own Telegram bot (bots/osbot). The bot never connects to
// Postgres; it calls /api/internal/osbot/*, which acts as the site owner through
// withViewer(), so these tables follow the usual owner-scoped RLS.
// Triggers, RLS and grants: db/modules/osbot.sql.

const ownerId = () =>
  text("owner_id")
    .notNull()
    .default(sql`app.current_user_id()`)
    .references(() => user.id, { onDelete: "cascade" })

/** The bot's last sign of life (one row per owner), shown in Settings → Telegram. */
export const osbotHeartbeats = pgTable(
  "osbot_heartbeats",
  {
    ownerId: ownerId().primaryKey(),
    version: text("version").notNull().default("dev"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    lastBeatAt: timestamp("last_beat_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("osbot_heartbeats_version_length", sql`char_length(${t.version}) between 1 and 80`)],
)

/**
 * One row per reminder notification the bot has sent, so polling is idempotent.
 * Keyed by event + occurrence start + minutes before: reminder rows are replaced
 * whenever an event is saved, so their ids are not stable, but "30 minutes before
 * the 14:00 occurrence" is. Moving an event to another time makes a new key, so
 * the moved occurrence is reminded again.
 */
export const calendarReminderDeliveries = pgTable(
  "calendar_reminder_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    eventId: uuid("event_id").notNull(),
    occurrenceStart: timestamp("occurrence_start", { withTimezone: true }).notNull(),
    minutesBefore: integer("minutes_before").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "calendar_reminder_deliveries_event_fk",
      columns: [t.ownerId, t.eventId],
      foreignColumns: [calendarEvents.ownerId, calendarEvents.id],
    }).onDelete("cascade"),
    unique("calendar_reminder_deliveries_key").on(t.eventId, t.occurrenceStart, t.minutesBefore),
    index("calendar_reminder_deliveries_owner_delivered_idx").on(t.ownerId, t.deliveredAt),
    check("calendar_reminder_deliveries_minutes_range", sql`${t.minutesBefore} between 0 and 40320`),
  ],
)

/** New feedback the owner has already been told about (by osbot or the web's direct notify). */
export const osbotFeedbackAlerts = pgTable(
  "osbot_feedback_alerts",
  {
    feedbackId: uuid("feedback_id")
      .primaryKey()
      .references(() => feedbackItems.id, { onDelete: "cascade" }),
    ownerId: ownerId(),
    channel: text("channel", { enum: ["osbot", "direct"] }).notNull().default("osbot"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("osbot_feedback_alerts_channel_valid", sql`${t.channel} in ('osbot', 'direct')`)],
)

export const osbotDeliveryKinds = ["payment", "weekly", "budget-limit", "monthly"] as const
export type OsbotDeliveryKind = (typeof osbotDeliveryKinds)[number]

/**
 * Digests osbot has already sent, so its scheduled messages go out once even
 * when the bot restarts: "payment" = the reminder the day before a recurring
 * charge (key `<recurring id>:<charge date>`), "weekly" = the Sunday review
 * (key = the week's Monday, `2026-11-16`), "budget-limit" = a Budget category
 * reaching 90 % or 100 % of its monthly limit (key `<category id>:<YYYY-MM>:<90|100>`),
 * "monthly" = the report on the 1st (key = the reported month, `2026-10`).
 * Pruned after 60 days.
 */
export const osbotDeliveries = pgTable(
  "osbot_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    kind: text("kind", { enum: osbotDeliveryKinds }).notNull(),
    key: text("key").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("osbot_deliveries_key").on(t.ownerId, t.kind, t.key),
    index("osbot_deliveries_owner_delivered_idx").on(t.ownerId, t.deliveredAt),
    check("osbot_deliveries_kind_valid", sql`${t.kind} in ('payment', 'weekly', 'budget-limit', 'monthly')`),
    check("osbot_deliveries_key_length", sql`char_length(${t.key}) between 1 and 120`),
  ],
)
