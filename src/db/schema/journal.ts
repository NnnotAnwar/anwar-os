import { sql } from "drizzle-orm"
import { boolean, check, date, pgTable, smallint, text, time, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

// Module: journal. RLS, triggers, grants and the search index live in
// db/modules/journal.sql; Drizzle only describes the shape.

const ownerId = () =>
  text("owner_id")
    .notNull()
    .default(sql`app.current_user_id()`)
    .references(() => user.id, { onDelete: "cascade" })

/**
 * One line a day with an optional mood (1 = bad … 5 = great). One row per
 * owner and day; a day with neither a mood nor a line has no row at all.
 */
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    day: date("day").notNull(),
    mood: smallint("mood"),
    text: text("text").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Also the index for list queries (owner, day range, newest first).
    unique("journal_entries_owner_day_key").on(t.ownerId, t.day),
    check("journal_entries_mood_range", sql`${t.mood} between 1 and 5`),
    check("journal_entries_text_length", sql`char_length(${t.text}) <= 500`),
    check("journal_entries_not_empty", sql`${t.mood} is not null or char_length(${t.text}) > 0`),
  ],
)

/** Per-owner settings: osbot's evening question ("How was today?"), on by default at 21:30. */
export const journalSettings = pgTable("journal_settings", {
  ownerId: ownerId().primaryKey(),
  promptEnabled: boolean("prompt_enabled").notNull().default(true),
  promptTime: time("prompt_time").notNull().default("21:30"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
