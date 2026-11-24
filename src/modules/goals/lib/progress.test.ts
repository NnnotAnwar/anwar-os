import { describe, expect, it } from "vitest"
import { goalProgress, pace, percent, progressLabel, yearElapsed } from "./progress"

const base = { status: "active" as const, targetValue: null, targetUnit: "", currentValue: 0, tasksDone: 0, tasksTotal: 0 }

describe("goalProgress", () => {
  it("counts a measurable goal by its own number, capped at 100 %", () => {
    const p = goalProgress({ ...base, targetValue: 20, targetUnit: "books", currentValue: 5 })
    expect(p).toEqual({ kind: "target", current: 5, target: 20, unit: "books", ratio: 0.25 })
    expect(goalProgress({ ...base, targetValue: 20, currentValue: 23 }).ratio).toBe(1)
  })

  it("falls back to linked tasks when there is no target", () => {
    expect(goalProgress({ ...base, tasksDone: 3, tasksTotal: 8 })).toEqual({ kind: "tasks", done: 3, total: 8, ratio: 0.375 })
  })

  it("has no measure without a target or tasks", () => {
    expect(goalProgress(base)).toEqual({ kind: "none", ratio: null })
  })

  it("is full once achieved, whatever the count says", () => {
    expect(goalProgress({ ...base, status: "done", targetValue: 20, currentValue: 4 }).ratio).toBe(1)
    expect(goalProgress({ ...base, status: "done", tasksDone: 1, tasksTotal: 4 }).ratio).toBe(1)
    expect(goalProgress({ ...base, status: "done" }).ratio).toBe(1)
  })
})

describe("labels", () => {
  it("says what was done of what", () => {
    expect(progressLabel(goalProgress({ ...base, targetValue: 1000, targetUnit: "km", currentValue: 250.5 }), "en-US")).toBe(
      "250.5 of 1,000 km",
    )
    expect(progressLabel(goalProgress({ ...base, tasksDone: 1, tasksTotal: 1 }), "en-US")).toBe("1 of 1 task")
    expect(progressLabel(goalProgress(base), "en-US")).toBe("No measure yet")
    expect(percent(goalProgress({ ...base, tasksDone: 1, tasksTotal: 3 }))).toBe(33)
    expect(percent(goalProgress(base))).toBeNull()
  })
})

describe("pace", () => {
  it("compares progress with how much of the year has passed", () => {
    expect(yearElapsed({ year: 2026, month: 1, day: 1 })).toBeCloseTo(1 / 365)
    expect(yearElapsed({ year: 2026, month: 12, day: 31 })).toBe(1)
    const half = yearElapsed({ year: 2026, month: 7, day: 2 })
    const p = (ratio: number) => goalProgress({ ...base, targetValue: 100, currentValue: ratio * 100 })
    expect(pace(p(0.5), "active", half)).toBe("on-track")
    expect(pace(p(0.8), "active", half)).toBe("ahead")
    expect(pace(p(0.2), "active", half)).toBe("behind")
    expect(pace(p(0.2), "dropped", half)).toBeNull()
    expect(pace(goalProgress(base), "active", half)).toBeNull()
    expect(pace(p(0.2), "active", null)).toBeNull()
  })
})
