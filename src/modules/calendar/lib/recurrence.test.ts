import { describe, expect, it } from "vitest"
import { calendarCategories as schemaCategories } from "@/db/schema/calendar"
import { calendarCategories } from "./categories"
import { describeRecurrence, expandEvent, formatRRule, parseRRule, type ExpandableEvent } from "./recurrence"
import { wallClock, zonedToUtc } from "./zoned"

const PRAGUE = "Europe/Prague"
const prague = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  zonedToUtc({ year: y, month: mo, day: d, hour: h, minute: mi }, PRAGUE)
const utc = (iso: string) => new Date(iso)
const wall = (instant: Date) => {
  const w = wallClock(instant, PRAGUE)
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")} ${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`
}

describe("zonedToUtc (Europe/Prague)", () => {
  it("applies winter and summer offsets", () => {
    expect(prague(2026, 1, 15, 9).toISOString()).toBe("2026-01-15T08:00:00.000Z")
    expect(prague(2026, 7, 15, 9).toISOString()).toBe("2026-07-15T07:00:00.000Z")
  })

  it("moves a time in the spring-forward gap forward by the gap", () => {
    // 29 Mar 2026: clocks jump 02:00 → 03:00.
    expect(prague(2026, 3, 29, 2, 30).toISOString()).toBe("2026-03-29T01:30:00.000Z")
    expect(wall(prague(2026, 3, 29, 2, 30))).toBe("2026-03-29 03:30")
  })

  it("resolves an ambiguous autumn time to its first occurrence", () => {
    // 25 Oct 2026: 02:30 happens at 00:30Z (CEST) and again at 01:30Z (CET).
    expect(prague(2026, 10, 25, 2, 30).toISOString()).toBe("2026-10-25T00:30:00.000Z")
  })
})

describe("RRULE parsing and formatting", () => {
  it("round-trips the supported subset", () => {
    const cases: [string, boolean][] = [
      ["FREQ=DAILY", false],
      ["FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=10", false],
      ["FREQ=MONTHLY;UNTIL=20261231T225959Z", false],
      ["FREQ=YEARLY;UNTIL=20301231", true],
    ]
    for (const [rule, allDay] of cases) expect(formatRRule(parseRRule(rule)!, allDay)).toBe(rule)
  })

  it("sorts and dedupes weekdays and drops INTERVAL=1", () => {
    expect(formatRRule(parseRRule("FREQ=WEEKLY;INTERVAL=1;BYDAY=FR,MO,FR")!, false)).toBe("FREQ=WEEKLY;BYDAY=MO,FR")
  })

  it("rejects anything outside the subset", () => {
    for (const rule of [
      "",
      "FREQ=HOURLY",
      "FREQ=MONTHLY;BYDAY=1MO",
      "FREQ=WEEKLY;BYDAY=XX",
      "FREQ=DAILY;INTERVAL=0",
      "FREQ=DAILY;COUNT=2;UNTIL=20261231",
      "FREQ=DAILY;BYMONTH=2",
      "FREQ=DAILY;FREQ=WEEKLY",
      "FREQ=DAILY;UNTIL=2026-12-31",
    ]) {
      expect(parseRRule(rule), rule).toBeNull()
    }
  })
})

