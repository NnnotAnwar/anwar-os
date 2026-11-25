import { z } from "zod"
import type { FxNote } from "@/modules/budget/fx/convert"

// The monthly report: one month of money, tasks, captures and site views next
// to the month before. Built once (report.ts) for the page, the PDF, osbot's
// card on the 1st and the assistant / MCP read action.

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
export const month = z.string().regex(MONTH, "Use a month like 2026-10.")

export const monthlyInput = z.object({
  /** YYYY-MM; default: the current month in the user's timezone (so far). */
  month: month.optional(),
})
export const savePdfInput = z.object({ month })

export type CategoryChange = {
  name: string
  color: string | null
  /** Positive minor units spent this month / the month before. */
  amountMinor: number
  previousMinor: number
}

export type MonthlyReport = {
  month: string
  /** "October 2026". */
  label: string
  previousMonth: string
  previousLabel: string
  today: string
  timezone: string
  /** The month isn't over yet: figures are "so far". */
  partial: boolean
  /** osbot already sent this month's card (monthly/ack). */
  delivered: boolean
  /** The report page and its PDF (absolute when the site URL is known). */
  url: string
  pdfUrl: string
  spending: {
    currency: string
    expenseMinor: number
    previousExpenseMinor: number
    incomeMinor: number
    previousIncomeMinor: number
    netMinor: number
    /** Every category with spending in either month, biggest this month first. */
    categories: CategoryChange[]
    /** Up to three categories that moved the most against the month before. */
    changes: CategoryChange[]
    /** Spending in currencies that couldn't be converted (no ČNB rate): not in the totals. */
    otherCurrencies: { currency: string; expenseMinor: number; incomeMinor: number }[]
    /**
     * How other currencies were converted into `currency` (each transaction at
     * its own day's ČNB rate): the totals above include them when
     * fx.converted isn't empty ("≈", "Rates: ČNB, 25 Nov").
     */
    fx: FxNote
    transactionCount: number
    url: string
  } | null
  subscriptions: {
    /** What active subscriptions cost a month, per currency (positive). */
    totals: { currency: string; monthlyMinor: number; count: number }[]
    url: string
  } | null
  tasks: { done: number; added: number; previousDone: number; url: string } | null
  /** How many arrived this month; null when the module is off. */
  captured: { notes: number | null; ideas: number | null; links: number | null; feedback: number | null }
  site: {
    views: number
    previousViews: number
    pages: { path: string; label: string; views: number }[]
    url: string
  } | null
  /** The month in the journal; null when the module is off or nothing was written. */
  journal: {
    /** Days with an entry. */
    written: number
    /** Days with a mood, their average (1–5, one decimal) or null. */
    rated: number
    averageMood: number | null
    /** Mood 1–5, the day and its line. */
    best: { day: string; mood: number; text: string } | null
    /** Null when every rated day had the same mood. */
    worst: { day: string; mood: number; text: string } | null
    url: string
  } | null
}

export type SavedReport = {
  /** Saved into Files → Reports; false when object storage isn't configured. */
  saved: boolean
  fileId: string | null
  name: string
  /** The file in Files when saved, else the PDF download in the app. */
  url: string
}

/** "Monthly report 2026-10.pdf". */
export const reportFileName = (month: string) => `Monthly report ${month}.pdf`
export const REPORTS_FOLDER = "Reports"
