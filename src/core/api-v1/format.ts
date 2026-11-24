import type { BotExpense, CurrencyTotals } from "@/modules/budget/bot-api/lib"
import { formatMoney } from "@/modules/budget/lib/money"
import type { Today } from "@/modules/osbot/service"

// Plain-text answers of the Shortcuts API (/api/v1/*): short sentences that
// read well in a notification and when Siri speaks them. Pure (format.test.ts).

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "a, b and c" */
export function list(items: string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
}

/** At most this many tasks are read out; the rest is "and 3 more". */
export const SPOKEN_TASKS = 5

/** GET /api/v1/today: the day in a few sentences, for Siri to read aloud. */
export function todayText(day: Today): string {
  const lines = [`${day.date}.`]

  if (day.events.length) {
    const events = day.events.map((e) => (e.allDay ? `${e.title}, all day` : `${e.title} at ${e.time.replace(" – ", " to ")}`))
    lines.push(`${plural(day.events.length, "event")}: ${events.join("; ")}.`)
  } else {
    lines.push("Nothing in the calendar.")
  }

  if (day.tasksTotal) {
    const spoken = day.tasks.slice(0, SPOKEN_TASKS).map((t) => {
      if (t.overdue) return `${t.title} (overdue)`
      return t.time ? `${t.title} at ${t.time.slice(0, 5)}` : t.title
    })
    const rest = day.tasksTotal - spoken.length
    if (rest > 0) spoken.push(`${rest} more`)
    lines.push(`${plural(day.tasksTotal, "task")} due: ${list(spoken)}.`)
  } else {
    lines.push("No tasks due.")
  }

  if (day.newFeedback) lines.push(`${plural(day.newFeedback, "new feedback message")}.`)
  return lines.join("\n")
}

const money = (minor: number, currency: string) => formatMoney(minor, currency, "en").replace(/ /g, " ")

/** Spent today, per currency: "CZK 540" or "CZK 540 and €12". */
export function totalsText(day: CurrencyTotals): string {
  const parts = Object.entries(day).map(([currency, minor]) => money(minor, currency))
  return parts.length ? list(parts) : "nothing"
}

/** POST /api/v1/expense: "Saved CZK 250 for coffee (Eating out). Spent today: CZK 540." */
export function expenseText(expense: BotExpense, totals: { day: CurrencyTotals }): string {
  const what = expense.note ? ` for ${expense.note}` : ""
  const category = expense.categoryName ? ` (${expense.categoryName})` : " (no category)"
  return `Saved ${money(expense.amountMinor, expense.currency)}${what}${category}. Spent today: ${totalsText(totals.day)}.`
}

export type CaptureSaved = { kind: string; title: string; duplicate: boolean }

const captureLabels: Record<string, string> = { inbox: "Inbox", task: "Tasks", note: "Notes", link: "Links", idea: "Ideas" }

/** POST /api/v1/capture: "Saved to Inbox." / "Saved to Tasks: Buy milk." */
export function captureText({ kind, title, duplicate }: CaptureSaved): string {
  const where = captureLabels[kind] ?? kind
  if (duplicate) return `Already in ${where}: ${title}.`
  return kind === "inbox" || !title ? `Saved to ${where}.` : `Saved to ${where}: ${title}.`
}
