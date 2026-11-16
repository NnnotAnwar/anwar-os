import { sql } from "drizzle-orm"
import { boolean, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

export const ideaStatuses = ["raw", "exploring", "building", "shipped", "dropped"] as const
export type IdeaStatus = (typeof ideaStatuses)[number]

// Module: ideas. RLS, the public-read policy, triggers and grants live in
// db/modules/ideas.sql; Drizzle only describes the shape.
export const ideasIdeas = pgTable(
  "ideas_ideas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    status: text("status").$type<IdeaStatus>().notNull().default("raw"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    isPublic: boolean("is_public").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ideas_ideas_owner_status_idx").on(t.ownerId, t.status, t.updatedAt.desc()),
    check("ideas_ideas_title_length", sql`char_length(${t.title}) between 1 and 200`),
    check(
      "ideas_ideas_status_valid",
      sql`${t.status} in ('raw', 'exploring', 'building', 'shipped', 'dropped')`,
    ),
  ],
)
