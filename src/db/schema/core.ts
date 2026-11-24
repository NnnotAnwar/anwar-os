import { sql } from "drizzle-orm"
import { check, doublePrecision, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { user } from "./auth"

// Per-user shell preferences. One row per user; RLS in db/migrations/*_core_preferences_rls.sql
// (table-level policies and grants, so new columns are covered too).
export const corePreferences = pgTable(
  "core_preferences",
  {
    ownerId: text("owner_id")
      .primaryKey()
      .default(sql`app.current_user_id()`)
      .references(() => user.id, { onDelete: "cascade" }),
    /** Module ids the owner chose for "My services", in display order. */
    pinnedServices: text("pinned_services").array().notNull().default(sql`'{}'::text[]`),
    /** One-off hints the owner closed (e.g. "get-started"). */
    dismissedHints: text("dismissed_hints").array().notNull().default(sql`'{}'::text[]`),

    /** Appearance (src/components/theme): system, light, dark or scheduled. */
    themeMode: text("theme_mode").notNull().default("system"),
    /** What "scheduled" follows: fixed hours, or sunset to sunrise at theme_lat/lon. */
    themeSchedule: text("theme_schedule").notNull().default("hours"),
    /** Local wall-clock times, HH:MM: dark from … until … (may cross midnight). */
    themeDarkFrom: text("theme_dark_from").notNull().default("20:00"),
    themeDarkUntil: text("theme_dark_until").notNull().default("07:00"),
    /** Approximate place for sunset/sunrise (one decimal is enough), and its label. */
    themeLat: doublePrecision("theme_lat"),
    themeLon: doublePrecision("theme_lon"),
    themePlace: text("theme_place"),

    /** Today widgets ("module:widget") in the owner's order; unknown ids are ignored. */
    todayOrder: text("today_order").array().notNull().default(sql`'{}'::text[]`),
    /** Today widgets the owner hid. */
    todayHidden: text("today_hidden").array().notNull().default(sql`'{}'::text[]`),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("core_preferences_theme_mode", sql`${t.themeMode} in ('system', 'light', 'dark', 'scheduled')`),
    check("core_preferences_theme_schedule", sql`${t.themeSchedule} in ('hours', 'sun')`),
    check(
      "core_preferences_theme_hours",
      sql`${t.themeDarkFrom} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ${t.themeDarkUntil} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      "core_preferences_theme_place",
      sql`(${t.themeLat} is null) = (${t.themeLon} is null)
        and (${t.themeLat} is null or (${t.themeLat} between -90 and 90 and ${t.themeLon} between -180 and 180))
        and (${t.themePlace} is null or length(${t.themePlace}) <= 80)`,
    ),
    check("core_preferences_theme_sun_place", sql`${t.themeSchedule} <> 'sun' or ${t.themeLat} is not null`),
    check("core_preferences_today_size", sql`cardinality(${t.todayOrder}) <= 100 and cardinality(${t.todayHidden}) <= 100`),
  ],
)
