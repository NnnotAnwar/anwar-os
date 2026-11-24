import "server-only"
import { and, count, gte, lt, ne, sql } from "drizzle-orm"
import { asViewer } from "@/core/auth"
import { hasModule, runModuleAction } from "@/core/module-actions"
import { feedbackItems, ideasIdeas, linksLinks, notesNotes, tasksTasks } from "@/db/schema"
import { pageLabel } from "@/modules/analytics/schema"
import { formatMonth, monthOf, monthRange, parseIsoDate, shiftMonth, todayIn } from "@/modules/budget/lib/dates"
import type { Overview, SubscriptionsData } from "@/modules/budget/schema"
import { startOfLocalDay } from "@/modules/calendar/lib/zoned"
import { deliveredKeys } from "@/modules/osbot/deliveries"
import { compareCategories } from "./lib/compare"
import type { MonthlyReport } from "./schema"

// One month in numbers, read through the modules' own actions where they have
// one (budget) and with plain counts on the module tables otherwise. Always
// runs as the viewer (the page, the action) or as the owner (osbot's API in
// actAs), so RLS scopes every query.

const TOP_PAGES = 5

function baseUrl() {
  return (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")
}

/** The owner's local midnight on the 1st of `month`, as an instant. */
const monthStart = (month: string, timeZone: string) => startOfLocalDay(parseIsoDate(`${month}-01`)!, timeZone)

export async function monthlyReport(month: string | undefined, timezone: string, now = new Date()): Promise<MonthlyReport> {
  const today = todayIn(timezone, now)
  const current = month ?? monthOf(today)
  const previous = shiftMonth(current, -1)
  const base = baseUrl()
  const [budgetOn, tasksOn, ideasOn, notesOn, linksOn, feedbackOn, analyticsOn] = await Promise.all(
    ["budget", "tasks", "ideas", "notes", "links", "feedback", "analytics"].map((m) => hasModule(m)),
  )
  const from = monthStart(current, timezone)
  const to = monthStart(shiftMonth(current, 1), timezone)
  const before = monthStart(previous, timezone)

  const [spending, subscriptions, tasks, captured, site, delivered] = await Promise.all([
    budgetOn ? spendingOf(current, previous, base) : null,
    budgetOn ? subscriptionsOf(base) : null,
    tasksOn ? taskCounts(before, from, to, base) : null,
    createdCounts(from, to, { ideasOn, notesOn, linksOn, feedbackOn }),
    analyticsOn ? siteViews(current, previous, base) : null,
    deliveredKeys("monthly", [current]).then((s) => s.has(current)),
  ])

  return {
    month: current,
    label: formatMonth(current),
    previousMonth: previous,
    previousLabel: formatMonth(previous),
    today,
    timezone,
    partial: current >= monthOf(today),
    delivered,
    url: `${base}/app/review?month=${current}`,
    pdfUrl: `${base}/app/review/pdf?month=${current}`,
    spending,
    subscriptions,
    tasks,
    captured,
    site,
  }
}

async function spendingOf(month: string, previous: string, base: string): Promise<MonthlyReport["spending"]> {
  const [now, before] = await Promise.all([
    runModuleAction<Overview>("budget", "overview", { month }),
    runModuleAction<Overview>("budget", "overview", { month: previous }),
  ])
  const { categories, changes } = compareCategories(now.spending, before.baseCurrency === now.baseCurrency ? before.spending : [])
  return {
    currency: now.baseCurrency,
    expenseMinor: now.expenseMinor,
    previousExpenseMinor: before.baseCurrency === now.baseCurrency ? before.expenseMinor : 0,
    incomeMinor: now.incomeMinor,
    previousIncomeMinor: before.baseCurrency === now.baseCurrency ? before.incomeMinor : 0,
    netMinor: now.netMinor,
    categories,
    changes,
    otherCurrencies: now.otherCurrencies.filter((c) => c.expenseMinor || c.incomeMinor),
    transactionCount: now.transactionCount,
    url: `${base}/app/budget?month=${month}`,
  }
}

async function subscriptionsOf(base: string): Promise<MonthlyReport["subscriptions"]> {
  const data = await runModuleAction<SubscriptionsData>("budget", "subscriptions", {})
  return {
    totals: data.subscriptions.map((s) => ({ currency: s.currency, monthlyMinor: s.monthlyMinor, count: s.count })),
    url: `${base}/app/budget/subscriptions`,
  }
}

async function taskCounts(before: Date, from: Date, to: Date, base: string): Promise<MonthlyReport["tasks"]> {
  // Raw sql`` doesn't serialise Dates: pass the instants as ISO strings.
  const [p, a, b] = [before.toISOString(), from.toISOString(), to.toISOString()]
  const [row] = await asViewer((tx) =>
    tx
      .select({
        done: sql<number>`count(*) filter (where ${tasksTasks.doneAt} >= ${a} and ${tasksTasks.doneAt} < ${b})::int`,
        added: sql<number>`count(*) filter (where ${tasksTasks.createdAt} >= ${a} and ${tasksTasks.createdAt} < ${b})::int`,
        previousDone: sql<number>`count(*) filter (where ${tasksTasks.doneAt} >= ${p} and ${tasksTasks.doneAt} < ${a})::int`,
      })
      .from(tasksTasks)
      .where(sql`(${tasksTasks.doneAt} >= ${p} or ${tasksTasks.createdAt} >= ${a})`),
  )
  return { done: row?.done ?? 0, added: row?.added ?? 0, previousDone: row?.previousDone ?? 0, url: `${base}/app/tasks` }
}

async function createdCounts(
  from: Date,
  to: Date,
  on: { ideasOn: boolean; notesOn: boolean; linksOn: boolean; feedbackOn: boolean },
): Promise<MonthlyReport["captured"]> {
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
    return { notes: n(notes), ideas: n(ideas), links: n(links), feedback: n(feedback) }
  })
}

/** Public page views (analytics counts UTC days) in the month and the month before, with the top pages. */
async function siteViews(month: string, previous: string, base: string): Promise<MonthlyReport["site"]> {
  const cur = monthRange(month)
  const prev = monthRange(previous)
  // Owner filter spelled out like the analytics module's own reads.
  const mine = sql`owner_id = app.current_user_id()`
  return asViewer(async (tx) => {
    const [[totals], pages] = await Promise.all([
      tx.execute<{ views: number; previous: number }>(sql`
        select coalesce(sum(views) filter (where day >= ${cur.from}::date), 0)::int as views,
               coalesce(sum(views) filter (where day < ${cur.from}::date), 0)::int as previous
          from analytics_daily
         where ${mine} and day >= ${prev.from}::date and day <= ${cur.to}::date`),
      tx.execute<{ path: string; views: number }>(sql`
        select path, sum(views)::int as views from analytics_daily
         where ${mine} and day >= ${cur.from}::date and day <= ${cur.to}::date
         group by path order by 2 desc, 1 limit ${TOP_PAGES}`),
    ])
    return {
      views: totals?.views ?? 0,
      previousViews: totals?.previous ?? 0,
      pages: pages.map((p) => ({ path: p.path, label: pageLabel(p.path), views: p.views })),
      url: `${base}/app/analytics?range=30`,
    }
  })
}
