import { describe, expect, it } from "vitest"
import {
  compareInventory,
  FILES_CHECK,
  filesAlerts,
  filesCheckLevel,
  findingsStatus,
  isFilesKey,
  parseIgnorePrefixes,
  problemsLine,
  withMissing,
  type BucketObject,
  type FilesCheck,
  type InventoryRow,
} from "./files-check"

const NOW = new Date("2026-11-30T03:30:00Z")
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000)
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const k = (n: number, owner = "owner1") => `${owner}/${uuid(n)}`
const row = (n: number, size: number, name: string | null = `File ${n}.pdf`): InventoryRow => ({ id: uuid(n), ownerId: "owner1", name, key: k(n), size })
const obj = (key: string, size: number, hours = 72): BucketObject => ({ key, size, lastModified: ago(hours) })

function compare(before: InventoryRow[], objects: BucketObject[], after = before) {
  return compareInventory({ before, after, objects, ignorePrefixes: ["postgres/"], now: NOW })
}

describe("compareInventory", () => {
  it("finds missing, wrong-size and orphaned objects, and keeps backups apart", () => {
    const { findings, missingCandidates } = compare(
      [row(1, 100), row(2, 200), row(3, 300)],
      [obj(k(1), 100), obj(k(3), 250), obj(k(9), 5000), obj(k(8), 10, 2), obj("postgres/daily/x.age", 999), obj("loose.txt", 7)],
    )
    expect(missingCandidates.map((m) => m.key)).toEqual([k(2)])
    expect(findings).toMatchObject({
      objects: 5,
      bytes: 100 + 250 + 5000 + 10 + 7,
      rows: 3,
      rowBytes: 600,
      ignored: { prefixes: ["postgres/"], objects: 1, bytes: 999 },
      mismatchedCount: 1,
      mismatched: [{ key: k(3), size: 300, actual: 250 }],
      orphanCount: 2,
      orphanBytes: 5007,
      recent: 1,
    })
    // Biggest first; only Files-shaped keys may be deleted by the app.
    expect(findings.orphans.map((o) => [o.key, o.deletable])).toEqual([
      [k(9), true],
      ["loose.txt", false],
    ])
    // Missing ones are only counted once confirmed.
    expect(findings.missingCount).toBe(0)
    const done = withMissing(findings, missingCandidates)
    expect(done).toMatchObject({ missingCount: 1, missing: [{ key: k(2), name: "File 2.pdf", size: 200 }] })
    expect(findingsStatus(done)).toBe("problems")
    expect(problemsLine(done)).toBe("1 missing · 1 wrong size · 2 orphaned (4.9 KB)")
  })

  it("doesn't mistake a delete or an upload during the listing for a problem", () => {
    // Row 2 was deleted (row, then object) while listing; row 5 was uploaded and confirmed.
    const before = [row(1, 100), row(2, 200)]
    const after = [row(1, 100), row(5, 50)]
    const { findings, missingCandidates } = compare(before, [obj(k(1), 100), obj(k(5), 50, 0.1)], after)
    expect(missingCandidates).toEqual([])
    expect(findings).toMatchObject({ orphanCount: 0, recent: 0, rows: 2 })
    // And the other way round: object listed before the delete removed it.
    const r2 = compare(before, [obj(k(1), 100), obj(k(2), 200)], after)
    expect(r2.findings.orphanCount).toBe(0)
  })

  it("counts an object without a date as old, and is all good when everything matches", () => {
    const { findings } = compare([row(1, 100)], [obj(k(1), 100), { key: k(2), size: 3, lastModified: null }])
    expect(findings.orphans).toEqual([{ key: k(2), size: 3, lastModified: null, deletable: true }])
    const clean = compare([row(1, 100)], [obj(k(1), 100)])
    expect(findingsStatus(clean.findings)).toBe("ok")
    expect(problemsLine(clean.findings)).toBe("")
  })

  it("caps the lists, never the counts", () => {
    const objects = Array.from({ length: FILES_CHECK.listLimit + 20 }, (_, i) => obj(k(i + 1), 1))
    const { findings } = compare([], objects)
    expect(findings.orphanCount).toBe(FILES_CHECK.listLimit + 20)
    expect(findings.orphans).toHaveLength(FILES_CHECK.listLimit)
  })
})

