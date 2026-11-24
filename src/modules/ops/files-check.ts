import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { asViewer, requireViewer, type Viewer } from "@/core/auth"
import { db } from "@/db"
import { opsFilesCheck, type OpsFilesCheckStatus } from "@/db/schema"
import { headObject, listObjects, removeObjects, storageConfigured } from "@/modules/files/lib/s3"
import { consumeRateLimit } from "@/lib/rate-limit"
import {
  compareInventory,
  FILES_CHECK,
  filesAlerts,
  findingsStatus,
  isFilesKey,
  isIgnored,
  parseIgnorePrefixes,
  withMissing,
  type BucketObject,
  type FilesCheck,
  type FilesCheckFindings,
  type InventoryRow,
  type MissingItem,
} from "./lib/files-check"
import type { Alert } from "./lib/server"

// Files storage check (Ops → Server → Files storage): do the Files rows and
// the objects in the bucket agree? Run weekly by osbot (Monday 04:00,
// POST /api/internal/osbot/files-check/run) and by "Check now". The result is
// stored (ops_files_check) and turned into server alerts of kind "files" by
// the 5-minute alert check, so Telegram hears about a problem once and its
// recovery once, like any other server alert. Nothing is deleted on its own:
// orphans are listed, and "Delete orphans" removes them after re-checking each.

export type FilesCheckView = {
  /** Are the S3_* variables set? Without them there is nothing to check. */
  configured: boolean
  check: FilesCheck | null
}

export type RunResult =
  | { ok: true; ran: boolean; check: FilesCheck }
  | { ok: false; error: string; retryAfter?: number }

/** "Check now": a handful per hour is plenty; a run lists the whole bucket. */
const CHECK_NOW_LIMIT = { window: 10 * 60, max: 3 }

export const runFilesCheckInput = z.object({
  /** Skip the run when the stored one is younger than this (osbot's retries and restarts). */
  maxAgeHours: z.number().int().min(1).max(24 * 30).optional(),
})

export const deleteOrphansInput = z.object({
  keys: z.array(z.string().min(3).max(300)).min(1).max(FILES_CHECK.listLimit),
})

async function requireOwner(): Promise<Viewer> {
  const viewer = await requireViewer()
  if (viewer.role !== "owner") throw new Error("Only the owner can check the files storage.")
  return viewer
}

const ignorePrefixes = () => parseIgnorePrefixes(process.env.FILES_CHECK_IGNORE_PREFIXES, process.env.BACKUP_PREFIX)

function toCheck(row: typeof opsFilesCheck.$inferSelect): FilesCheck {
  const findings = row.findings as Partial<FilesCheckFindings>
  return {
    status: row.status,
    checkedAt: row.checkedAt.toISOString(),
    durationMs: row.durationMs,
    error: row.error,
    findings: row.status === "error" || typeof findings.objects !== "number" ? null : (findings as FilesCheckFindings),
  }
}

/** The stored result, as the owner. */
export async function latestFilesCheck(): Promise<FilesCheck | null> {
  const [row] = await asViewer((tx) => tx.select().from(opsFilesCheck))
  return row ? toCheck(row) : null
}

export async function getFilesCheck(): Promise<FilesCheckView> {
  await requireOwner()
  return { configured: storageConfigured(), check: await latestFilesCheck() }
}

/** For the 5-minute alert check (alerts.ts). Never throws: a broken read raises nothing. */
export async function currentFilesAlerts(now: Date): Promise<Alert[]> {
  try {
    return filesAlerts(await latestFilesCheck(), now, { configured: storageConfigured() })
  } catch (error) {
    console.error("files check: reading the last result failed", error)
    return []
  }
}

async function inventory(): Promise<InventoryRow[]> {
  const rows = await asViewer((tx) =>
    tx.execute<{ id: string; owner_id: string; name: string | null; storage_key: string; size_bytes: string | number }>(
      sql`select id, owner_id, name, storage_key, size_bytes from app.files_storage_inventory()`,
    ),
  )
  return [...rows].map((r) => ({ id: r.id, ownerId: r.owner_id, name: r.name, key: r.storage_key, size: Number(r.size_bytes) }))
}

