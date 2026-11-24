import "server-only"
import { and, count, gte, inArray, lt, ne, sql } from "drizzle-orm"
import { z } from "zod"
import { asViewer } from "@/core/auth"
import { hasModule, runModuleAction } from "@/core/module-actions"
import { budgetRecurring, feedbackItems, ideasIdeas, linksLinks, notesNotes, tasksTasks } from "@/db/schema"
import type { ComparisonRow } from "@/modules/budget/lib/projection"
import { addDaysIso, monthOf, parseIsoDate, todayIn } from "@/modules/budget/lib/dates"
import type { Overview, PlanRow, Transaction, UpcomingPayment } from "@/modules/budget/schema"
import { formatClock } from "@/modules/calendar/lib/format"
import { startOfLocalDay } from "@/modules/calendar/lib/zoned"
import type { Occurrence } from "@/modules/calendar/schema"
import type { Task } from "@/modules/tasks/schema"
import { deliveredKeys, recordDeliveries } from "./deliveries"
import { isMonday, shiftWeek, weekLabel, weekOf, type Week } from "./lib/week"

// osbot's scheduled digests: the reminder the day before a recurring charge and
// the Sunday weekly review. Everything is read through the modules' own
// actions (budget, calendar, tasks); only the "how many were created this
// week" counts are plain counts on the module tables. Runs inside
// actAs(owner) (api.ts), so RLS scopes every query to the owner.

function baseUrl() {
  return (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")
}

const isoDate = z.string().refine((v) => parseIsoDate(v) !== null, "Use a date like 2026-11-22.")

// ---------------------------------------------------------------------------
// Payment reminders: the day before a recurring charge
// ---------------------------------------------------------------------------

export type PaymentReminder = {
  /** `<recurring id>:<charge date>`, what payments/ack takes. */
  key: string
  recurringId: string
  title: string
  amountMinor: number
  currency: string
  date: string
  subscription: boolean
  categoryName: string | null
}

export type PaymentsDue = { today: string; date: string; items: PaymentReminder[]; url: string }

const paymentKey = (p: Pick<UpcomingPayment, "recurringId" | "date">) => `${p.recurringId}:${p.date}`

/** Recurring expenses charging tomorrow (the owner's tomorrow) that the bot hasn't reminded about yet. */
export async function paymentsDue(ownerTimezone: string, now = new Date()): Promise<PaymentsDue> {
  const today = todayIn(ownerTimezone, now)
  const date = addDaysIso(today, 1)
  const url = `${baseUrl()}/app/budget/subscriptions`
  if (!(await hasModule("budget"))) return { today, date, items: [], url }
  const payments = await runModuleAction<UpcomingPayment[]>("budget", "upcomingPayments", { from: date, to: date })
  const sent = await deliveredKeys("payment", payments.map(paymentKey))
  const items = payments
    .filter((p) => !sent.has(paymentKey(p)))
    .map((p) => ({
      key: paymentKey(p),
      recurringId: p.recurringId,
      title: p.note,
      amountMinor: p.amountMinor,
      currency: p.currency,
      date: p.date,
      subscription: p.subscription,
      categoryName: p.categoryName,
    }))
  return { today, date, items, url }
}

const PAYMENT_KEY = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d{4}-\d{2}-\d{2})$/

export const ackPaymentsInput = z.object({
  keys: z.array(z.string().regex(PAYMENT_KEY, "Expected <recurring id>:<date>.")).min(1).max(200),
})

/** Records reminders as sent. Keys of templates the owner can't see are skipped; repeats are no-ops. */
export async function ackPayments({ keys }: z.infer<typeof ackPaymentsInput>): Promise<{ acked: number }> {
  const ids = [...new Set(keys.map((k) => PAYMENT_KEY.exec(k)![1]!))]
  const visible = await asViewer((tx) =>
    tx
      .select({ id: budgetRecurring.id })
      .from(budgetRecurring)
      .where(inArray(budgetRecurring.id, ids)),
  )
  const mine = new Set(visible.map((v) => v.id))
  const acked = await recordDeliveries("payment", keys.filter((k) => mine.has(PAYMENT_KEY.exec(k)![1]!)))
  return { acked }
}

// ---------------------------------------------------------------------------
// Weekly review
// ---------------------------------------------------------------------------

export const weeklyInput = z.object({
  /** Any day of the week to review; default: today (the owner's). */
  date: isoDate.optional(),
})

export const ackWeeklyInput = z.object({
  week: isoDate.refine(isMonday, "Pass the week's Monday."),
})

export type WeeklyEvent = { title: string; day: string; time: string; allDay: boolean; start: string }
export type WeeklyTask = { id: string; title: string; dueDate: string | null; overdue: boolean; url: string }
export type CategorySpend = { name: string; amountMinor: number }