describe("keys and prefixes", () => {
  it("knows a Files key", () => {
    expect(isFilesKey(k(1))).toBe(true)
    expect(isFilesKey(`a/b/${uuid(1)}`)).toBe(false)
    expect(isFilesKey(uuid(1))).toBe(false)
    expect(isFilesKey("owner/not-a-uuid")).toBe(false)
    expect(isFilesKey(`owner\\x/${uuid(1)}`)).toBe(false)
  })

  it("reads FILES_CHECK_IGNORE_PREFIXES", () => {
    expect(parseIgnorePrefixes(undefined)).toEqual(["postgres/"])
    expect(parseIgnorePrefixes("  ", "")).toEqual(["postgres/"])
    expect(parseIgnorePrefixes("", "db-dumps")).toEqual(["db-dumps/"])
    expect(parseIgnorePrefixes("postgres, /exports/ ,postgres/", "db-dumps")).toEqual(["postgres/", "exports/"])
  })
})

describe("filesAlerts", () => {
  const check = (over: Partial<FilesCheck> = {}, findings: Partial<FilesCheck["findings"]> = {}): FilesCheck => {
    const base = compare([row(1, 100)], [obj(k(1), 100)]).findings
    return { status: "ok", checkedAt: ago(10).toISOString(), durationMs: 50, error: null, findings: { ...base, ...findings }, ...over }
  }

  it("says nothing without storage, without a result or when all is well", () => {
    expect(filesAlerts(check({}, { missingCount: 1 }), NOW, { configured: false })).toEqual([])
    expect(filesAlerts(null, NOW, { configured: true })).toEqual([])
    expect(filesAlerts(check(), NOW, { configured: true })).toEqual([])
    expect(filesCheckLevel(check(), NOW)).toBe("ok")
    expect(filesCheckLevel(null, NOW)).toBe("unknown")
  })

  it("keeps lost files and leftovers apart", () => {
    const c = check(
      { status: "problems" },
      {
        missingCount: 5,
        missing: [1, 2, 3, 4].map((n) => ({ key: k(n), fileId: uuid(n), name: n === 2 ? null : `F${n}`, size: 1 })),
        orphanCount: 1,
        orphanBytes: 2048,
      },
    )
    const alerts = filesAlerts(c, NOW, { configured: true })
    expect(alerts.map((a) => a.key)).toEqual(["files:missing", "files:orphans"])
    expect(alerts[0]).toMatchObject({ kind: "files", title: "Files storage: 5 files missing" })
    expect(alerts[0]!.detail).toContain("“F1”, another account's file, “F3” and 2 more")
    expect(alerts[1]!.title).toBe("Files storage: 1 orphaned object (2.0 KB)")
    expect(filesCheckLevel(c, NOW)).toBe("bad")
    expect(filesCheckLevel(check({ status: "problems" }, { orphanCount: 1 }), NOW)).toBe("warn")
  })

  it("says when the check failed or stopped running", () => {
    const failed = filesAlerts({ status: "error", checkedAt: ago(1).toISOString(), durationMs: 1, error: "Access Denied", findings: null }, NOW, {
      configured: true,
    })
    expect(failed).toEqual([expect.objectContaining({ key: "files:check", title: "Files storage check failed" })])
    expect(failed[0]!.detail).toContain("Access Denied")

    const old = check({ checkedAt: ago(24 * (FILES_CHECK.staleAfterDays + 1)).toISOString() })
    const stale = filesAlerts(old, NOW, { configured: true })
    expect(stale).toEqual([expect.objectContaining({ key: "files:check" })])
    expect(stale[0]!.title).toMatch(/^Files storage not checked for 10 d/)
    expect(filesCheckLevel(old, NOW)).toBe("warn")
  })
})
