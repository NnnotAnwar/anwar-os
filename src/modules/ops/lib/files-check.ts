import type { OpsFilesCheckStatus } from "@/db/schema/ops"
import type { Alert, Level } from "./server"
import { formatBytes, formatDuration } from "./status"

// The files storage check, the pure part: compare the Files rows with the
// objects in the bucket and decide what is wrong. The server part
// (../files-check.ts) reads both sides and stores the result.
//
//   missing     a row whose object isn't in the bucket: the file is lost
//   mismatched  the object's size differs from the row's: damaged or replaced
//   orphans     an object no row points at, older than the upload grace: an
//               abandoned upload, or a file whose delete didn't reach storage
//   recent      the same but younger: most likely an upload still in flight
//
// Objects under the ignored prefixes (the database backups in `postgres/`)
// are counted apart and never called orphans.

export const FILES_CHECK = {
  /** An object without a row younger than this is an upload in flight, not an orphan. */
  uploadGraceHours: 24,
  /** Each list in the findings keeps at most this many items (the counts are exact). */
  listLimit: 100,
  /** osbot runs the check every Monday at 04:00; alert when the last run is older than this. */
  staleAfterDays: 9,
  /** Database backups (infra/backup) when BACKUP_PREFIX isn't set. */
  defaultBackupPrefix: "postgres",
} as const

/** One row of app.files_storage_inventory(). `name` is null for other accounts' files. */
export type InventoryRow = { id: string; ownerId: string; name: string | null; key: string; size: number }
export type BucketObject = { key: string; size: number; lastModified: Date | null }

export type MissingItem = { key: string; fileId: string; name: string | null; size: number }
export type MismatchedItem = MissingItem & { actual: number }
export type OrphanItem = {
  key: string
  size: number
  lastModified: string | null
  /** Has the shape of a Files key (`<owner>/<uuid>`), so the app may delete it. */
  deletable: boolean
}

export type FilesCheckFindings = {
  /** Objects that belong to Files (ignored prefixes left out). */
  objects: number
  bytes: number
  /** Rows in files_files, all accounts. */
  rows: number
  rowBytes: number
  ignored: { prefixes: string[]; objects: number; bytes: number }
  missingCount: number
  missing: MissingItem[]
  mismatchedCount: number
  mismatched: MismatchedItem[]
  orphanCount: number
  orphanBytes: number
  orphans: OrphanItem[]
  /** Objects without a row, younger than the grace: uploads in flight. */
  recent: number
}