export type WeeklyReview = {
  week: Week & { label: string; key: string }
  nextWeek: Week & { label: string }
  today: string
  timezone: string
  /** Already sent by the Sunday loop (weekly/ack). */
  delivered: boolean
  url: string
  tasks: { done: number; added: number; overdue: number; url: string } | null
  /** Up to three open tasks to start next week with: overdue first, then soonest due. */
  focus: WeeklyTask[]
  calendar: { events: WeeklyEvent[]; total: number; url: string } | null
  spending: {
    currency: string
    thisWeekMinor: number
    lastWeekMinor: number
    top: CategorySpend[]
    /** The capital-growth plan's monthly saving against this month's net so far. */
    plan: { monthlyContributionMinor: number; monthNetMinor: number; month: string } | null
    url: string
  } | null
  payments: {
    items: { title: string; amountMinor: number; currency: string; date: string; subscription: boolean }[]
    totals: { currency: string; amountMinor: number }[]
    url: string
  } | null
  captured: { ideas: number | null; notes: number | null; links: number | null; feedback: number | null }
}

const EVENTS_SHOWN = 5
const TOP_CATEGORIES = 3

const weekday = (instant: Date, timeZone: string) => new Intl.DateTimeFormat("en", { weekday: "short", timeZone }).format(instant)

/** The owner's local midnight starting `date`, as an instant. */
const midnight = (date: string, timeZone: string) => startOfLocalDay(parseIsoDate(date)!, timeZone)

export async function weeklyReview(
  { date }: z.infer<typeof weeklyInput>,
  ownerTimezone: string,
  now = new Date(),
): Promise<WeeklyReview> {
  const today = todayIn(ownerTimezone, now)
  const week = weekOf(date ?? today)
  const next = shiftWeek(week, 1)
  const last = shiftWeek(week, -1)
  const base = baseUrl()
  const [tasksOn, calendarOn, budgetOn, ideasOn, notesOn, linksOn, feedbackOn] = await Promise.all(
    ["tasks", "calendar", "budget", "ideas", "notes", "links", "feedback"].map((m) => hasModule(m)),
  )
  const from = midnight(week.start, ownerTimezone)
  const to = midnight(next.start, ownerTimezone)

  const [tasks, focus, calendar, spending, payments, captured, delivered] = await Promise.all([
    tasksOn ? taskCounts(from, to, base) : null,
    tasksOn ? focusTasks(next.end, base) : [],
    calendarOn ? nextWeekEvents(next, ownerTimezone, base) : null,
    budgetOn ? spendingOf(week, last, today, base) : null,
    budgetOn ? paymentsIn(next, base) : null,
    createdCounts(from, to, { ideasOn, notesOn, linksOn, feedbackOn }),
    deliveredKeys("weekly", [week.start]).then((s) => s.has(week.start)),
  ])

  return {
    week: { ...week, label: weekLabel(week), key: week.start },
    nextWeek: { ...next, label: weekLabel(next) },
    today,
    timezone: ownerTimezone,
    delivered,
    url: `${base}/app`,
    tasks,
    focus,
    calendar,
    spending,
    payments,
    captured,
  }
}

/** Records the week's review as sent (idempotent). */
export async function ackWeekly({ week }: z.infer<typeof ackWeeklyInput>): Promise<{ acked: number }> {
  return { acked: await recordDeliveries("weekly", [week]) }
}

async function taskCounts(from: Date, to: Date, base: string) {
  // Raw sql`` doesn't serialise Dates: pass the instants as ISO strings.
  const a = from.toISOString()
  const b = to.toISOString()
  const [[row], counts] = await Promise.all([
    asViewer((tx) =>
      tx
        .select({
          done: sql<number>`count(*) filter (where ${tasksTasks.doneAt} >= ${a} and ${tasksTasks.doneAt} < ${b})::int`,
          added: sql<number>`count(*) filter (where ${tasksTasks.createdAt} >= ${a} and ${tasksTasks.createdAt} < ${b})::int`,
        })
        .from(tasksTasks)
        .where(sql`(${tasksTasks.doneAt} >= ${a} or ${tasksTasks.createdAt} >= ${a})`),
    ),
    runModuleAction<{ overdue: number; today: number }>("tasks", "counts", {}),
  ])
  return { done: row?.done ?? 0, added: row?.added ?? 0, overdue: counts.overdue, url: `${base}/app/tasks` }
}

/** Overdue and due today first (the tasks module's own order), then the soonest upcoming ones. */
async function focusTasks(until: string, base: string): Promise<WeeklyTask[]> {
  const due = await runModuleAction<{ tasks: Task[]; today: string }>("tasks", "dueToday", { limit: 3 })
  let picked = due.tasks
  if (picked.length < 3) {
    const upcoming = await runModuleAction<{ tasks: Task[] }>("tasks", "view", { view: "upcoming" })
    picked = [...picked, ...upcoming.tasks.filter((t) => t.dueDate && t.dueDate <= until)].slice(0, 3)
  }
  return picked.map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: t.dueDate,
    overdue: t.dueDate !== null && t.dueDate < due.today,
    url: `${base}/app/tasks?task=${t.id}`,
  }))
}

