import { sql } from "drizzle-orm"
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

// Module: ops. The audit trail of the control panel: every start / stop /
// restart / deploy web asks ops-agent for, who asked and how it ended.
// Append-only for the app: rows are inserted as "pending" (or with a final
// result) and a pending row can be finalized once; nothing is ever deleted
// (db/modules/ops.sql).

export const opsActions = ["start", "stop", "restart", "deploy"] as const
export type OpsAction = (typeof opsActions)[number]

export const opsResults = ["pending", "ok", "error", "refused"] as const
export type OpsResult = (typeof opsResults)[number]

export type OpsEventDetail = {
  tag?: string
  previousTag?: string
  rolledBack?: boolean
  /** The action that this one undid (Undo after restart/start). */
  undoOf?: string
}

export const opsEvents = pgTable(
  "ops_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => user.id, { onDelete: "cascade" }),
    /** Display name or email at the time, so the trail survives renames. */
    actor: text("actor").notNull().default(""),
    service: text("service").notNull(),
    action: text("action", { enum: opsActions }).notNull(),
    detail: jsonb("detail").$type<OpsEventDetail>().notNull().default({}),
    result: text("result", { enum: opsResults }).notNull().default("pending"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ops_events_owner_created_idx").on(t.ownerId, t.createdAt.desc()),
    index("ops_events_owner_service_idx").on(t.ownerId, t.service, t.createdAt.desc()),
    check("ops_events_action_valid", sql`${t.action} in ('start', 'stop', 'restart', 'deploy')`),
    check("ops_events_result_valid", sql`${t.result} in ('pending', 'ok', 'error', 'refused')`),
    check("ops_events_service_format", sql`${t.service} ~ '^[a-z0-9][a-z0-9_.-]{0,62}$'`),
    check("ops_events_actor_length", sql`char_length(${t.actor}) <= 200`),
    check("ops_events_error_length", sql`char_length(${t.error}) <= 2000`),
  ],
)
