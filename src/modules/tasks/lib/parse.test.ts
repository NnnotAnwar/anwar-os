import { describe, expect, it } from "vitest"
import { parseTask } from "./parse"

// Monday 16 Nov 2026.
const today = { year: 2026, month: 11, day: 16 }
const d = (month: number, day: number, year = 2026) => ({ year, month, day })
const lists = ["University", "Planuj Směny", "Home"]
const parse = (text: string) => parseTask(text, today, lists)

describe("parseTask", () => {
  it("reads the owner's example in full", () => {
    expect(parse("Call the bank tomorrow 10:00 !high #University")).toEqual({
      title: "Call the bank",
      dueDate: d(11, 17),
      dueTime: { hour: 10, minute: 0 },
      priority: "high",
      list: "University",
      listExists: true,
      repeat: null,
      rrule: null,
    })
  })

  it("reads a monthly repeat on a day of the month and starts it on the next one", () => {
    const task = parse("Pay rent every month on 1st")
    expect(task.title).toBe("Pay rent")
    expect(task.rrule).toBe("FREQ=MONTHLY")
    expect(task.dueDate).toEqual(d(12, 1))
    expect(parse("Pay rent monthly on the 16th").dueDate).toEqual(d(11, 16))
    expect(parse("Invoice every 15th").dueDate).toEqual(d(12, 15))
  })

  it("leaves plain text alone", () => {
    const task = parse("Read chapter 5 of Clean Code")
    expect(task).toMatchObject({ title: "Read chapter 5 of Clean Code", dueDate: null, dueTime: null, priority: "none" })
    expect(parse("Ask May about the poster").dueDate).toBeNull()
    expect(parse("Buy 2 milk").title).toBe("Buy 2 milk")
  })

  describe("dates", () => {
    it("reads today, tonight, tomorrow and the day after", () => {
      expect(parse("Gym today").dueDate).toEqual(today)
      expect(parse("Pack tonight").dueDate).toEqual(today)
      expect(parse("Laundry tmrw").dueDate).toEqual(d(11, 17))
      expect(parse("Dentist day after tomorrow").dueDate).toEqual(d(11, 18))
    })

    it("reads weekdays as the next one, 'this' including today", () => {
      expect(parse("Lunch fri").dueDate).toEqual(d(11, 20))
      expect(parse("Report on Friday").title).toBe("Report")
      expect(parse("Review monday").dueDate).toEqual(d(11, 23))
      expect(parse("Review this monday").dueDate).toEqual(today)
      expect(parse("Plan next wednesday").dueDate).toEqual(d(11, 18))
    })

    it("reads relative spans", () => {
      expect(parse("Follow up in 3 days").dueDate).toEqual(d(11, 19))
      expect(parse("Follow up in 2 weeks").dueDate).toEqual(d(11, 30))
      expect(parse("Renew in a month").dueDate).toEqual(d(12, 16))
      expect(parse("Plan next week").dueDate).toEqual(d(11, 23))
      expect(parse("Budget next month").dueDate).toEqual(d(12, 1))
      expect(parse("Clean the flat this weekend").dueDate).toEqual(d(11, 21))
    })

    it("reads day-month dates in many spellings, rolling past dates into next year", () => {
      expect(parse("Exam 21 Nov").dueDate).toEqual(d(11, 21))
      expect(parse("Exam Nov 21").dueDate).toEqual(d(11, 21))
      expect(parse("Exam on the 21st of November").dueDate).toEqual(d(11, 21))
      expect(parse("Exam December 3rd, 2027").dueDate).toEqual(d(12, 3, 2027))
      expect(parse("Taxes 2 March").dueDate).toEqual(d(3, 2, 2027))
      expect(parse("Exam 2026-12-01").dueDate).toEqual(d(12, 1))
      expect(parse("Exam 21/11").dueDate).toEqual(d(11, 21))
      expect(parse("Exam on the 5th").dueDate).toEqual(d(12, 5))
    })

    it("reads Czech dates", () => {
      expect(parse("Odevzdat úkol 21. listopadu")).toMatchObject({ title: "Odevzdat úkol", dueDate: d(11, 21) })
      expect(parse("Zápis 3.12.").dueDate).toEqual(d(12, 3))
      expect(parse("Zápis 3. 12. 2027").dueDate).toEqual(d(12, 3, 2027))
      expect(parse("Nakoupit zítra").dueDate).toEqual(d(11, 17))
      expect(parse("Uklidit v pátek")).toMatchObject({ title: "Uklidit", dueDate: d(11, 20) })
      expect(parse("Zavolat pozítří").dueDate).toEqual(d(11, 18))
      expect(parse("Faktura 1. ledna").dueDate).toEqual(d(1, 1, 2027))
    })

    it("ignores impossible dates", () => {
      expect(parse("Party 31 Feb 2027").dueDate).toBeNull()
    })
  })

  describe("times", () => {
    it("reads 24-hour, am/pm and 'at' times", () => {
      expect(parse("Call 9:30 tomorrow").dueTime).toEqual({ hour: 9, minute: 30 })
      expect(parse("Call tomorrow at 3pm").dueTime).toEqual({ hour: 15, minute: 0 })
      expect(parse("Call 11:15 am").dueTime).toEqual({ hour: 11, minute: 15 })
      expect(parse("Call 12am").dueTime).toEqual({ hour: 0, minute: 0 })
      expect(parse("Call at 5").dueTime).toEqual({ hour: 17, minute: 0 })
      expect(parse("Call at 9").dueTime).toEqual({ hour: 9, minute: 0 })
      expect(parse("Lunch at noon").dueTime).toEqual({ hour: 12, minute: 0 })
    })

    it("puts a time without a date on today", () => {
      expect(parse("Standup 9:00")).toMatchObject({ title: "Standup", dueDate: today })
    })

    it("does not read a dotted date as a time", () => {
      expect(parse("Zápis 3.12. 10:00")).toMatchObject({ dueDate: d(12, 3), dueTime: { hour: 10, minute: 0 } })
    })
  })

  describe("priority", () => {
    it("reads marks and words", () => {
      expect(parse("Fix bug !").priority).toBe("low")
      expect(parse("Fix bug !!").priority).toBe("high")
      expect(parse("Fix bug !!!").priority).toBe("high")
      expect(parse("Fix bug !low").priority).toBe("low")
      expect(parse("Fix bug !h").priority).toBe("high")
      expect(parse("Fix bug !high").title).toBe("Fix bug")
    })

    it("leaves exclamations inside words alone", () => {
      expect(parse("Wow! Ship it").priority).toBe("none")
    })
  })

  describe("lists", () => {
    it("matches known lists, multi-word ones included, ignoring case and diacritics", () => {
      expect(parse("Shift swap #Planuj Směny tomorrow")).toMatchObject({
        title: "Shift swap",
        list: "Planuj Směny",
        listExists: true,
        dueDate: d(11, 17),
      })
      expect(parse("Shift swap #planuj_smeny").list).toBe("Planuj Směny")
      expect(parse("Essay #university").list).toBe("University")
    })

    it("keeps an unknown tag as a new list name", () => {
      expect(parse("Pack #Travel")).toMatchObject({ title: "Pack", list: "Travel", listExists: false })
    })
  })

  describe("repeats", () => {
    it("reads simple frequencies and starts today", () => {
      expect(parse("Vitamins every day")).toMatchObject({ title: "Vitamins", rrule: "FREQ=DAILY", dueDate: today })
      expect(parse("Water plants daily").rrule).toBe("FREQ=DAILY")
      expect(parse("Review weekly").rrule).toBe("FREQ=WEEKLY")
      expect(parse("Backup every 3 days").rrule).toBe("FREQ=DAILY;INTERVAL=3")
      expect(parse("Sync every other week").rrule).toBe("FREQ=WEEKLY;INTERVAL=2")
      expect(parse("Renew yearly").rrule).toBe("FREQ=YEARLY")
    })

    it("reads weekdays and starts on the first matching day", () => {
      expect(parse("Standup every weekday 9:00")).toMatchObject({
        rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        dueDate: today,
        dueTime: { hour: 9, minute: 0 },
      })
      expect(parse("Run every Tue and Thu")).toMatchObject({ rrule: "FREQ=WEEKLY;BYDAY=TU,TH", dueDate: d(11, 17) })
      expect(parse("Groceries every saturday").dueDate).toEqual(d(11, 21))
      expect(parse("Brunch every weekend").rrule).toBe("FREQ=WEEKLY;BYDAY=SA,SU")
    })

    it("anchors on an explicit date when one is given", () => {
      expect(parse("Mum's birthday 2 March every year")).toMatchObject({ rrule: "FREQ=YEARLY", dueDate: d(3, 2, 2027) })
    })

    it("reads Czech repeats", () => {
      expect(parse("Vitamíny každý den").rrule).toBe("FREQ=DAILY")
      expect(parse("Úklid každou sobotu")).toMatchObject({ title: "Úklid", rrule: "FREQ=WEEKLY;BYDAY=SA", dueDate: d(11, 21) })
      expect(parse("Nájem každý měsíc").rrule).toBe("FREQ=MONTHLY")
      expect(parse("Report týdně").rrule).toBe("FREQ=WEEKLY")
    })
  })

  it("cleans up dangling prepositions and spacing", () => {
    expect(parse("Submit essay by Friday").title).toBe("Submit essay")
    expect(parse("  Call   mom   at 5pm  ").title).toBe("Call mom")
  })

  it("returns an empty title when only modifiers were typed", () => {
    expect(parse("tomorrow 10:00 !!").title).toBe("")
  })
})
