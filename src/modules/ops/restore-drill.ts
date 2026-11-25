import "server-only"
import { desc, eq, notInArray } from "drizzle-orm"
import { asViewer, requireViewer } from "@/core/auth"
import { InternalApiError } from "@/core/internal-api"
import { opsRestoreDrills } from "@/db/schema"
import { listObjects, presignGet, storageConfigured } from "@/modules/files/lib/s3"
import { DRILL, drillAlerts, type Drill, type DrillReport, type DrillState } from "./lib/drill"
import type { Alert } from "./lib/server"

// The monthly restore drill. It runs in GitHub Actions, not on the server:
// the private key that decrypts backups must not live next to them. The
// workflow (.github/workflows/restore-drill.yml → infra/backup/drill.sh)
// talks to two signed endpoints (restore-drill-api.ts):
//
//   POST /api/ops/restore-drill/source  a 15-minute presigned GET for the
//        newest daily backup (so GitHub holds no storage key at all) and the
//        previous good drill's row counts (the tolerance check)
//   POST /api/ops/restore-drill/report  the outcome, stored here
//
// Ops → Server shows the latest; the "drill" server alert fires when it
// failed or when none passed for DRILL.maxAgeDays. Nothing here can touch
// the production database beyond this table: the drill restores into a
// throwaway Postgres on the runner.

export const restoreDrillConfigured = () => (process.env.RESTORE_DRILL_SECRET ?? "").length >= 32

function toDrill(r: typeof opsRestoreDrills.$inferSelect): Drill {
  return {
    id: r.id,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt.toISOString(),
    durationMs: r.durationMs,
    backupFile: r.backupFile,
    backupAt: r.backupAt?.toISOString() ?? null,
    backupBytes: r.backupBytes,
    totalRows: r.totalRows,
    checks: r.checks,
    error: r.error,
    runUrl: r.runUrl,
    commit: r.commit,
  }
}

/** The latest drill and the latest passing one, as the current viewer (the owner). */
async function readDrills(): Promise<Omit<DrillState, "configured"> & { lastOkTables: Record<string, number> | null }> {
  return asViewer(async (tx) => {
    const [latest] = await tx.select().from(opsRestoreDrills).orderBy(desc(opsRestoreDrills.finishedAt)).limit(1)
    const [lastOk] =
      latest?.status === "ok"
        ? [latest]
        : await tx.select().from(opsRestoreDrills).where(eq(opsRestoreDrills.status, "ok")).orderBy(desc(opsRestoreDrills.finishedAt)).limit(1)
    return { latest: latest ? toDrill(latest) : null, lastOk: lastOk ? toDrill(lastOk) : null, lastOkTables: lastOk?.tables ?? null }
  })
}

export async function getDrillState(): Promise<DrillState> {
  const viewer = await requireViewer()
  if (viewer.role !== "owner") throw new Error("Only the owner can see restore drills.")
  const { latest, lastOk } = await readDrills()
  return { configured: restoreDrillConfigured(), latest, lastOk }
}

/** For the 5-minute alert check (alerts.ts). Never throws. */
export async function currentDrillAlerts(now: Date): Promise<Alert[]> {
  try {
    return drillAlerts(await getDrillState(), now)
  } catch (error) {
    console.error("restore drill: reading the last result failed", error)
    return []
  }
}

// ---------------------------------------------------------------------------
// The workflow's side (signed API, acting as the site owner)
// ---------------------------------------------------------------------------

export type DrillSource = {
  /** Presigned GET, valid for `expiresIn` seconds. */
  url: string
  expiresIn: number
  file: string
  bytes: number
  lastModified: string | null
  previous: { finishedAt: string; totalRows: number | null; tables: Record<string, number> } | null
}

const BACKUP_FILE = /^anwar_os-[\w.-]+\.dump\.age$/

/** The newest daily backup in object storage (backup.sh's layout: <prefix>/daily/anwar_os-<stamp>.dump.age). */
export async function drillSource(): Promise<DrillSource> {
  if ((process.env.BACKUP_TARGET ?? "s3") !== "s3") {
    throw new InternalApiError(409, "not_s3", "Backups don't go to object storage (BACKUP_TARGET), so there is nothing to hand out.")
  }
  if (!storageConfigured()) throw new InternalApiError(409, "no_storage", "Object storage isn't configured on web (S3_*).")
  const prefix = `${(process.env.BACKUP_PREFIX || "postgres").replace(/^\/+|\/+$/g, "")}/daily/`
  const bucket = process.env.BACKUP_S3_BUCKET || undefined
  let newest: { key: string; size: number; lastModified: Date | null } | null = null
  // Names sort by their UTC timestamp.
  for await (const o of listObjects({ prefix, bucket })) {
    const name = o.key.slice(prefix.length)
    if (BACKUP_FILE.test(name) && (!newest || o.key > newest.key)) newest = o
  }
  if (!newest) throw new InternalApiError(404, "no_backup", `No backup under ${prefix} in the bucket.`)
  const { lastOk, lastOkTables } = await readDrills()
  return {
    url: await presignGet(newest.key, DRILL.urlTtlSeconds, bucket),
    expiresIn: DRILL.urlTtlSeconds,
    file: newest.key.slice(prefix.length),
    bytes: newest.size,
    lastModified: newest.lastModified?.toISOString() ?? null,
    previous: lastOk ? { finishedAt: lastOk.finishedAt, totalRows: lastOk.totalRows, tables: lastOkTables ?? {} } : null,
  }
}

/** Stores a drill's outcome and keeps the newest DRILL.keep. */
export async function saveDrillReport(r: DrillReport): Promise<{ id: string; status: Drill["status"] }> {
  return asViewer(async (tx) => {
    const [row] = await tx
      .insert(opsRestoreDrills)
      .values({
        status: r.status,
        startedAt: new Date(r.startedAt),
        finishedAt: new Date(r.finishedAt),
        durationMs: r.durationMs,
        backupFile: r.backup.file,
        backupAt: r.backup.at ? new Date(r.backup.at) : null,
        backupBytes: r.backup.bytes,
        totalRows: r.totalRows,
        tables: r.tables,
        checks: r.checks,
        error: r.error,
        runUrl: r.runUrl,
        commit: r.commit,
      })
      .returning({ id: opsRestoreDrills.id, status: opsRestoreDrills.status })
    const keep = await tx
      .select({ id: opsRestoreDrills.id })
      .from(opsRestoreDrills)
      .orderBy(desc(opsRestoreDrills.finishedAt))
      .limit(DRILL.keep)
    await tx.delete(opsRestoreDrills).where(notInArray(opsRestoreDrills.id, keep.map((k) => k.id)))
    return row!
  })
}
