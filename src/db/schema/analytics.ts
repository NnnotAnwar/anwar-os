import { sql } from "drizzle-orm"
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, date } from "drizzle-orm/pg-core"
import { user } from "./auth"

export const analyticsDevices = ["desktop", "mobile", "tablet"] as const
export type AnalyticsDevice = (typeof analyticsDevices)[number]

// Module: analytics. Cookie-free page views of the public site, kept only as
// daily counters: no IP address, no user agent, no visitor id. Rows are written
// by app.record_page_view() (security definer, db/modules/analytics.sql) for
// the site owner; os_app may only read its own rows.
export const analyticsDaily = pgTable(
  "analytics_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** UTC day. */
    day: date("day").notNull(),
    /** A known public route, e.g. /projects/planuj-smeny. */
    path: text("path").notNull(),
    /** Host of an external referrer, '' for direct or unknown. */
    referrerHost: text("referrer_host").notNull().default(""),
    device: text("device").$type<AnalyticsDevice>().notNull(),
    /** ISO 3166-1 alpha-2 from an edge header, '' when there is none. */
    country: text("country").notNull().default(""),
    views: integer("views").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("analytics_daily_bucket_key").on(t.ownerId, t.day, t.path, t.referrerHost, t.device, t.country),
    index("analytics_daily_owner_day_idx").on(t.ownerId, t.day.desc()),
    check("analytics_daily_device_valid", sql`${t.device} in ('desktop', 'mobile', 'tablet')`),
    check("analytics_daily_path_length", sql`char_length(${t.path}) between 1 and 120`),
    check("analytics_daily_referrer_length", sql`char_length(${t.referrerHost}) <= 253`),
    check("analytics_daily_country_format", sql`${t.country} = '' or ${t.country} ~ '^[A-Z]{2}$'`),
    check("analytics_daily_views_positive", sql`${t.views} >= 0`),
  ],
)

/**
 * Global write budget per minute for app.record_page_view(): a flood of fake
 * views is dropped once the minute's budget is spent. No per-visitor data.
 * RLS on, no policies, no grants: only the function touches it.
 */
export const analyticsRate = pgTable("analytics_rate", {
  minute: timestamp("minute", { withTimezone: true }).primaryKey(),
  hits: integer("hits").notNull().default(0),
})
