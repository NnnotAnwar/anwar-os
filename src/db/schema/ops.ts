import { sql } from "drizzle-orm"
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
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

export const opsAlertKinds = ["disk", "memory", "backup", "cert", "container", "reboot", "agent", "files", "errors", "drill"] as const
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
      sql`${t.kind} in ('disk', 'memory', 'backup', 'cert', 'container', 'reboot', 'agent', 'files', 'errors', 'drill')`,
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
      sql`${t.disabledKinds} <@ array['disk', 'memory', 'backup', 'cert', 'container', 'reboot', 'agent', 'files', 'errors', 'drill']::text[]`,
    ),
  ],
)

// Files storage check (Ops → Server → Files storage): the last comparison of
// the Files rows with the objects in the bucket, one row per owner, replaced
// by every run (weekly from osbot, or "Check now"). The findings are capped
// lists (see src/modules/ops/lib/files-check.ts); RLS, grants and the
// owner-only inventory function in db/modules/ops-files-check.sql.

export const opsFilesCheckStatuses = ["ok", "problems", "error"] as const
export type OpsFilesCheckStatus = (typeof opsFilesCheckStatuses)[number]

export const opsFilesCheck = pgTable(
  "ops_files_check",
  {
    ownerId: text("owner_id")
      .primaryKey()
      .default(sql`app.current_user_id()`)
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", { enum: opsFilesCheckStatuses }).notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    /** Why the run failed (status "error"): storage unreachable, credentials… */
    error: text("error"),
    /** FilesCheckFindings; `{}` when the run failed before comparing. */
    findings: jsonb("findings").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("ops_files_check_status_valid", sql`${t.status} in ('ok', 'problems', 'error')`),
    check("ops_files_check_error_length", sql`char_length(${t.error}) <= 1000`),
    check("ops_files_check_findings_size", sql`octet_length(${t.findings}::text) <= 262144`),
  ],
)

// Error log (Ops → Errors): server-side errors of the web app (Next's
// onRequestError, src/instrumentation.ts) and the bots' own unhandled
// exceptions, grouped by fingerprint (src/modules/ops/lib/errors.ts). The only
// write path is app.record_error() (security definer, global rate cap, row
// cap, retention; db/modules/ops-errors.sql): errors happen without a viewer.
// The owner reads their rows and may change only the resolve / alert columns.

export const opsErrorSources = ["web", "osbot", "expense-bot"] as const
export type OpsErrorSource = (typeof opsErrorSources)[number]

export const opsErrorStatuses = ["open", "resolved"] as const
export type OpsErrorStatus = (typeof opsErrorStatuses)[number]

/** Where it happened: Next's routeType, or "process" / "bot" for errors outside a request. */
export const opsErrorRouteTypes = ["render", "route", "action", "proxy", "process", "bot", ""] as const
export type OpsErrorRouteType = (typeof opsErrorRouteTypes)[number]

export const opsErrors = pgTable(
  "ops_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => user.id, { onDelete: "cascade" }),
    /** sha256 (first 32 hex) of source, name, normalized message and top app frame. */
    fingerprint: text("fingerprint").notNull(),
    source: text("source", { enum: opsErrorSources }).notNull(),
    name: text("name").notNull().default("Error"),
    /** The latest occurrence's message, scrubbed (no secrets, emails, tokens). */
    message: text("message").notNull().default(""),
    /** Route pattern or path without the query string, e.g. "/app/notes/[id]". */
    route: text("route").notNull().default(""),
    method: text("method").notNull().default(""),
    routeType: text("route_type", { enum: opsErrorRouteTypes }).notNull().default(""),
    /** Next's renderSource (react-server-components, server-rendering, …), or "". */
    renderSource: text("render_source").notNull().default(""),
    /** Next's error digest, the id shown on the error page. */
    digest: text("digest").notNull().default(""),
    /** Trimmed, scrubbed stack of the latest occurrence. */
    stack: text("stack").notNull().default(""),
    count: integer("count").notNull().default(1),
    /** Occurrences per hour for the last 24 hours, oldest first; the last slot is the hour of hourly_at. */
    hourly: integer("hourly").array().notNull().default(sql`'{}'::integer[]`),
    hourlyAt: timestamp("hourly_at", { withTimezone: true }).notNull().defaultNow(),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    status: text("status", { enum: opsErrorStatuses }).notNull().default("open"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** Times it came back after being resolved. */
    reopenedCount: integer("reopened_count").notNull().default(0),
    /** New or reopened, and the owner hasn't been told on Telegram yet. */
    alertPending: boolean("alert_pending").notNull().default(true),
    /** When the last Telegram message about it went out (one value per message: the hourly budget). */
    alertedAt: timestamp("alerted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ops_errors_owner_fingerprint").on(t.ownerId, t.fingerprint),
    index("ops_errors_owner_status_seen_idx").on(t.ownerId, t.status, t.lastSeen.desc()),
    index("ops_errors_last_seen_idx").on(t.lastSeen),
    check("ops_errors_fingerprint_format", sql`${t.fingerprint} ~ '^[0-9a-f]{32}$'`),
    check("ops_errors_source_valid", sql`${t.source} in ('web', 'osbot', 'expense-bot')`),
    check("ops_errors_status_valid", sql`${t.status} in ('open', 'resolved')`),
    check("ops_errors_route_type_valid", sql`${t.routeType} in ('render', 'route', 'action', 'proxy', 'process', 'bot', '')`),
    check("ops_errors_name_length", sql`char_length(${t.name}) between 1 and 120`),
    check("ops_errors_message_length", sql`char_length(${t.message}) <= 1000`),
    check("ops_errors_route_length", sql`char_length(${t.route}) <= 300`),
    check("ops_errors_method_length", sql`char_length(${t.method}) <= 10`),
    check("ops_errors_render_source_length", sql`char_length(${t.renderSource}) <= 60`),
    check("ops_errors_digest_length", sql`char_length(${t.digest}) <= 100`),
    check("ops_errors_stack_length", sql`char_length(${t.stack}) <= 6000`),
    check("ops_errors_hourly_length", sql`cardinality(${t.hourly}) <= 24`),
    check("ops_errors_count_positive", sql`${t.count} >= 1`),
  ],
)

