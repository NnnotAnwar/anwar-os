import "server-only"
import { z } from "zod"
import { asViewer } from "@/core/auth"
import { hasModule, runModuleAction } from "@/core/module-actions"
import type { Tx } from "@/db"
import { osbotSettings } from "@/db/schema"
import type { ComparisonRow } from "@/modules/budget/lib/projection"
import { monthOf } from "@/modules/budget/lib/dates"
import type { LimitsData, Overview, PlanRow, UpcomingPayment } from "@/modules/budget/schema"
import type { HabitsDay } from "@/modules/habits/schema"
import { deliveredKeys, recordDeliveries } from "./deliveries"
import { dailySlot } from "./lib/schedule"
import { today as agenda, type TodayItem, type TodayTask } from "./service"

// The morning brief: one card at the owner's chosen time (default 08:00, on
// by default) with the day's calendar, tasks, habits, money and payments.
// Read through the modules' own actions; runs inside actAs(owner) (api.ts),
// or as the signed-in owner for the settings, so RLS scopes every query.

function baseUrl() {
  return (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")
}

/** Categories shown as "near the limit" (≥ 90 % used). */
const NEAR_LIMIT_PERCENT = 90
const NEAR_SHOWN = 3

export type BriefSettings = { briefEnabled: boolean; briefTime: string }
export const DEFAULT_BRIEF_SETTINGS: BriefSettings = { briefEnabled: true, briefTime: "08:00" }

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 08:00.")
export const briefSettingsInput = z.object({ briefEnabled: z.boolean(), briefTime: clockTime })

export async function readBriefSettings(tx: Tx): Promise<BriefSettings> {
  const [row] = await tx.select({ briefEnabled: osbotSettings.briefEnabled, briefTime: osbotSettings.briefTime }).from(osbotSettings)
  if (!row) return DEFAULT_BRIEF_SETTINGS
  return { briefEnabled: row.briefEnabled, briefTime: row.briefTime.slice(0, 5) }
}

export async function saveBriefSettings(input: z.infer<typeof briefSettingsInput>): Promise<BriefSettings> {
  return asViewer(async (tx) => {
    await tx.insert(osbotSettings).values(input).onConflictDoUpdate({ target: osbotSettings.ownerId, set: input })
    return input
  })
}

export type Brief = {
  /** The owner's day (YYYY-MM-DD): the delivery key. */
  date: string
  /** "Wednesday 25 Nov". */
  label: string
  timezone: string
  events: TodayItem[]
  /** Open tasks due today (numbered on the card, like /today). */
  tasks: TodayTask[]
  /** Due today in all, when there are more than listed. */
  tasksToday: number
  overdue: number
  habits: { date: string; habits: HabitsDay["habits"]; done: number; total: number; url: string } | null
  money: {
    currency: string
    month: string
    spentMinor: number
    /** Over the categories that have a monthly limit. */
    limits: { limitMinor: number; spentMinor: number; leftMinor: number } | null
    /** Categories at ≥ 90 % of their limit, fullest first. */
    near: { name: string; percent: number; leftMinor: number }[]
    /** Without limits: the capital-growth plan's monthly saving against this month's net so far. */
    plan: { monthlyContributionMinor: number; monthNetMinor: number } | null
    url: string
  } | null
  /** Recurring expenses charging today. */
  payments: { items: { title: string; amountMinor: number; currency: string; subscription: boolean }[]; url: string } | null
  /** Nothing in the calendar, no tasks, habits or payments: "a clear day". */
  clear: boolean
  /** Already sent by the morning loop (brief/ack). */
  delivered: boolean
  url: string
}

/** The brief for the owner's current day. */
export async function morningBrief(timezone: string, now = new Date()): Promise<Brief> {
  const base = baseUrl()
  const [tasksOn, habitsOn, budgetOn] = await Promise.all(["tasks", "habits", "budget"].map((m) => hasModule(m)))
  const day = await agenda(timezone, now)
  const date = day.day
  const [counts, habits, money, payments, delivered] = await Promise.all([
    tasksOn ? runModuleAction<{ overdue: number; today: number }>("tasks", "counts", {}) : { overdue: 0, today: 0 },
    habitsOn ? habitsOf(base) : null,
    budgetOn ? moneyOf(monthOf(date), base) : null,
    budgetOn ? paymentsOn(date, base) : null,
    deliveredKeys("brief", [date]).then((s) => s.has(date)),
  ])
  const tasks = day.tasks.filter((t) => !t.overdue)
  return {
    date,
    label: day.date,
    timezone,
    events: day.events,
    tasks,
    tasksToday: Math.max(counts.today, tasks.length),
    overdue: counts.overdue,
    habits,
    money,
    payments,
    clear: !day.events.length && !tasks.length && !counts.overdue && !habits?.total && !payments?.items.length,
    delivered,
    url: `${base}/app`,
  }
}

async function habitsOf(base: string): Promise<Brief["habits"]> {
  const day = await runModuleAction<HabitsDay>("habits", "today", {})
  if (!day.habits.length) return null
  return {
    date: day.date,
    habits: day.habits,
    done: day.habits.filter((h) => h.done).length,
    total: day.habits.length,
    url: `${base}/app/habits`,
  }
}

async function moneyOf(month: string, base: string): Promise<Brief["money"]> {
  const [overview, limits, plan] = await Promise.all([
    runModuleAction<Overview>("budget", "overview", { month }),
    runModuleAction<LimitsData>("budget", "limits", { month }),
    runModuleAction<{ plan: PlanRow | null; rows: ComparisonRow[] }>("budget", "getPlan", {}),
  ])
  const capped = limits.items
  const sum = (pick: (i: (typeof capped)[number]) => number) => capped.reduce((s, i) => s + pick(i), 0)
  return {
    currency: overview.baseCurrency,
    month,
    spentMinor: overview.expenseMinor,
    limits: capped.length ? { limitMinor: sum((i) => i.limitMinor), spentMinor: sum((i) => i.spentMinor), leftMinor: sum((i) => i.leftMinor) } : null,
    near: capped
      .filter((i) => i.percent >= NEAR_LIMIT_PERCENT)
      .sort((a, b) => b.percent - a.percent)
      .slice(0, NEAR_SHOWN)
      .map((i) => ({ name: i.name, percent: i.percent, leftMinor: i.leftMinor })),
    plan:
      !capped.length && plan.plan && plan.plan.currency === overview.baseCurrency && plan.plan.monthlyContributionMinor > 0
        ? { monthlyContributionMinor: plan.plan.monthlyContributionMinor, monthNetMinor: overview.netMinor }
        : null,
    url: `${base}/app/budget${capped.length ? "/limits" : ""}`,
  }
}

async function paymentsOn(date: string, base: string): Promise<Brief["payments"]> {
  const payments = await runModuleAction<UpcomingPayment[]>("budget", "upcomingPayments", { from: date, to: date })
  return {
    items: payments.map((p) => ({ title: p.note, amountMinor: p.amountMinor, currency: p.currency, subscription: p.subscription })),
    url: `${base}/app/budget/subscriptions`,
  }
}

export type BriefDue = { due: boolean; date: string; time: string; brief: Brief | null }

/**
 * Whether the morning brief should go out now: switched on, inside its window
 * (dailySlot: from its time until CUTOFF_MINUTES later, so no stale "good
 * morning" at lunch after an outage) and not sent yet that day. Nothing is
 * marked sent until brief/ack.
 */
export async function briefDue(timezone: string, now = new Date()): Promise<BriefDue> {
  const settings = await asViewer(readBriefSettings)
  const slot = dailySlot(now, timezone, settings.briefTime)
  const none = { due: false, date: slot.date, time: settings.briefTime, brief: null }
  if (!settings.briefEnabled || slot.state !== "due") return none
  if ((await deliveredKeys("brief", [slot.date])).has(slot.date)) return none
  return { due: true, date: slot.date, time: settings.briefTime, brief: await morningBrief(timezone, now) }
}

export const ackBriefInput = z.object({ date: z.iso.date("Use a date like 2026-11-25.") })

/** Records the brief for `date` as sent (idempotent). */
export async function ackBrief({ date }: z.infer<typeof ackBriefInput>) {
  return { acked: await recordDeliveries("brief", [date]) }
}
