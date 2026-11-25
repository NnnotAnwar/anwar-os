import { describe, expect, it } from "vitest"
import { errorWhere, hourlySeries, last24h, moveError, planErrorAlerts } from "./errors-view"

describe("hourly series", () => {
  const now = new Date("2026-12-01T12:30:00Z")
  const series = [...Array(23).fill(0), 5]

  it("is as stored when it was updated this hour", () => {
    expect(hourlySeries(series, "2026-12-01T12:00:00Z", now)).toEqual(series)
    expect(last24h(series, "2026-12-01T12:00:00Z", now)).toBe(5)
  })

  it("slides to the current hour", () => {
    const out = hourlySeries(series, "2026-12-01T09:00:00Z", now)
    expect(out).toHaveLength(24)
    expect(out[20]).toBe(5)
    expect(out.slice(21)).toEqual([0, 0, 0])
  })

  it("is empty after a day of quiet, and pads short arrays", () => {
    expect(last24h(series, "2026-11-30T11:00:00Z", now)).toBe(0)
    expect(hourlySeries([2], "2026-12-01T12:00:00Z", now)).toEqual([...Array(23).fill(0), 2])
  })
})

describe("planErrorAlerts", () => {
  it("sends each while the hour's budget lasts", () => {
    expect(planErrorAlerts([1, 2], 0, 4)).toEqual({ singles: [1, 2], summary: [], held: [] })
  })

  it("folds the rest into one summary as the last message of the budget", () => {
    expect(planErrorAlerts([1, 2, 3, 4, 5, 6], 0, 4)).toEqual({ singles: [1, 2, 3], summary: [4, 5, 6], held: [] })
    expect(planErrorAlerts([1, 2, 3], 3, 4)).toEqual({ singles: [], summary: [1, 2, 3], held: [] })
  })

  it("holds everything once the budget is spent", () => {
    expect(planErrorAlerts([1], 4, 4)).toEqual({ singles: [], summary: [], held: [1] })
  })
})

describe("errorWhere", () => {
  it("says where, in words", () => {
    expect(errorWhere({ source: "web", route: "/app/notes/[id]", method: "GET", routeType: "render" })).toBe("GET /app/notes/[id]")
    expect(errorWhere({ source: "web", route: "/app/ops", method: "POST", routeType: "action" })).toBe("Server action /app/ops")
    expect(errorWhere({ source: "web", route: "", method: "", routeType: "process" })).toBe("Background")
    expect(errorWhere({ source: "osbot", route: "capture", method: "", routeType: "bot" })).toBe("osbot · capture")
  })
})

describe("moveError (Resolve and Undo before the server answers)", () => {
  const g = (id: string, lastSeen: string, status: "open" | "resolved" = "open") => ({ id, lastSeen, status, resolvedAt: null as string | null })
  const view = { open: [g("a", "2026-12-01T10:00:00Z"), g("b", "2026-12-01T09:00:00Z")], resolved: [g("c", "2026-11-30T09:00:00Z", "resolved")] }

  it("moves a resolved group to the top of resolved", () => {
    const out = moveError(view, "a", "resolved", "2026-12-01T12:00:00Z")
    expect(out.open.map((x) => x.id)).toEqual(["b"])
    expect(out.resolved.map((x) => x.id)).toEqual(["a", "c"])
    expect(out.resolved[0]).toMatchObject({ status: "resolved", resolvedAt: "2026-12-01T12:00:00Z" })
  })

  it("puts an undone group back in open, newest seen first", () => {
    const resolved = moveError(view, "a", "resolved", "2026-12-01T12:00:00Z")
    const back = moveError(resolved, "a", "open", "2026-12-01T12:01:00Z")
    expect(back.open.map((x) => x.id)).toEqual(["a", "b"])
    expect(back.open[0]).toMatchObject({ status: "open", resolvedAt: null })
    expect(back.resolved.map((x) => x.id)).toEqual(["c"])
  })

  it("leaves the list alone for unknown ids or no change", () => {
    expect(moveError(view, "zzz", "resolved", "x")).toBe(view)
    expect(moveError(view, "a", "open", "x")).toBe(view)
  })
})
