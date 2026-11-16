import { sql } from "drizzle-orm"
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

export const projectStatuses = ["idea", "building", "live", "paused", "archived"] as const
export type ProjectStatus = (typeof projectStatuses)[number]

// Module: projects. RLS, the public-read policy, triggers and grants live in
// db/modules/projects.sql; Drizzle only describes the shape.
export const projectsProjects = pgTable(
  "projects_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    summary: text("summary").notNull().default(""),
    body: text("body").notNull().default(""),
    status: text("status").$type<ProjectStatus>().notNull().default("building"),
    role: text("role").notNull().default(""),
    stack: text("stack").array().notNull().default(sql`'{}'::text[]`),
    liveUrl: text("live_url"),
    repoUrl: text("repo_url"),
    demoUrl: text("demo_url"),
    coverUrl: text("cover_url"),
    featured: boolean("featured").notNull().default(false),
    isPublic: boolean("is_public").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("projects_projects_owner_slug_key").on(t.ownerId, t.slug),
    index("projects_projects_owner_order_idx").on(t.ownerId, t.sortOrder, t.createdAt.desc()),
    check("projects_projects_title_length", sql`char_length(${t.title}) between 1 and 120`),
    check("projects_projects_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(${t.slug}) <= 80`),
    check(
      "projects_projects_status_valid",
      sql`${t.status} in ('idea', 'building', 'live', 'paused', 'archived')`,
    ),
  ],
)
