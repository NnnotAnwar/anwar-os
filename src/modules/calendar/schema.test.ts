import { describe, expect, it } from "vitest"
import { eventFields, rangeInput, toEventFields, toEventRow, type EventFields } from "./schema"

const base = eventFields.parse({
  title: "Standup",
  allDay: false,
  startDate: "2026-11-16",
  startTime: "09:00",
  endDate: "2026-11-16",
  endTime: "09:15",
  timezone: "Europe/Prague",
})

describe("toEventRow", () => {
  it("reads timed events as wall-clock time in their zone", () => {
    const row = toEventRow(base)
    expect(row.startAt.toISOString()).toBe("2026-11-16T08:00:00.000Z")
    expect(row.endAt.toISOString()).toBe("2026-11-16T08:15:00.000Z")
    expect(row.rrule).toBeNull()
  })

  it("stores all-day events as UTC midnights with an exclusive end", () => {
    const row = toEventRow({ ...base, allDay: true, endDate: "2026-11-18" })
    expect(row.startAt.toISOString()).toBe("2026-11-16T00:00:00.000Z")
    expect(row.endAt.toISOString()).toBe("2026-11-19T00:00:00.000Z")
  })

  it("refuses an end before the start", () => {
    expect(() => toEventRow({ ...base, endTime: "08:00" })).toThrow(/end before/)
    expect(() => toEventRow({ ...base, allDay: true, endDate: "2026-11-15" })).toThrow(/end before/)
  })

  it("adds the start's weekday to a weekly repeat", () => {
    const row = toEventRow({ ...base, repeat: { freq: "weekly", interval: 1, byWeekday: [3], ends: { type: "never" } } })
    expect(row.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,WE")
  })

  it("ends a timed repeat at the end of the until-date in the event's zone", () => {
    const row = toEventRow({ ...base, repeat: { freq: "daily", interval: 2, ends: { type: "until", date: "2026-12-31" } } })
    // 31 Dec 23:59:59 in Prague (CET) is 22:59:59Z.
    expect(row.rrule).toBe("FREQ=DAILY;INTERVAL=2;UNTIL=20261231T225959Z")
  })

  it("ends an all-day repeat on a date, or after a count", () => {
    expect(toEventRow({ ...base, allDay: true, repeat: { freq: "yearly", interval: 1, ends: { type: "until", date: "2030-11-16" } } }).rrule).toBe(
      "FREQ=YEARLY;UNTIL=20301116",
    )
    expect(toEventRow({ ...base, repeat: { freq: "monthly", interval: 1, ends: { type: "count", count: 6 } } }).rrule).toBe(
      "FREQ=MONTHLY;COUNT=6",
    )
  })

  it("refuses a repeat that ends before the event", () => {
    expect(() => toEventRow({ ...base, repeat: { freq: "daily", interval: 1, ends: { type: "until", date: "2026-11-01" } } })).toThrow()
  })
})

describe("toEventFields", () => {
  const roundTrip = (fields: EventFields) => toEventFields({ ...toEventRow(fields), reminders: fields.reminders })

  it("round-trips timed, all-day and repeating events", () => {
    const cases: EventFields[] = [
      { ...base, reminders: [10, 0] },
      { ...base, allDay: true, startTime: undefined, endTime: undefined, endDate: "2026-11-18" },
      { ...base, repeat: { freq: "weekly", interval: 2, byWeekday: [1, 4], ends: { type: "until", date: "2027-03-31" } } },
      { ...base, allDay: true, startTime: undefined, endTime: undefined, repeat: { freq: "yearly", interval: 1, byWeekday: undefined, ends: { type: "never" } } },
    ]
    for (const fields of cases) {
      expect(roundTrip(fields)).toEqual({ ...fields, reminders: [...fields.reminders].sort((a, b) => a - b) })
    }
  })

  it("keeps the wall-clock time of a summer event", () => {
    const fields = { ...base, startDate: "2026-07-01", endDate: "2026-07-01" }
    expect(toEventRow(fields).startAt.toISOString()).toBe("2026-07-01T07:00:00.000Z")
    expect(roundTrip(fields).startTime).toBe("09:00")
  })
})

describe("rangeInput", () => {
  it("takes Dates in-process and ISO strings over JSON (MCP, HTTP API)", () => {
    const from = new Date("2026-11-01T00:00:00Z")
    expect(rangeInput.parse({ from, to: from })).toEqual({ from, to: from })
    expect(rangeInput.parse({ from: "2026-11-01", to: "2026-12-01T09:30:00+01:00" })).toEqual({
      from,
      to: new Date("2026-12-01T08:30:00Z"),
    })
  })

  it("rejects what isn't an instant", () => {
    expect(rangeInput.safeParse({ from: "tomorrow", to: "2026-12-01" }).success).toBe(false)
    expect(rangeInput.safeParse({ from: "2026-13-01", to: "2026-12-01" }).success).toBe(false)
    expect(rangeInput.safeParse({ from: 1764547200000, to: "2026-12-01" }).success).toBe(false)
  })
})
