import { z } from "zod"
import type { OpsDrillCheck, OpsDrillStatus } from "@/db/schema/ops"
import type { Alert, Level } from "./server"
import { formatBytes, formatDuration } from "./status"

// Restore drills (Ops → Server → Restore drill): what the monthly GitHub
// Actions job reports (infra/backup/drill.sh → /api/ops/restore-drill/report),
// the tile's verdict and the "drill" server alert. Pure, unit-tested
// (drill.test.ts).

export const DRILL = {
  /** Alert when the last successful drill is older than this. */
  maxAgeDays: 35,
  /** Drills kept in the database. */
  keep: 24,
  /** The presigned backup URL handed to the drill. */
  urlTtlSeconds: 15 * 60,
} as const

const DAY = 86_400_000

export type Drill = {
  id: string
  status: OpsDrillStatus
  startedAt: string
  finishedAt: string
  durationMs: number
  backupFile: string
  backupAt: string | null
  backupBytes: number | null
  totalRows: number | null
  checks: OpsDrillCheck[]
  error: string | null
  runUrl: string | null
  commit: string | null
}

export type DrillState = {
  /** Is RESTORE_DRILL_SECRET set on web? Without it the drill can't report. */
  configured: boolean
  latest: Drill | null
  lastOk: Drill | null
}

const iso = z.iso.datetime({ offset: true })

/** What drill.sh posts. Everything is bounded; table names are schema.table. */
export const drillReportInput = z.object({
  status: z.enum(["ok", "failed"]),
  startedAt: iso,
  finishedAt: iso,
  durationMs: z.number().int().min(0).max(6 * 3_600_000),
  backup: z
    .object({
      file: z.string().max(200).regex(/^[\w.:-]*$/).default(""),
      at: iso.nullable().default(null),
      bytes: z.number().int().min(0).nullable().default(null),
    })
    .default({ file: "", at: null, bytes: null }),
  totalRows: z.number().int().min(0).nullable().default(null),
  tables: z
    .record(z.string().regex(/^[a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62}$/), z.number().int().min(0))
    .refine((t) => Object.keys(t).length <= 500, "at most 500 tables")
    .default({}),
  checks: z
    .array(z.object({ name: z.string().min(1).max(80), ok: z.boolean(), detail: z.string().max(500).default("") }))
    .max(50)
    .default([]),
  error: z.string().max(2000).nullable().default(null),
  runUrl: z.string().max(300).regex(/^https:\/\/\S+$/).nullable().default(null),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/).nullable().default(null),
})

export type DrillReport = z.infer<typeof drillReportInput>

const ageDays = (d: Drill, now: Date) => Math.floor((now.getTime() - new Date(d.finishedAt).getTime()) / DAY)

/** Failed checks as one line: "migrations: 52 of 54 applied · rls: 1 table without policies". */
export function failedChecks(d: Pick<Drill, "checks" | "error">): string {
  const failed = d.checks.filter((c) => !c.ok).map((c) => (c.detail ? `${c.name}: ${c.detail}` : c.name))
  return [d.error, ...failed].filter(Boolean).join(" · ")
}

/** The "drill" server alert (alerts.ts), sent by osbot like the others. */
export function drillAlerts({ configured, latest, lastOk }: DrillState, now: Date): Alert[] {
  const setup = "Set it up once: docs/DEPLOY.md, “Restore drill” (GitHub secrets DRILL_AGE_IDENTITY and RESTORE_DRILL_SECRET)."
  if (latest?.status === "failed") {
    const why = failedChecks(latest) || "drill.sh reported a failure"
    return [
      {
        key: "drill",
        kind: "drill",
        title: "Restore drill failed",
        detail: `${why}.${latest.backupFile ? ` Backup ${latest.backupFile}.` : ""}${latest.runUrl ? ` ${latest.runUrl}` : ""}`.slice(0, 1000),
      },
    ]
  }
  // Never ran: the tile says how to set it up. No Telegram nag on every new
  // install; once one has passed, silence for 35 days is an alert.
  if (!lastOk) return []
  const days = ageDays(lastOk, now)
  if (days > DRILL.maxAgeDays) {
    return [
      {
        key: "drill",
        kind: "drill",
        title: `No successful restore drill for ${days} days`,
        detail: `The monthly GitHub Actions job (restore-drill.yml) hasn't reported. Is it enabled, and are its secrets set?${configured ? "" : ` ${setup}`}`,
      },
    ]
  }
  return []
}

export function drillLevel(state: DrillState, now: Date): Level {
  if (state.latest?.status === "failed") return "bad"
  if (!state.lastOk) return "warn"
  return ageDays(state.lastOk, now) > DRILL.maxAgeDays ? "bad" : "ok"
}

/** "2 min 14 s" style: duration of a drill. */
export function drillDuration(ms: number): string {
  return formatDuration(ms)
}

/** "1 234 rows · 2.1 MB backup" */
export function drillFigures(d: Pick<Drill, "totalRows" | "backupBytes">, locale = "en"): string {
  return [
    d.totalRows != null ? `${new Intl.NumberFormat(locale).format(d.totalRows)} rows` : null,
    d.backupBytes != null ? `${formatBytes(d.backupBytes)} backup` : null,
  ]
    .filter(Boolean)
    .join(" · ")
}
