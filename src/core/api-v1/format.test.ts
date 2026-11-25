import { describe, expect, it } from "vitest"
import type { BotExpense } from "@/modules/budget/bot-api/lib"
import type { Today } from "@/modules/osbot/service"
import { captureText, expenseText, list, todayText, totalsText } from "./format"

const day = (over: Partial<Today> = {}): Today => ({
  date: "Tuesday 24 Nov",
  day: "2026-11-24",
  timezone: "Europe/Prague",
  events: [],
  tasks: [],
  tasksTotal: 0,
  newFeedback: 0,
  url: "https://anwar-os.com/app/calendar",
  ...over,
})

const task = (title: string, over: Partial<Today["tasks"][number]> = {}): Today["tasks"][number] => ({
  id: title,
  title,
  overdue: false,
  dueDate: "2026-11-24",
  time: null,
  url: "",
  ...over,
})

describe("Shortcuts API text", () => {
  it("joins lists the way people say them", () => {
    expect(list([])).toBe("")
    expect(list(["a"])).toBe("a")
    expect(list(["a", "b"])).toBe("a and b")
    expect(list(["a", "b", "c"])).toBe("a, b and c")
  })

  it("reads an empty day", () => {
    expect(todayText(day())).toBe("Tuesday 24 Nov.\nNothing in the calendar.\nNo tasks due.")
  })

  it("reads events, tasks and feedback", () => {
    const text = todayText(
      day({
        events: [
          { title: "Standup", location: "", allDay: false, start: "", end: "", time: "10:00 – 10:15" },
          { title: "Mum's birthday", location: "", allDay: true, start: "", end: "", time: "All day" },
        ],
        tasks: [task("Pay rent", { overdue: true, dueDate: "2026-11-20" }), task("Call the bank", { time: "14:00:00" }), task("Buy milk")],
        tasksTotal: 3,
        newFeedback: 1,
      }),
    )
    expect(text).toBe(
      [
        "Tuesday 24 Nov.",
        "2 events: Standup at 10:00 to 10:15; Mum's birthday, all day.",
        "3 tasks due: Pay rent (overdue), Call the bank at 14:00 and Buy milk.",
        "1 new feedback message.",
      ].join("\n"),
    )
  })

  it("reads at most five tasks and counts the rest", () => {
    const tasks = Array.from({ length: 7 }, (_, i) => task(`Task ${i + 1}`))
    const text = todayText(day({ tasks, tasksTotal: 9 }))
    expect(text).toContain("9 tasks due: Task 1, Task 2, Task 3, Task 4, Task 5 and 4 more.")
    expect(todayText(day({ tasks: [task("Only")], tasksTotal: 1 }))).toContain("1 task due: Only.")
  })

  it("confirms an expense with today's total", () => {
    const expense: BotExpense = {
      id: "e1",
      amountMinor: 25000,
      currency: "CZK",
      categoryId: "c1",
      categoryName: "Eating out",
      note: "coffee",
      occurredOn: "2026-11-24",
      recordedAt: "2026-11-24T09:00:00Z",
      accountId: "a1",
      accountName: "Main account",
    }
    expect(expenseText(expense, { day: { CZK: 54000 } })).toBe("Saved CZK 250 for coffee (Eating out). Spent today: CZK 540.")
    expect(expenseText({ ...expense, note: "", categoryName: null, amountMinor: 8990 }, { day: { CZK: 8990, EUR: 1200 } })).toBe(
      "Saved CZK 89.90 (no category). Spent today: CZK 89.90 and €12.",
    )
    expect(totalsText({})).toBe("nothing")
  })

  it("says where a capture went", () => {
    expect(captureText({ kind: "inbox", title: "Buy milk", duplicate: false })).toBe("Saved to Inbox.")
    expect(captureText({ kind: "task", title: "Buy milk", duplicate: false })).toBe("Saved to Tasks: Buy milk.")
    expect(captureText({ kind: "link", title: "React", duplicate: true })).toBe("Already in Links: React.")
  })
})
