import { sql } from "drizzle-orm"
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
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

// Server alerts (Ops → Server, sent by osbot): what is wrong right now and
// what the owner has been told, so every problem is announced once and its
// recovery once, across bot restarts and deploys. Rows are written by web as
// the owner (osbot calls /api/internal/osbot/ops-alerts/*); RLS and grants in
// db/modules/ops-alerts.sql.

export const opsAlertKinds = ["disk", "memory", "backup", "cert", "container", "reboot", "agent"] as const
export type OpsAlertKind = (typeof opsAlertKinds)[number]

export const opsAlertState = pgTable(
  "ops_alert_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => user.id, { onDelete: "cascade" }),
    /** Stable per problem: "disk", "cert:anwar-os.com", "container:web". */
    key: text("key").notNull(),
    kind: text("kind", { enum: opsAlertKinds }).notNull(),
    /** Is the problem there right now (as of the last check)? */
    firing: boolean("firing").notNull().default(true),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    /** When the current state (firing or resolved) began. */
    since: timestamp("since", { withTimezone: true }).notNull().defaultNow(),
    /** What the owner was last told: true = "firing" was sent, false = nothing yet or "resolved". */
    notifiedFiring: boolean("notified_firing").notNull().default(false),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ops_alert_state_owner_key").on(t.ownerId, t.key),
    check("ops_alert_state_key_format", sql`${t.key} ~ '^[a-z][a-z0-9_.:-]{0,199}$'`),
    check(
      "ops_alert_state_kind_valid",
      sql`${t.kind} in ('disk', 'memory', 'backup', 'cert', 'container', 'reboot', 'agent')`,
    ),
    check("ops_alert_state_title_length", sql`char_length(${t.title}) between 1 and 200`),
    check("ops_alert_state_detail_length", sql`char_length(${t.detail}) <= 1000`),
  ],
)

/** The owner's alert preferences: kinds switched off, and a mute for all of them. */
export const opsAlertSettings = pgTable(
  "ops_alert_settings",
  {
    ownerId: text("owner_id")
      .primaryKey()
      .default(sql`app.current_user_id()`)
      .references(() => user.id, { onDelete: "cascade" }),
    disabledKinds: text("disabled_kinds").array().$type<OpsAlertKind[]>().notNull().default(sql`'{}'::text[]`),
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "ops_alert_settings_kinds_valid",
      sql`${t.disabledKinds} <@ array['disk', 'memory', 'backup', 'cert', 'container', 'reboot', 'agent']::text[]`,
    ),
  ],
)