/**
 * Global write budget per minute for app.record_error(): an error storm stops
 * being written once the minute's budget is spent, so it can't fill the disk.
 * RLS on, no policies, no grants: only the function touches it.
 */
export const opsErrorRate = pgTable("ops_error_rate", {
  minute: timestamp("minute", { withTimezone: true }).primaryKey(),
  hits: integer("hits").notNull().default(0),
})

// Restore drills (Ops → Server → Restore drill): the monthly GitHub Actions
// job (.github/workflows/restore-drill.yml, infra/backup/drill.sh) restores the
// newest backup into a throwaway Postgres, checks it and reports here through
// the signed /api/ops/restore-drill/report, which writes as the site owner.
// The newest few are kept. RLS and grants in db/modules/ops-restore-drills.sql.

export const opsDrillStatuses = ["ok", "failed"] as const
export type OpsDrillStatus = (typeof opsDrillStatuses)[number]

export type OpsDrillCheck = { name: string; ok: boolean; detail: string }

export const opsRestoreDrills = pgTable(
  "ops_restore_drills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .default(sql`app.current_user_id()`)
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", { enum: opsDrillStatuses }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    /** The backup file that was restored, e.g. anwar_os-2026-12-01T021503Z.dump.age. */
    backupFile: text("backup_file").notNull().default(""),
    /** When that backup was made (the object's last-modified time). */
    backupAt: timestamp("backup_at", { withTimezone: true }),
    backupBytes: bigint("backup_bytes", { mode: "number" }),
    /** Rows across every restored table. */
    totalRows: bigint("total_rows", { mode: "number" }),
    /** Rows per table ("schema.table": n), for the next drill's tolerance check. */
    tables: jsonb("tables").$type<Record<string, number>>().notNull().default({}),
    checks: jsonb("checks").$type<OpsDrillCheck[]>().notNull().default([]),
    error: text("error"),
    /** The GitHub Actions run, for the details. */
    runUrl: text("run_url"),
    commit: text("commit"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ops_restore_drills_owner_finished_idx").on(t.ownerId, t.finishedAt.desc()),
    check("ops_restore_drills_status_valid", sql`${t.status} in ('ok', 'failed')`),
    check("ops_restore_drills_backup_file_length", sql`char_length(${t.backupFile}) <= 200`),
    check("ops_restore_drills_error_length", sql`char_length(${t.error}) <= 2000`),
    check(
      "ops_restore_drills_run_url_format",
      sql`${t.runUrl} is null or (char_length(${t.runUrl}) <= 300 and ${t.runUrl} ~ '^https://[^[:space:]]+$')`,
    ),
    check("ops_restore_drills_commit_format", sql`${t.commit} is null or ${t.commit} ~ '^[0-9a-f]{7,40}$'`),
    check("ops_restore_drills_tables_size", sql`octet_length(${t.tables}::text) <= 65536`),
    check("ops_restore_drills_checks_size", sql`octet_length(${t.checks}::text) <= 65536`),
  ],
)
