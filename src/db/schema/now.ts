import { sql } from "drizzle-orm"
import { boolean, check, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { user } from "./auth"

// Module: now. The public /now page ("what I'm doing now") is built from the
// owner's own data; this table only holds what the owner writes for it and
// which sections it shows. Everything here is meant to be public: the site
// owner's row is readable by visitors. RLS, the updated_at trigger, grants and
// the functions that feed the page (app.now_goals(), app.now_habits()) live in
// db/modules/now.sql; Drizzle only describes the shape.

export const NOW_INTRO_MAX = 600
export const NOW_LOCATION_MAX = 80

/** One row per user (in practice: the site owner). No row = the defaults below. */
export const nowSettings = pgTable(
  "now_settings",
  {
    ownerId: text("owner_id")
      .primaryKey()
      .default(sql`app.current_user_id()`)
      .references(() => user.id, { onDelete: "cascade" }),
    /** A line or two in the owner's words, at the top of the page. */
    intro: text("intro").notNull().default(""),
    /** "Prague, Czech Republic". Empty: the published CV's location. */
    location: text("location").notNull().default(""),
    /** This year's goals marked "Show on /now" (goals_goals.show_on_now). */
    showGoals: boolean("show_goals").notNull().default(true),
    /** Public projects in progress, then featured ones. */
    showProjects: boolean("show_projects").notNull().default(true),
    /** The latest published notes. */
    showWriting: boolean("show_writing").notNull().default(true),
    /** Habits as one aggregate line (how many, longest current streak). Never names. */
    showHabits: boolean("show_habits").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("now_settings_intro_length", sql`char_length(${t.intro}) <= ${sql.raw(String(NOW_INTRO_MAX))}`),
    check("now_settings_location_length", sql`char_length(${t.location}) <= ${sql.raw(String(NOW_LOCATION_MAX))}`),
  ],
)
