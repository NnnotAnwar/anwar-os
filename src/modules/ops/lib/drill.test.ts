import { describe, expect, it } from "vitest"
import { opsBadge } from "./badge"
import { drillAlerts, drillFigures, drillLevel, drillReportInput, failedChecks, type Drill } from "./drill"

const now = new Date("2026-12-20T12:00:00Z")

const drill = (over: Partial<Drill> = {}): Drill => ({
  id: "d1",
  status: "ok",
  startedAt: "2026-12-01T04:00:00Z",
  finishedAt: "2026-12-01T04:02:14Z",
  durationMs: 134_000,
  backupFile: "anwar_os-2026-12-01T021503Z.dump.age",
  backupAt: "2026-12-01T02:15:03Z",
  backupBytes: 335_833,
  totalRows: 1234,
  checks: [{ name: "restore", ok: true, detail: "" }],
  error: null,
  runUrl: "https://github.com/o/r/actions/runs/1",
  commit: null,
  ...over,
})

describe("drillAlerts", () => {
  it("is quiet after a recent passing drill", () => {
    const d = drill()
    expect(drillAlerts({ configured: true, latest: d, lastOk: d }, now)).toEqual([])
    expect(drillLevel({ configured: true, latest: d, lastOk: d }, now)).toBe("ok")
  })

  it("fires when the latest drill failed, with what failed", () => {
    const failed = drill({
      status: "failed",
      checks: [
        { name: "restore", ok: true, detail: "" },
        { name: "rls", ok: false, detail: "public.foo has no policies" },
      ],
    })
    const [a] = drillAlerts({ configured: true, latest: failed, lastOk: drill() }, now)
    expect(a).toMatchObject({ key: "drill", kind: "drill", title: "Restore drill failed" })
    expect(a!.detail).toContain("rls: public.foo has no policies")
    expect(a!.detail).toContain("https://github.com/o/r/actions/runs/1")
  })

  it("fires when no drill passed for more than 35 days", () => {
    const old = drill({ finishedAt: "2026-11-10T04:00:00Z" })
    const [a] = drillAlerts({ configured: true, latest: old, lastOk: old }, now)
    expect(a?.title).toBe("No successful restore drill for 40 days")
    expect(drillLevel({ configured: true, latest: old, lastOk: old }, now)).toBe("bad")
  })

  it("doesn't nag before the first drill; the tile shows how to set it up", () => {
    expect(drillAlerts({ configured: false, latest: null, lastOk: null }, now)).toEqual([])
    expect(drillLevel({ configured: false, latest: null, lastOk: null }, now)).toBe("warn")
  })

  it("names the setup when the drill can't report and is stale", () => {
    const old = drill({ finishedAt: "2026-10-01T04:00:00Z" })
    const [a] = drillAlerts({ configured: false, latest: old, lastOk: old }, now)
    expect(a?.detail).toContain("RESTORE_DRILL_SECRET")
  })
})

describe("drill report", () => {
  it("accepts drill.sh's report and fills defaults", () => {
    const r = drillReportInput.parse({
      status: "ok",
      startedAt: "2026-12-01T04:00:00Z",
      finishedAt: "2026-12-01T04:02:14Z",
      durationMs: 134000,
      tables: { "auth.user": 1, "public.notes_notes": 40 },
    })
    expect(r.backup).toEqual({ file: "", at: null, bytes: null })
    expect(r.checks).toEqual([])
  })

  it("refuses odd table names, URLs and commits", () => {
    const base = { status: "ok", startedAt: "2026-12-01T04:00:00Z", finishedAt: "2026-12-01T04:02:14Z", durationMs: 1 }
    expect(drillReportInput.safeParse({ ...base, tables: { "users; drop": 1 } }).success).toBe(false)
    expect(drillReportInput.safeParse({ ...base, runUrl: "javascript:alert(1)" }).success).toBe(false)
    expect(drillReportInput.safeParse({ ...base, commit: "not-a-sha" }).success).toBe(false)
    expect(drillReportInput.safeParse({ ...base, backup: { file: "../../etc" } }).success).toBe(false)
  })

  it("summarizes", () => {
    expect(failedChecks({ error: "decrypt failed", checks: [{ name: "x", ok: false, detail: "" }] })).toBe("decrypt failed · x")
    expect(drillFigures({ totalRows: 1234, backupBytes: 335_833 })).toBe("1,234 rows · 328 KB backup")
  })
})

describe("opsBadge", () => {
  it("adds services needing attention and open errors", () => {
    expect(opsBadge(0, 0)).toBeNull()
    expect(opsBadge(1, 0)).toEqual({ count: 1, label: "needs attention" })
    expect(opsBadge(0, 3)).toEqual({ count: 3, label: "errors" })
    expect(opsBadge(0, 1)).toEqual({ count: 1, label: "error" })
    expect(opsBadge(2, 1)).toEqual({ count: 3, label: "need attention" })
  })
})
