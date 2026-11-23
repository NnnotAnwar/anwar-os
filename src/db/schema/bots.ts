import { sql } from "drizzle-orm"
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

// Module: bots. The registry of the owner's Telegram bots. A bot with its own
// Postgres schema (bots/<name>/) shares only stats views with os_app
// (`<schema>.stats_overview`, `.stats_daily`); osbot and the expense bot report
// through web's internal API (osbot_heartbeats, budget_bot_heartbeats).

export const botsBots = pgTable(
  "bots_bots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Without the @. */
    telegramUsername: text("telegram_username"),
    /** Compose service ops-agent knows it by (links the card to /app/ops). */
    serviceName: text("service_name"),
    /**
     * Where stats come from: "osbot" or "budget-bot" (heartbeats through web's
     * internal API), or a bot schema with stats views (bot_…).
     */
    statsSource: text("stats_source"),
    description: text("description").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bots_bots_owner_name_key").on(t.ownerId, t.name),
    index("bots_bots_owner_order_idx").on(t.ownerId, t.sortOrder, t.createdAt),
    check("bots_bots_name_length", sql`char_length(${t.name}) between 1 and 60`),
    check("bots_bots_username_format", sql`${t.telegramUsername} ~ '^[A-Za-z][A-Za-z0-9_]{3,31}$'`),
    check("bots_bots_service_format", sql`${t.serviceName} ~ '^[a-z0-9][a-z0-9_.-]{0,62}$'`),
    check("bots_bots_stats_source_format", sql`${t.statsSource} ~ '^(osbot|budget-bot|bot_[a-z0-9_]{1,40})$'`),
    check("bots_bots_description_length", sql`char_length(${t.description}) <= 300`),
  ],
)
