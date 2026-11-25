import { sql } from "drizzle-orm"
import { boolean, check, doublePrecision, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"
import { projectsProjects } from "./projects"
import { tasksTasks } from "./tasks"

export const goalStatuses = ["active", "done", "dropped"] as const
export type GoalStatus = (typeof goalStatuses)[number]

const ownerId = () =>
  text("owner_id")
    .notNull()
    .default(sql`app.current_user_id()`)
    .references(() => user.id, { onDelete: "cascade" })

// Module: goals. RLS (including "a link can only point at your own goal, task
// and project"), triggers and grants live in db/modules/goals.sql; Drizzle only
// describes the shape. Goals have no public read policy: /now gets the ones
// marked show_on_now, and only a few safe columns of them, through
// app.now_goals() (db/modules/now.sql).

/**
 * A goal for one calendar year. A measurable goal has a target ("20 books")
 * and a current value the owner moves by hand; otherwise its progress is the
 * share of its linked tasks that are done (goals_links).
 */
export const goalsGoals = pgTable(
  "goals_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    year: integer("year").notNull(),
    title: text("title").notNull(),
    why: text("why").notNull().default(""),
    targetValue: doublePrecision("target_value"),
    targetUnit: text("target_unit").notNull().default(""),
    currentValue: doublePrecision("current_value").notNull().default(0),
    status: text("status").$type<GoalStatus>().notNull().default("active"),
    sortOrder: doublePrecision("sort_order").notNull().default(0),
    /** Listed on the public /now page while it's this year's goal. Off unless the owner turns it on. */
    showOnNow: boolean("show_on_now").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("goals_goals_owner_year_idx").on(t.ownerId, t.year, t.sortOrder),
    check("goals_goals_title_length", sql`char_length(${t.title}) between 1 and 120`),
    check("goals_goals_why_length", sql`char_length(${t.why}) <= 1000`),
    check("goals_goals_unit_length", sql`char_length(${t.targetUnit}) <= 30`),
    check("goals_goals_year_range", sql`${t.year} between 2000 and 2100`),
    check("goals_goals_target_positive", sql`${t.targetValue} is null or ${t.targetValue} > 0`),
    check("goals_goals_current_nonnegative", sql`${t.currentValue} >= 0`),
    check("goals_goals_status_valid", sql`${t.status} in ('active', 'done', 'dropped')`),
  ],
)

/** A task or a project counted towards a goal. Each one belongs to at most one goal. */
export const goalsLinks = pgTable(
  "goals_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goalsGoals.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasksTasks.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projectsProjects.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("goals_links_goal_idx").on(t.goalId),
    uniqueIndex("goals_links_task_key").on(t.taskId).where(sql`${t.taskId} is not null`),
    uniqueIndex("goals_links_project_key").on(t.projectId).where(sql`${t.projectId} is not null`),
    check("goals_links_one_target", sql`num_nonnulls(${t.taskId}, ${t.projectId}) = 1`),
  ],
)
