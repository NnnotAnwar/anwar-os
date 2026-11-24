import { describe, expect, it } from "vitest"
import { addDays, daysOfMonth, describeSchedule, EVERY_DAY, isScheduled, shiftMonth, toggleDay, weekdayOf, WEEKDAYS, WEEKENDS } from "./days"
import { bestStreak, currentStreak, recentDays } from "./streak"

// 2026-11-24 is a Tuesday.
const TUE = "2026-11-24"
const MWF = 0b001_0101 // Mon, Wed, Fri

const set = (...days: string[]) => new Set(days)
const back = (n: number) => addDays(TUE, -n)

describe("days", () => {
  it("knows weekdays Monday first", () => {
    expect(weekdayOf("2026-11-23")).toBe(0)
    expect(weekdayOf(TUE)).toBe(1)
    expect(weekdayOf("2026-11-29")).toBe(6)
  })

  it("schedules by mask", () => {
    expect(isScheduled(EVERY_DAY, TUE)).toBe(true)
    expect(isScheduled(MWF, TUE)).toBe(false)
    expect(isScheduled(MWF, "2026-11-23")).toBe(true)
    expect(isScheduled(WEEKENDS, "2026-11-28")).toBe(true)
  })

  it("describes schedules", () => {
    expect(describeSchedule(EVERY_DAY)).toBe("Every day")
    expect(describeSchedule(WEEKDAYS)).toBe("Weekdays")
    expect(describeSchedule(WEEKENDS)).toBe("Weekends")
    expect(describeSchedule(MWF)).toBe("Mon, Wed, Fri")
    expect(describeSchedule(toggleDay(EVERY_DAY, 6))).toBe("Mon, Tue, Wed, Thu, Fri, Sat")
  })

  it("does month and day arithmetic across years and DST", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30")
    expect(daysOfMonth("2028-02")).toHaveLength(29)
    expect(daysOfMonth("2026-11")[29]).toBe("2026-11-30")
    expect(shiftMonth("2026-01", -1)).toBe("2025-12")
    expect(shiftMonth("2026-12", 1)).toBe("2027-01")
  })
})

describe("current streak", () => {
  it("is zero without checks", () => {
    expect(currentStreak(EVERY_DAY, set(), TUE)).toBe(0)
  })

  it("counts today and the days before it", () => {
    expect(currentStreak(EVERY_DAY, set(TUE, back(1), back(2)), TUE)).toBe(3)
  })

  it("isn't broken by an unchecked today", () => {
    expect(currentStreak(EVERY_DAY, set(back(1), back(2)), TUE)).toBe(2)
  })

  it("is broken by a missed scheduled day", () => {
    expect(currentStreak(EVERY_DAY, set(TUE, back(2), back(3)), TUE)).toBe(1)
  })

  it("skips days the habit isn't scheduled on", () => {
    // Mon 23, Fri 20, Wed 18 done; today (Tue) isn't scheduled.
    expect(currentStreak(MWF, set("2026-11-23", "2026-11-20", "2026-11-18"), TUE)).toBe(3)
    // Missing Fri 20 breaks it after Monday.
    expect(currentStreak(MWF, set("2026-11-23", "2026-11-18"), TUE)).toBe(1)
  })

  it("ignores checks on unscheduled days", () => {
    expect(currentStreak(MWF, set(TUE, "2026-11-23"), TUE)).toBe(1)
  })
})

describe("best streak", () => {
  it("finds the longest run in the history", () => {
    const done = set(back(10), back(9), back(8), back(7), back(5), back(4), TUE)
    expect(bestStreak(EVERY_DAY, done, TUE)).toBe(4)
  })

  it("includes the current run and an unchecked today doesn't end it", () => {
    expect(bestStreak(EVERY_DAY, set(back(3), back(2), back(1)), TUE)).toBe(3)
  })

  it("is zero without checks and ignores future ones", () => {
    expect(bestStreak(EVERY_DAY, set(), TUE)).toBe(0)
    expect(bestStreak(EVERY_DAY, set(addDays(TUE, 2)), TUE)).toBe(0)
  })
})

describe("recent days", () => {
  it("ends today, oldest first, with schedule and checks", () => {
    const days = recentDays(MWF, set("2026-11-23"), TUE, 3)
    expect(days).toEqual([
      { day: "2026-11-22", scheduled: false, done: false },
      { day: "2026-11-23", scheduled: true, done: true },
      { day: TUE, scheduled: false, done: false },
    ])
    expect(recentDays(EVERY_DAY, set(), TUE)).toHaveLength(30)
  })
})