async function nextWeekEvents(next: Week, timeZone: string, base: string) {
  const occurrences = await runModuleAction<Occurrence[]>("calendar", "range", {
    from: midnight(next.start, timeZone),
    to: midnight(addDaysIso(next.end, 1), timeZone),
  })
  const sorted = [...occurrences].sort((a, b) => a.start.localeCompare(b.start))
  return {
    events: sorted.slice(0, EVENTS_SHOWN).map((o) => {
      const start = new Date(o.start)
      return {
        title: o.title,
        day: weekday(start, timeZone),
        time: o.allDay ? "all day" : formatClock(start, timeZone),
        allDay: o.allDay,
        start: o.start,
      }
    }),
    total: occurrences.length,
    url: `${base}/app/calendar?view=week&date=${next.start}`,
  }
}

function spendIn(transactions: Transaction[], currency: string) {
  let total = 0
  const byCategory = new Map<string, number>()
  for (const t of transactions) {
    if (t.amountMinor >= 0 || t.transferId || t.currency !== currency) continue
    total -= t.amountMinor
    const name = t.categoryName ?? "Uncategorised"
    byCategory.set(name, (byCategory.get(name) ?? 0) - t.amountMinor)
  }
  const top = [...byCategory]
    .map(([name, amountMinor]) => ({ name, amountMinor }))
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .slice(0, TOP_CATEGORIES)
  return { total, top }
}

async function spendingOf(week: Week, last: Week, today: string, base: string): Promise<WeeklyReview["spending"]> {
  const month = monthOf(today)
  const [overview, thisWeek, lastWeek, plan] = await Promise.all([
    runModuleAction<Overview>("budget", "overview", { month }),
    runModuleAction<Transaction[]>("budget", "listTransactions", { from: week.start, to: week.end, limit: 2000 }),
    runModuleAction<Transaction[]>("budget", "listTransactions", { from: last.start, to: last.end, limit: 2000 }),
    runModuleAction<{ plan: PlanRow | null; rows: ComparisonRow[] }>("budget", "getPlan", {}),
  ])
  const currency = overview.baseCurrency
  const current = spendIn(thisWeek, currency)
  return {
    currency,
    thisWeekMinor: current.total,
    lastWeekMinor: spendIn(lastWeek, currency).total,
    top: current.top,
    plan:
      plan.plan && plan.plan.currency === currency && plan.plan.monthlyContributionMinor > 0
        ? { monthlyContributionMinor: plan.plan.monthlyContributionMinor, monthNetMinor: overview.netMinor, month }
        : null,
    url: `${base}/app/budget`,
  }
}

async function paymentsIn(next: Week, base: string): Promise<WeeklyReview["payments"]> {
  const payments = await runModuleAction<UpcomingPayment[]>("budget", "upcomingPayments", { from: next.start, to: next.end })
  const totals = new Map<string, number>()
  for (const p of payments) totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.amountMinor)
  return {
    items: payments.map((p) => ({ title: p.note, amountMinor: p.amountMinor, currency: p.currency, date: p.date, subscription: p.subscription })),
    totals: [...totals].map(([currency, amountMinor]) => ({ currency, amountMinor })),
    url: `${base}/app/budget/subscriptions`,
  }
}

/** How many ideas, notes, links and feedback messages arrived this week (null: module off). */
async function createdCounts(
  from: Date,
  to: Date,
  on: { ideasOn: boolean; notesOn: boolean; linksOn: boolean; feedbackOn: boolean },
): Promise<WeeklyReview["captured"]> {
  return asViewer(async (tx) => {
    const between = <T extends { createdAt: Parameters<typeof gte>[0] }>(t: T) => and(gte(t.createdAt, from), lt(t.createdAt, to))
    const [ideas, notes, links, feedback] = await Promise.all([
      on.ideasOn ? tx.select({ n: count() }).from(ideasIdeas).where(between(ideasIdeas)) : null,
      on.notesOn ? tx.select({ n: count() }).from(notesNotes).where(between(notesNotes)) : null,
      on.linksOn ? tx.select({ n: count() }).from(linksLinks).where(between(linksLinks)) : null,
      on.feedbackOn
        ? tx
            .select({ n: count() })
            .from(feedbackItems)
            .where(and(between(feedbackItems), ne(feedbackItems.status, "spam")))
        : null,
    ])
    const n = (rows: { n: number }[] | null) => (rows ? Number(rows[0]?.n ?? 0) : null)
    return { ideas: n(ideas), notes: n(notes), links: n(links), feedback: n(feedback) }
  })
}
