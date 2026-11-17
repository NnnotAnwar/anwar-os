import { describe, expect, it } from "vitest"
import { dragSpan, slotAt, snap, spanToFields } from "./drag"

describe("snap and slotAt", () => {
  it("snaps to 15 minutes", () => {
    expect(snap(67)).toBe(60)
    expect(snap(68)).toBe(75)
  })
  it("turns a tap into the half hour it hit, one hour long", () => {
    expect(slotAt(44 * 9 + 30, 44)).toEqual({ start: 9 * 60 + 30, end: 10 * 60 + 30 })
    expect(slotAt(44 * 23.9, 44).start).toBe(23 * 60 + 30)
  })
})

describe("dragSpan", () => {
  const from = { day: 2, start: 9 * 60, end: 10 * 60 }
  it("moves both ends and keeps the length", () => {
    expect(dragSpan(from, { minutes: 37, days: 1 }, "move")).toEqual({ day: 3, start: 9 * 60 + 30, end: 10 * 60 + 30 })
  })
  it("stays inside the day and the week", () => {
    expect(dragSpan(from, { minutes: -600, days: -5 }, "move")).toEqual({ day: 0, start: 0, end: 60 })
    expect(dragSpan(from, { minutes: 900, days: 9 }, "move")).toEqual({ day: 6, start: 23 * 60, end: 24 * 60 })
  })
  it("resizes the end only, never below 15 minutes", () => {
    expect(dragSpan(from, { minutes: 50, days: 3 }, "resize")).toEqual({ day: 2, start: 540, end: 645 })
    expect(dragSpan(from, { minutes: -120, days: 0 }, "resize").end).toBe(555)
  })
})

describe("spanToFields", () => {
  const monday = { year: 2026, month: 11, day: 16 }
  it("keeps wall times in the same zone", () => {
    expect(spanToFields({ day: 1, start: 14 * 60, end: 15 * 60 + 30 }, monday, "Europe/Prague", "Europe/Prague")).toEqual({
      startDate: "2026-11-17",
      startTime: "14:00",
      endDate: "2026-11-17",
      endTime: "15:30",
    })
  })
  it("converts into the event's own zone", () => {
    // 14:00 in Prague (UTC+1 in November) is evening in Almaty, several hours ahead.
    const f = spanToFields({ day: 0, start: 14 * 60, end: 15 * 60 }, monday, "Europe/Prague", "Asia/Almaty")
    expect(f.startDate).toBe("2026-11-16")
    expect(["18:00", "19:00"]).toContain(f.startTime)
  })
  it("an event ending at midnight ends on the next day", () => {
    const f = spanToFields({ day: 6, start: 23 * 60, end: 24 * 60 }, monday, "UTC", "UTC")
    expect(f).toEqual({ startDate: "2026-11-22", startTime: "23:00", endDate: "2026-11-23", endTime: "00:00" })
  })
})