export type FilesCheck = {
  status: OpsFilesCheckStatus
  checkedAt: string
  durationMs: number
  error: string | null
  findings: FilesCheckFindings | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** `<owner id>/<uuid>`: what buildStorageKey() issues (files/lib/keys.ts). */
export function isFilesKey(key: string) {
  const slash = key.indexOf("/")
  return slash > 0 && slash === key.lastIndexOf("/") && !/[\\]/.test(key) && UUID.test(key.slice(slash + 1))
}

/**
 * What isn't Files in the bucket: FILES_CHECK_IGNORE_PREFIXES="postgres/,exports/"
 * → ["postgres/", "exports/"]; empty or unset → the backups' BACKUP_PREFIX/
 * (default postgres/).
 */
export function parseIgnorePrefixes(value: string | undefined, backupPrefix?: string): string[] {
  const clean = (p: string) => {
    const t = p.trim().replace(/^\/+/, "")
    return t ? (t.endsWith("/") ? t : `${t}/`) : ""
  }
  const list = (value ?? "").split(",").map(clean).filter(Boolean)
  return list.length ? [...new Set(list)] : [clean(backupPrefix ?? "") || `${FILES_CHECK.defaultBackupPrefix}/`]
}

export const isIgnored = (key: string, prefixes: readonly string[]) => prefixes.some((p) => key.startsWith(p))

/**
 * Compares two reads of the rows with one listing of the bucket. The rows are
 * read before and after the listing: a file deleted in between (row first,
 * then object) would otherwise look missing, and one uploaded in between
 * orphaned. A row counts as missing only if both reads have it; an object is
 * orphaned only if neither does. `confirmMissing` (a HEAD per candidate) then
 * rules out a listing that lagged behind a fresh upload.
 */
export function compareInventory({
  before,
  after,
  objects,
  ignorePrefixes,
  now,
}: {
  before: InventoryRow[]
  after: InventoryRow[]
  objects: BucketObject[]
  ignorePrefixes: readonly string[]
  now: Date
}): { findings: FilesCheckFindings; missingCandidates: MissingItem[] } {
  const afterByKey = new Map(after.map((r) => [r.key, r]))
  const anyRow = new Set([...before.map((r) => r.key), ...after.map((r) => r.key)])
  const stable = before.filter((r) => afterByKey.has(r.key))

  const files: BucketObject[] = []
  const ignored = { prefixes: [...ignorePrefixes], objects: 0, bytes: 0 }
  for (const o of objects) {
    if (isIgnored(o.key, ignorePrefixes)) {
      ignored.objects++
      ignored.bytes += o.size
    } else files.push(o)
  }
  const byKey = new Map(files.map((o) => [o.key, o]))

  const missing: MissingItem[] = []
  const mismatched: MismatchedItem[] = []
  for (const r of stable) {
    const o = byKey.get(r.key)
    const item = { key: r.key, fileId: r.id, name: r.name, size: r.size }
    if (!o) missing.push(item)
    else if (o.size !== r.size) mismatched.push({ ...item, actual: o.size })
  }

  const grace = FILES_CHECK.uploadGraceHours * 3_600_000
  const orphans: OrphanItem[] = []
  let recent = 0
  for (const o of files) {
    if (anyRow.has(o.key)) continue
    // No date (a server that doesn't say) counts as old: better listed than hidden.
    if (o.lastModified && now.getTime() - o.lastModified.getTime() < grace) {
      recent++
      continue
    }
    orphans.push({ key: o.key, size: o.size, lastModified: o.lastModified?.toISOString() ?? null, deletable: isFilesKey(o.key) })
  }
  // Biggest first: what deleting saves the most.
  orphans.sort((a, b) => b.size - a.size || a.key.localeCompare(b.key))
  mismatched.sort((a, b) => a.key.localeCompare(b.key))

  const findings: FilesCheckFindings = {
    objects: files.length,
    bytes: files.reduce((n, o) => n + o.size, 0),
    rows: after.length,
    rowBytes: after.reduce((n, r) => n + r.size, 0),
    ignored,
    // Filled in by withMissing() once each candidate is confirmed.
    missingCount: 0,
    missing: [],
    mismatchedCount: mismatched.length,
    mismatched: mismatched.slice(0, FILES_CHECK.listLimit),
    orphanCount: orphans.length,
    orphanBytes: orphans.reduce((n, o) => n + o.size, 0),
    orphans: orphans.slice(0, FILES_CHECK.listLimit),
    recent,
  }
  return { findings, missingCandidates: missing }
}

/** Puts the confirmed missing files into the findings (a candidate that turned up after all is dropped). */
export function withMissing(findings: FilesCheckFindings, confirmed: MissingItem[]): FilesCheckFindings {
  const sorted = [...confirmed].sort((a, b) => a.key.localeCompare(b.key))
  return { ...findings, missingCount: sorted.length, missing: sorted.slice(0, FILES_CHECK.listLimit) }
}

export function findingsStatus(f: FilesCheckFindings): Exclude<OpsFilesCheckStatus, "error"> {
  return f.missingCount || f.mismatchedCount || f.orphanCount ? "problems" : "ok"
}

/** The tile's dot: lost or damaged files are bad, leftovers and a stale or failed run only need a look. */
export function filesCheckLevel(check: FilesCheck | null, now: Date): Level {
  if (!check) return "unknown"
  if (check.status === "error") return "warn"
  const f = check.findings
  if (f && (f.missingCount || f.mismatchedCount)) return "bad"
  if (f && f.orphanCount) return "warn"
  if (isStale(check, now)) return "warn"
  return "ok"
}

export function isStale(check: FilesCheck, now: Date) {
  return now.getTime() - new Date(check.checkedAt).getTime() > FILES_CHECK.staleAfterDays * 86_400_000
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "2 missing · 1 wrong size · 3 orphaned (12 MB)", or "" when nothing is wrong. */
export function problemsLine(f: FilesCheckFindings) {
  return [
    f.missingCount ? `${f.missingCount} missing` : null,
    f.mismatchedCount ? `${f.mismatchedCount} wrong size` : null,
    f.orphanCount ? `${f.orphanCount} orphaned (${formatBytes(f.orphanBytes)})` : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

const names = (items: MissingItem[], count: number) => {
  const shown = items.slice(0, 3).map((i) => (i.name ? `“${i.name}”` : "another account's file"))
  return `${shown.join(", ")}${count > shown.length ? ` and ${count - shown.length} more` : ""}`
}

/**
 * The server alerts of kind "files", from the stored result (osbot's 5-minute
 * check reads it; the weekly run refreshes it). Three keys, so a cleared
 * leftover never hides a lost file: files:missing, files:orphans, files:check.
 * No result yet, or no storage configured: nothing.
 */
export function filesAlerts(check: FilesCheck | null, now: Date, { configured }: { configured: boolean }): Alert[] {
  if (!configured || !check) return []
  const alerts: Alert[] = []
  const when = new Date(check.checkedAt).toISOString().slice(0, 16).replace("T", " ")
  if (check.status === "error") {
    alerts.push({
      key: "files:check",
      kind: "files",
      title: "Files storage check failed",
      detail: `${(check.error ?? "Unknown error").slice(0, 600)} (run ${when} UTC). Check the S3_* settings and the bucket.`,
    })
  } else if (isStale(check, now)) {
    alerts.push({
      key: "files:check",
      kind: "files",
      title: `Files storage not checked for ${formatDuration(now.getTime() - new Date(check.checkedAt).getTime())}`,
      detail: "osbot runs it every Monday at 04:00: is the bot running? Ops → Server → Files storage → Check now runs it by hand.",
    })
  }
  const f = check.findings
  if (f && (f.missingCount || f.mismatchedCount)) {
    const parts = [
      f.missingCount ? `${plural(f.missingCount, "file")} missing` : null,
      f.mismatchedCount ? `${plural(f.mismatchedCount, "file")} with the wrong size` : null,
    ].filter(Boolean)
    const detail = [
      f.missingCount ? `Not in the bucket: ${names(f.missing, f.missingCount)}.` : null,
      f.mismatchedCount ? `Size differs: ${names(f.mismatched, f.mismatchedCount)}.` : null,
      `Checked ${when} UTC. Restore them from a copy, or delete the rows in Files.`,
    ]
      .filter(Boolean)
      .join(" ")
    alerts.push({ key: "files:missing", kind: "files", title: `Files storage: ${parts.join(", ")}`.slice(0, 200), detail: detail.slice(0, 1000) })
  }
  if (f && f.orphanCount) {
    alerts.push({
      key: "files:orphans",
      kind: "files",
      title: `Files storage: ${plural(f.orphanCount, "orphaned object")} (${formatBytes(f.orphanBytes)})`,
      detail: `Objects no file in anwar.os points at, older than ${FILES_CHECK.uploadGraceHours} h: abandoned uploads or deletes that didn't reach storage. Review and delete them in Ops → Server → Files storage.`,
    })
  }
  return alerts
}