async function save(status: OpsFilesCheckStatus, checkedAt: Date, durationMs: number, error: string | null, findings: FilesCheckFindings | null) {
  const values = { status, checkedAt, durationMs, error: error?.slice(0, 1000) ?? null, findings: (findings ?? {}) as Record<string, unknown> }
  const [row] = await asViewer((tx) =>
    tx.insert(opsFilesCheck).values(values).onConflictDoUpdate({ target: opsFilesCheck.ownerId, set: values }).returning(),
  )
  return toCheck(row!)
}

const message = (error: unknown) => {
  const e = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } }
  const status = e?.$metadata?.httpStatusCode
  const text = e?.message || e?.name || String(error)
  return status ? `${text} (HTTP ${status})` : text
}

/** Lists the bucket, compares, confirms the missing ones with a HEAD each, and stores the result. */
async function check(now = new Date()): Promise<FilesCheck> {
  const started = Date.now()
  let findings: FilesCheckFindings
  try {
    const before = await inventory()
    const objects: BucketObject[] = []
    for await (const o of listObjects()) objects.push(o)
    const after = await inventory()
    const compared = compareInventory({ before, after, objects, ignorePrefixes: ignorePrefixes(), now })
    const confirmed: MissingItem[] = []
    for (const m of compared.missingCandidates) {
      if (!(await headObject(m.key))) confirmed.push(m)
    }
    findings = withMissing(compared.findings, confirmed)
  } catch (error) {
    console.error("files check failed", error)
    return save("error", now, Date.now() - started, message(error), null)
  }
  return save(findingsStatus(findings), now, Date.now() - started, null, findings)
}

/**
 * Runs the check now (osbot weekly, or "Check now" with `limit`). With
 * `maxAgeHours` a recent enough stored run is returned instead.
 */
export async function runFilesCheck(
  { maxAgeHours }: z.infer<typeof runFilesCheckInput> = {},
  { limit = false }: { limit?: boolean } = {},
): Promise<RunResult> {
  const viewer = await requireOwner()
  if (!storageConfigured()) return { ok: false, error: "File storage isn't configured (S3_* variables), so there is nothing to check." }
  if (maxAgeHours) {
    const last = await latestFilesCheck()
    if (last && last.status !== "error" && Date.now() - new Date(last.checkedAt).getTime() < maxAgeHours * 3_600_000) {
      return { ok: true, ran: false, check: last }
    }
  }
  if (limit) {
    const decision = await consumeRateLimit(db, `ops-files-check:${viewer.id}`, CHECK_NOW_LIMIT)
    if (!decision.allowed) {
      return { ok: false, error: "That's enough checks for now. Try again in a few minutes.", retryAfter: decision.retryAfter ?? undefined }
    }
  }
  return { ok: true, ran: true, check: await check() }
}

export type DeleteOrphansResult =
  | { ok: true; deleted: number; skipped: number; check: FilesCheck }
  | { ok: false; error: string }

/**
 * Deletes the given orphaned objects, each re-checked first: it has the shape
 * of a Files key, isn't under an ignored prefix, still has no row in any
 * account, still exists and is older than the upload grace. Then the check
 * runs again, so the tile shows what is left.
 */
export async function deleteOrphans({ keys }: z.infer<typeof deleteOrphansInput>, now = new Date()): Promise<DeleteOrphansResult> {
  await requireOwner()
  if (!storageConfigured()) return { ok: false, error: "File storage isn't configured." }
  const prefixes = ignorePrefixes()
  const rows = new Set((await inventory()).map((r) => r.key))
  const grace = FILES_CHECK.uploadGraceHours * 3_600_000
  const doomed: string[] = []
  for (const key of new Set(keys)) {
    if (!isFilesKey(key) || isIgnored(key, prefixes) || rows.has(key)) continue
    const head = await headObject(key)
    if (!head || !head.lastModified || now.getTime() - head.lastModified.getTime() < grace) continue
    doomed.push(key)
  }
  // An upload confirmed while we were looking: never delete what a row now points at.
  const latest = new Set((await inventory()).map((r) => r.key))
  const safe = doomed.filter((k) => !latest.has(k))
  await removeObjects(safe)
  let deleted = 0
  for (const key of safe) if (!(await headObject(key))) deleted++
  console.info("files check: deleted orphaned objects", { requested: keys.length, deleted })
  return { ok: true, deleted, skipped: new Set(keys).size - deleted, check: await check() }
}
