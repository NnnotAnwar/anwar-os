import { sql } from "drizzle-orm"
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

export const inboxSources = ["app", "share", "telegram", "api"] as const
export type InboxSource = (typeof inboxSources)[number]

/** What an item became when it was processed. */
export const inboxOutcomes = ["task", "note", "link", "idea", "event"] as const
export type InboxOutcome = (typeof inboxOutcomes)[number]

// Module: inbox. Quick capture of anything; processed later into another
// module's entity. RLS, triggers and grants live in db/modules/inbox.sql.
export const inboxItems = pgTable(
  "inbox_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => user.id, { onDelete: "cascade" }),
    text: text("text").notNull().default(""),
    url: text("url"),
    source: text("source").$type<InboxSource>().notNull().default("app"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processedAs: text("processed_as").$type<InboxOutcome>(),
    /** Id of the entity the item became (a task, note, …), when there is one. */
    processedRef: uuid("processed_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inbox_items_owner_open_idx").on(t.ownerId, t.createdAt).where(sql`${t.processedAt} is null`),
    index("inbox_items_owner_processed_idx").on(t.ownerId, t.processedAt.desc()),
    check("inbox_items_text_length", sql`char_length(${t.text}) <= 10000`),
    check("inbox_items_url_shape", sql`${t.url} is null or (char_length(${t.url}) <= 2000 and ${t.url} ~* '^https?://')`),
    check("inbox_items_not_empty", sql`char_length(btrim(${t.text})) > 0 or ${t.url} is not null`),
    check("inbox_items_source_valid", sql`${t.source} in ('app', 'share', 'telegram', 'api')`),
    check(
      "inbox_items_outcome_valid",
      sql`${t.processedAs} is null or ${t.processedAs} in ('task', 'note', 'link', 'idea', 'event')`,
    ),
    check("inbox_items_processed_consistent", sql`(${t.processedAt} is null) = (${t.processedAs} is null)`),
  ],
)