describe("expandEvent", () => {
  const weeklyStandup: ExpandableEvent = {
    start: prague(2026, 3, 16, 9),
    end: prague(2026, 3, 16, 9, 30),
    allDay: false,
    timezone: PRAGUE,
    rrule: "FREQ=WEEKLY;BYDAY=MO",
  }

  it("returns a single event when it overlaps the range, nothing otherwise", () => {
    const one = { ...weeklyStandup, rrule: null }
    expect(expandEvent(one, prague(2026, 3, 16), prague(2026, 3, 17))).toHaveLength(1)
    expect(expandEvent(one, prague(2026, 3, 17), prague(2026, 3, 18))).toHaveLength(0)
  })

  it("keeps a weekly meeting at 09:00 local across the spring DST change", () => {
    const instances = expandEvent(weeklyStandup, prague(2026, 3, 1), prague(2026, 4, 14))
    expect(instances.map((i) => wall(i.start))).toEqual([
      "2026-03-16 09:00",
      "2026-03-23 09:00",
      "2026-03-30 09:00",
      "2026-04-06 09:00",
      "2026-04-13 09:00",
    ])
    // Same wall time, different UTC time on each side of 29 March.
    expect(instances[1]!.start.toISOString()).toBe("2026-03-23T08:00:00.000Z")
    expect(instances[2]!.start.toISOString()).toBe("2026-03-30T07:00:00.000Z")
    expect(instances.every((i) => i.end.getTime() - i.start.getTime() === 30 * 60_000)).toBe(true)
  })

  it("keeps a daily 08:00 at 08:00 across the autumn DST change", () => {
    const daily: ExpandableEvent = { ...weeklyStandup, start: prague(2026, 10, 23, 8), end: prague(2026, 10, 23, 9), rrule: "FREQ=DAILY" }
    const instances = expandEvent(daily, prague(2026, 10, 24), prague(2026, 10, 27))
    expect(instances.map((i) => wall(i.start))).toEqual(["2026-10-24 08:00", "2026-10-25 08:00", "2026-10-26 08:00"])
    expect(instances.map((i) => i.start.toISOString())).toEqual([
      "2026-10-24T06:00:00.000Z",
      "2026-10-25T07:00:00.000Z",
      "2026-10-26T07:00:00.000Z",
    ])
  })

  it("moves an instance that falls in the spring gap forward, then resumes", () => {
    const night: ExpandableEvent = { ...weeklyStandup, start: prague(2026, 3, 27, 2, 30), end: prague(2026, 3, 27, 3), rrule: "FREQ=DAILY;COUNT=4" }
    const instances = expandEvent(night, prague(2026, 3, 1), prague(2026, 4, 30))
    expect(instances.map((i) => wall(i.start))).toEqual([
      "2026-03-27 02:30",
      "2026-03-28 02:30",
      "2026-03-29 03:30",
      "2026-03-30 02:30",
    ])
  })

  it("expands several weekdays with an interval", () => {
    const rule: ExpandableEvent = { ...weeklyStandup, start: prague(2026, 11, 2, 18), end: prague(2026, 11, 2, 19), rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH" }
    const instances = expandEvent(rule, prague(2026, 11, 1), prague(2026, 12, 1))
    expect(instances.map((i) => wall(i.start).slice(0, 10))).toEqual([
      "2026-11-02",
      "2026-11-05",
      "2026-11-16",
      "2026-11-19",
      "2026-11-30",
    ])
  })

  it("counts COUNT from the first instance even when the range starts later", () => {
    const rule: ExpandableEvent = { ...weeklyStandup, rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=3" }
    expect(expandEvent(rule, prague(2026, 3, 1), prague(2026, 12, 1))).toHaveLength(3)
    const later = expandEvent(rule, prague(2026, 3, 24), prague(2026, 12, 1))
    expect(later.map((i) => wall(i.start))).toEqual(["2026-03-30 09:00"])
  })

  it("stops at UNTIL, inclusive", () => {
    const rule: ExpandableEvent = { ...weeklyStandup, rrule: `FREQ=WEEKLY;UNTIL=20260330T070000Z` }
    const instances = expandEvent(rule, prague(2026, 3, 1), prague(2026, 12, 1))
    expect(instances.map((i) => wall(i.start))).toEqual(["2026-03-16 09:00", "2026-03-23 09:00", "2026-03-30 09:00"])
  })

  it("skips months without the start's day", () => {
    const rule: ExpandableEvent = { ...weeklyStandup, start: prague(2026, 1, 31, 12), end: prague(2026, 1, 31, 13), rrule: "FREQ=MONTHLY" }
    const instances = expandEvent(rule, prague(2026, 1, 1), prague(2026, 8, 1))
    expect(instances.map((i) => wall(i.start).slice(0, 10))).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
      "2026-07-31",
    ])
  })

  it("repeats a Feb 29 birthday only in leap years", () => {
    const birthday: ExpandableEvent = {
      start: utc("2024-02-29T00:00:00Z"),
      end: utc("2024-03-01T00:00:00Z"),
      allDay: true,
      timezone: PRAGUE,
      rrule: "FREQ=YEARLY",
    }
    const instances = expandEvent(birthday, utc("2024-01-01T00:00:00Z"), utc("2033-01-01T00:00:00Z"))
    expect(instances.map((i) => i.start.toISOString().slice(0, 10))).toEqual(["2024-02-29", "2028-02-29", "2032-02-29"])
  })

  it("expands all-day events on dates, independent of zone", () => {
    const allDay: ExpandableEvent = {
      start: utc("2026-03-28T00:00:00Z"),
      end: utc("2026-03-29T00:00:00Z"),
      allDay: true,
      timezone: PRAGUE,
      rrule: "FREQ=DAILY;COUNT=3",
    }
    const instances = expandEvent(allDay, utc("2026-03-01T00:00:00Z"), utc("2026-04-01T00:00:00Z"))
    expect(instances.map((i) => i.start.toISOString())).toEqual([
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      "2026-03-30T00:00:00.000Z",
    ])
  })

  it("includes an instance that started before the range but is still running", () => {
    const multiDay: ExpandableEvent = { ...weeklyStandup, end: prague(2026, 3, 18, 9), rrule: "FREQ=WEEKLY" }
    const instances = expandEvent(multiDay, prague(2026, 3, 24), prague(2026, 3, 25))
    expect(instances.map((i) => wall(i.start))).toEqual(["2026-03-23 09:00"])
  })

  it("stays fast and correct far into an open-ended daily series", () => {
    const daily: ExpandableEvent = { ...weeklyStandup, start: prague(2020, 1, 1, 7), end: prague(2020, 1, 1, 8), rrule: "FREQ=DAILY" }
    const instances = expandEvent(daily, prague(2030, 6, 10), prague(2030, 6, 12))
    expect(instances.map((i) => wall(i.start))).toEqual(["2030-06-10 07:00", "2030-06-11 07:00"])
  })
})

describe("describeRecurrence", () => {
  it("reads naturally", () => {
    expect(describeRecurrence(parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE")!, "en", false, PRAGUE)).toBe(
      "Every 2 weeks on Mon, Wed",
    )
    expect(describeRecurrence(parseRRule("FREQ=YEARLY")!, "en", true, PRAGUE)).toBe("Yearly")
    expect(describeRecurrence(parseRRule("FREQ=DAILY;COUNT=5")!, "en", false, PRAGUE)).toBe("Daily, 5 times")
    expect(describeRecurrence(parseRRule("FREQ=MONTHLY;UNTIL=20261231")!, "en", true, PRAGUE)).toBe(
      "Monthly, until 31 Dec 2026",
    )
  })
})

describe("categories", () => {
  it("match the database constraint", () => {
    expect([...calendarCategories]).toEqual([...schemaCategories])
  })
})
