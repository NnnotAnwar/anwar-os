import { describe, expect, it } from "vitest"
import { isTaskRRule, nextDueDate } from "./repeat"

const d = (month: number, day: number, year = 2026) => ({ year, month, day })
const today = d(11, 16) // Monday

describe("nextDueDate", () => {
  it("moves a daily task to the next day", () => {
    expect(nextDueDate("FREQ=DAILY", today, today)).toEqual(d(11, 17))
  })

  it("keeps a monthly task on its day of the month", () => {
    expect(nextDueDate("FREQ=MONTHLY", d(12, 1), today)).toEqual(d(1, 1, 2027))
    // Months without the 31st are skipped (RFC 5545), as in the calendar.
    expect(nextDueDate("FREQ=MONTHLY", d(1, 31, 2027), d(1, 31, 2027))).toEqual(d(3, 31, 2027))
  })

  it("follows weekdays within the week", () => {
    expect(nextDueDate("FREQ=WEEKLY;BYDAY=MO,TH", today, today)).toEqual(d(11, 19))
    expect(nextDueDate("FREQ=WEEKLY;BYDAY=MO,TH", d(11, 19), d(11, 19))).toEqual(d(11, 23))
  })

  it("skips occurrences already in the past when completing late", () => {
    expect(nextDueDate("FREQ=WEEKLY", d(10, 5), today)).toEqual(d(11, 16))
    expect(nextDueDate("FREQ=DAILY", d(11, 1), today)).toEqual(today)
  })

  it("honours intervals and the end of a series", () => {
    expect(nextDueDate("FREQ=YEARLY;INTERVAL=2", d(3, 2, 2027), today)).toEqual(d(3, 2, 2029))
    expect(nextDueDate("FREQ=DAILY;UNTIL=20261117", d(11, 17), today)).toBeNull()
  })

  it("returns null for rules it can't read", () => {
    expect(nextDueDate("FREQ=HOURLY", today, today)).toBeNull()
  })
})

describe("isTaskRRule", () => {
  it("accepts the calendar subset without COUNT", () => {
    expect(isTaskRRule("FREQ=WEEKLY;BYDAY=MO")).toBe(true)
    expect(isTaskRRule("FREQ=DAILY;COUNT=3")).toBe(false)
    expect(isTaskRRule("nonsense")).toBe(false)
  })
})
