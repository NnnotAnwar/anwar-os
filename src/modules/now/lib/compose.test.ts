import { describe, expect, it } from "vitest"
import { habitsLine, latestDate, pickNowProjects, toNowGoal } from "./compose"

describe("toNowGoal", () => {
  const base = {
    id: "g1",
    title: "Read 20 books",
    target_value: 20,
    target_unit: "books",
    current_value: 12,
    status: "active",
    tasks_done: 0,
    tasks_total: 0,
    updated_at: new Date("2026-11-20T10:00:00.000Z"),
  }

  it("measures a target goal by its number", () => {
    expect(toNowGoal(base)).toEqual({
      id: "g1",
      title: "Read 20 books",
      status: "active",
      progress: { kind: "target", current: 12, target: 20, unit: "books", ratio: 0.6 },
      updatedAt: "2026-11-20T10:00:00.000Z",
    })
  })

  it("measures a goal without a target by its task counts, and an achieved one as full", () => {
    expect(toNowGoal({ ...base, target_value: null, tasks_done: 3, tasks_total: 4 }).progress).toEqual({
      kind: "tasks",
      done: 3,
      total: 4,
      ratio: 0.75,
    })
    expect(toNowGoal({ ...base, status: "done" }).progress.ratio).toBe(1)
  })
})

describe("pickNowProjects", () => {
  const p = (id: string, status: string, featured = false) => ({ id, status, featured })

  it("lists projects being built first, then featured ones, in the given order, up to the limit", () => {
    const picked = pickNowProjects([
      p("live-featured", "live", true),
      p("building-a", "building"),
      p("paused", "paused"),
      p("building-featured", "building", true),
      p("archived-featured", "archived", true),
    ])
    expect(picked.map((x) => x.id)).toEqual(["building-a", "building-featured", "live-featured", "archived-featured"])
    expect(pickNowProjects(picked, 2).map((x) => x.id)).toEqual(["building-a", "building-featured"])
  })

  it("leaves out projects that are neither being built nor featured", () => {
    expect(pickNowProjects([p("idea", "idea"), p("live", "live")])).toEqual([])
  })
})

describe("habitsLine", () => {
  it("reads as one aggregate line", () => {
    expect(habitsLine({ habits: 4, daily: 4, longestStreak: 23 })).toBe("4 daily habits · longest streak 23 days")
    expect(habitsLine({ habits: 3, daily: 1, longestStreak: 1 })).toBe("3 habits · longest streak 1 day")
    expect(habitsLine({ habits: 1, daily: 1, longestStreak: 0 })).toBe("1 daily habit")
  })

  it("says nothing without habits or while the section is off", () => {
    expect(habitsLine({ habits: 0, daily: 0, longestStreak: 0 })).toBeNull()
    expect(habitsLine(null)).toBeNull()
  })
})

describe("latestDate", () => {
  it("is the newest timestamp, or null", () => {
    expect(latestDate(["2026-11-01T00:00:00.000Z", null, "2026-11-24T10:00:00.000Z", undefined, "junk"])).toBe(
      "2026-11-24T10:00:00.000Z",
    )
    expect(latestDate([])).toBeNull()
  })
})
