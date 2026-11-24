import { sql } from "drizzle-orm"
import { boolean, check, date, foreignKey, index, integer, pgTable, text, time, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

// Module: habits. RLS, triggers and grants live in db/modules/habits.sql;
// Drizzle only describes the shape.

const ownerId = () =>
  text("owner_id")
    .notNull()
    .default(sql`app.current_user_id()`)
    .references(() => user.id, { onDelete: "cascade" })

/**
 * A habit: something done on chosen weekdays (`weekdays`, a Monday-first bit
 * mask). `reminder_time` is an optional daily nudge from osbot at that time
 * (the owner's clock) when the habit isn't checked yet; `last_reminded_on`
 * keeps it to once a day. Archived habits keep their history.
 */
export const habitsHabits = pgTable(
  "habits_habits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    name: text("name").notNull(),
    emoji: text("emoji").notNull().default(""),
    // Bit 0 = Monday … bit 6 = Sunday; 127 = every day.
    weekdays: integer("weekdays").notNull().default(127),
    reminderTime: time("reminder_time"),
    lastRemindedOn: date("last_reminded_on"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The target of habits_checks' (owner_id, habit_id) foreign key.
    unique("habits_habits_owner_id_key").on(t.ownerId, t.id),
    index("habits_habits_owner_order_idx").on(t.ownerId, t.sortOrder),
    check("habits_habits_name_length", sql`char_length(${t.name}) between 1 and 80`),
    check("habits_habits_emoji_length", sql`char_length(${t.emoji}) <= 16`),
    check("habits_habits_weekdays_range", sql`${t.weekdays} between 1 and 127`),
  ],
)

/** One row per habit per day it was done. Unchecking deletes the row. */
export const habitsChecks = pgTable(
  "habits_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    habitId: uuid("habit_id").notNull(),
    day: date("day").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // With owner_id in the key, a check can only point at the owner's own habit.
    foreignKey({
      name: "habits_checks_habit_fk",
      columns: [t.ownerId, t.habitId],
      foreignColumns: [habitsHabits.ownerId, habitsHabits.id],
    }).onDelete("cascade"),
    unique("habits_checks_habit_day_key").on(t.habitId, t.day),
    index("habits_checks_owner_day_idx").on(t.ownerId, t.day),
  ],
)

/** Per-owner settings: osbot's evening nudge listing habits still open today. */
export const habitsSettings = pgTable(
  "habits_settings",
  {
    ownerId: ownerId().primaryKey(),
    nudgeEnabled: boolean("nudge_enabled").notNull().default(false),
    nudgeTime: time("nudge_time").notNull().default("21:00"),
    lastNudgedOn: date("last_nudged_on"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
)
