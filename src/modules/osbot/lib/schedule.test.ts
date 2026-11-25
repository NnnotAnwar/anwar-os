import { describe, expect, it } from "vitest"
import { CUTOFF_MINUTES, dailySlot, ownerClock } from "./schedule"

const PRAGUE = "Europe/Prague"
const at = (iso: string) => new Date(iso)

describe("dailySlot", () => {
  it("is due from the time until the cut-off, then missed for the day", () => {
    // Prague in winter is UTC+1: 08:00 local = 07:00Z.
    expect(dailySlot(at("2026-11-25T06:59:00Z"), PRAGUE, "08:00")).toMatchObject({ date: "2026-11-25", state: "before" })
    expect(dailySlot(at("2026-11-25T07:00:00Z"), PRAGUE, "08:00")).toEqual({
      date: "2026-11-25",
      at: at("2026-11-25T07:00:00Z"),
      state: "due",
    })
    expect(dailySlot(at("2026-11-25T09:59:59Z"), PRAGUE, "08:00").state).toBe("due")
    // 11:00 local: the bot was down too long, no brief at lunch.
    expect(dailySlot(at("2026-11-25T10:00:00Z"), PRAGUE, "08:00")).toMatchObject({ date: "2026-11-25", state: "missed" })
    expect(dailySlot(at("2026-11-25T14:00:00Z"), PRAGUE, "08:00").state).toBe("missed")
    expect(CUTOFF_MINUTES).toBe(180)
  })

  it("keeps a window that runs past midnight on the day it started", () => {
    // 22:30 + 3 h = 01:30 the next day.
    expect(dailySlot(at("2026-11-25T21:29:00Z"), PRAGUE, "22:30")).toMatchObject({ date: "2026-11-25", state: "before" })
    expect(dailySlot(at("2026-11-25T23:15:00Z"), PRAGUE, "22:30")).toMatchObject({ date: "2026-11-25", state: "due" })
    // 00:15 on the 26th still answers for the 25th.
    expect(dailySlot(at("2026-11-26T00:29:00Z"), PRAGUE, "22:30")).toMatchObject({ date: "2026-11-25", state: "due" })
    // 01:30 on the 26th: the 25th's window closed, the 26th's hasn't opened.
    expect(dailySlot(at("2026-11-26T00:30:00Z"), PRAGUE, "22:30")).toMatchObject({ date: "2026-11-26", state: "before" })
  })

  it("treats 00:00 as the start of the day, not the end of the one before", () => {
    expect(dailySlot(at("2026-11-24T23:00:00Z"), PRAGUE, "00:00")).toMatchObject({ date: "2026-11-25", state: "due" })
    expect(dailySlot(at("2026-11-24T22:59:00Z"), PRAGUE, "00:00")).toMatchObject({ date: "2026-11-24", state: "missed" })
  })

  it("moves a time skipped by the spring-forward gap to after it", () => {
    // 29 March 2026: Prague jumps from 02:00 to 03:00 (CET → CEST). 02:30 doesn't exist: 03:30 CEST = 01:30Z.
    expect(dailySlot(at("2026-03-29T01:29:00Z"), PRAGUE, "02:30")).toMatchObject({ date: "2026-03-29", state: "before" })
    expect(dailySlot(at("2026-03-29T01:30:00Z"), PRAGUE, "02:30")).toEqual({
      date: "2026-03-29",
      at: at("2026-03-29T01:30:00Z"),
      state: "due",
    })
    // The morning after the change: 08:00 CEST = 06:00Z.
    expect(dailySlot(at("2026-03-29T05:59:00Z"), PRAGUE, "08:00").state).toBe("before")
    expect(dailySlot(at("2026-03-29T06:00:00Z"), PRAGUE, "08:00").state).toBe("due")
    expect(dailySlot(at("2026-03-29T09:00:00Z"), PRAGUE, "08:00").state).toBe("missed")
  })

  it("measures the window in real time when the clocks fall back inside it", () => {
    // 25 October 2026: 03:00 CEST → 02:00 CET. 01:00 CEST = 23:00Z on the 24th; three real hours = 02:00Z.
    expect(dailySlot(at("2026-10-24T23:00:00Z"), PRAGUE, "01:00")).toMatchObject({ date: "2026-10-25", state: "due" })
    // 02:59 CET (the second pass through 02:xx) is still inside.
    expect(dailySlot(at("2026-10-25T01:59:00Z"), PRAGUE, "01:00").state).toBe("due")
    expect(dailySlot(at("2026-10-25T02:00:00Z"), PRAGUE, "01:00").state).toBe("missed")
    // An ambiguous time (02:30 happens twice) is its first occurrence: 02:30 CEST = 00:30Z.
    expect(dailySlot(at("2026-10-25T00:30:00Z"), PRAGUE, "02:30")).toEqual({
      date: "2026-10-25",
      at: at("2026-10-25T00:30:00Z"),
      state: "due",
    })
  })

  it("follows the owner's zone, not the server's", () => {
    // 21:30 in New York (UTC−5 in November) = 02:30Z the next UTC day.
    const ny = dailySlot(at("2026-11-26T02:45:00Z"), "America/New_York", "21:30")
    expect(ny).toMatchObject({ date: "2026-11-25", state: "due" })
    expect(ny.at).toEqual(at("2026-11-26T02:30:00Z"))
    // Almaty (UTC+5): 08:00 = 03:00Z.
    expect(dailySlot(at("2026-11-25T03:30:00Z"), "Asia/Almaty", "08:00")).toMatchObject({ date: "2026-11-25", state: "due" })
  })

  it("takes a custom cut-off and refuses a bad time", () => {
    expect(dailySlot(at("2026-11-25T07:30:00Z"), PRAGUE, "08:00", 30).state).toBe("missed")
    expect(() => dailySlot(at("2026-11-25T07:30:00Z"), PRAGUE, "25:00")).toThrow()
  })
})

describe("ownerClock", () => {
  it("is the owner's date and time", () => {
    expect(ownerClock(at("2026-11-25T23:30:00Z"), PRAGUE)).toEqual({ today: "2026-11-26", time: "00:30" })
  })
})
