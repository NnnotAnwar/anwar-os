import { sql } from "drizzle-orm"
import { pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { user } from "./auth"

// Per-user shell preferences. One row per user; RLS in db/migrations/*_core_preferences_rls.sql.
export const corePreferences = pgTable("core_preferences", {
  ownerId: text("owner_id")
    .primaryKey()
    .default(sql`app.current_user_id()`)
    .references(() => user.id, { onDelete: "cascade" }),
  /** Module ids the owner chose for "My services", in display order. */
  pinnedServices: text("pinned_services").array().notNull().default(sql`'{}'::text[]`),
  /** One-off hints the owner closed (e.g. "get-started"). */
  dismissedHints: text("dismissed_hints").array().notNull().default(sql`'{}'::text[]`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
