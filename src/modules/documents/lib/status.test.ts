import { describe, expect, it } from "vitest"
import { daysBetween, formatDate, isIsoDay } from "./dates"
import { describeReminders, reminderLabel } from "./format"
import { documentStatus, expiredAgo, inDays, needsAttention } from "./status"

const TODAY = "2026-11-25"

describe("documentStatus", () => {
  it("is valid beyond 90 days", () => {
    expect(documentStatus("2027-11-25", TODAY)).toEqual({ tone: "valid", daysLeft: 365, label: "Valid", detail: "Valid until 25 Nov 2027" })
    expect(documentStatus("2026-02-24", "2025-11-25").tone).toBe("valid") // 91 days
  })

  it("expires soon within 90 days, and needs attention within 30", () => {
    expect(documentStatus("2027-02-23", TODAY)).toMatchObject({ tone: "soon", daysLeft: 90, label: "Expires in 90 days" })
    expect(documentStatus("2026-12-26", TODAY)).toMatchObject({ tone: "soon", daysLeft: 31 })
    expect(documentStatus("2026-12-25", TODAY)).toMatchObject({
      tone: "urgent",
      daysLeft: 30,
      label: "Expires in 30 days",
      detail: "Expires in 30 days · 25 Dec 2026",
    })
  })

  it("says tomorrow and today", () => {
    expect(documentStatus("2026-11-26", TODAY).label).toBe("Expires tomorrow")
    expect(documentStatus(TODAY, TODAY)).toMatchObject({ tone: "urgent", daysLeft: 0, label: "Expires today" })
  })

  it("is expired from the day after the expiry date", () => {
    expect(documentStatus("2026-11-24", TODAY)).toMatchObject({ tone: "expired", daysLeft: -1, label: "Expired", detail: "Expired today · 24 Nov 2026" })
    expect(documentStatus("2026-11-23", TODAY).detail).toBe("Expired yesterday · 23 Nov 2026")
    expect(documentStatus("2026-11-15", TODAY).detail).toBe("Expired 9 days ago · 15 Nov 2026")
  })

  it("flags urgent and expired documents for the badge", () => {
    expect(needsAttention(documentStatus("2026-12-25", TODAY))).toBe(true)
    expect(needsAttention(documentStatus("2026-11-01", TODAY))).toBe(true)
    expect(needsAttention(documentStatus("2026-12-26", TODAY))).toBe(false)
  })

  it("words relative days", () => {
    expect([inDays(0), inDays(1), inDays(2)]).toEqual(["today", "tomorrow", "in 2 days"])
    expect([expiredAgo(-1), expiredAgo(-2), expiredAgo(-5)]).toEqual(["today", "yesterday", "4 days ago"])
  })
})

describe("dates", () => {
  it("validates ISO days strictly", () => {
    expect(isIsoDay("2028-02-29")).toBe(true)
    expect(isIsoDay("2026-02-29")).toBe(false)
    expect(isIsoDay("2026-13-01")).toBe(false)
    expect(isIsoDay("24.12.2026")).toBe(false)
  })

  it("counts days and formats dates like the bot", () => {
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1)
    expect(daysBetween("2027-01-01", "2026-12-31")).toBe(-1)
    expect(formatDate("2026-12-24")).toBe("24 Dec 2026")
  })
})

describe("reminder wording", () => {
  it("describes the offsets", () => {
    expect(describeReminders([90, 30, 7, 0])).toBe("90, 30 and 7 days before, and on the day")
    expect(describeReminders([30])).toBe("30 days before")
    expect(describeReminders([1])).toBe("1 day before")
    expect(describeReminders([0])).toBe("on the day")
    expect(describeReminders([])).toBe("No reminders")
  })

  it("labels a chip", () => {
    expect([reminderLabel(0), reminderLabel(1), reminderLabel(30)]).toEqual(["On the day", "1 day", "30 days"])
  })
})
