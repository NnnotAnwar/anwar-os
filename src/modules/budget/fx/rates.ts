import "server-only"
import { and, gte, inArray, lte, sql } from "drizzle-orm"
import { db } from "@/db"
import { budgetFxDays, budgetFxRates } from "@/db/schema"
import { addDaysIso, todayIn } from "../lib/dates"
import { dailyRequestDays, dailyUrl, monthlyUrl, parseCnbFile, type CnbFile } from "./cnb"
import { FALLBACK_DAYS, firstOfMonth, pickRate, type FxRateRow, type RateBook } from "./convert"

// ČNB rates, fetched lazily and kept in Postgres (budget_fx_rates,
// budget_fx_days; db/modules/budget-fx.sql).
//
// A screen that shows converted amounts first says which (currency, day)
// pairs it needs; ensureRates() fetches what the database doesn't know yet,
// then loadRateBook() reads the rates and the screen converts in memory
// (convert.ts). The rates are public data: none of this runs inside the
// viewer's transaction (a read-only API token can still fill the cache, and no
// viewer transaction waits on the network). Nothing here throws on a network
// problem: a missing rate makes the amount approximate or unconverted, never
// a broken page.
//
// Requests stay few and polite:
// - one request per day at a time, in this process (in-flight requests are
//   shared), and a day's answer covers every day back to its fixing, so a
//   weekend costs one request (dailyRequestDays);
// - days before today (Prague) are final once known and never asked again;
//   today and later are re-checked at most every RECHECK_MS (the fixing is
//   published around 14:30);
// - at most MAX_FETCHES requests per call, FETCH_CONCURRENCY at a time, each
//   with a FETCH_TIMEOUT_MS timeout, all within CALL_DEADLINE_MS;
// - after a failure ČNB isn't asked again for COOLDOWN_MS.

const FETCH_TIMEOUT_MS = 4_000
const CALL_DEADLINE_MS = 6_000
const MAX_FETCHES = 12
const FETCH_CONCURRENCY = 3
const RECHECK_MS = 30 * 60_000
const COOLDOWN_MS = 5 * 60_000
const EMPTY_MONTH_MS = 60 * 60_000

export const PRAGUE = "Europe/Prague"

export type FxNeed = { currency: string; day: string }

type Fetcher = (url: string, signal: AbortSignal) => Promise<string>

const defaultFetcher: Fetcher = async (url, signal) => {
  const response = await fetch(url, { signal, cache: "no-store", headers: { accept: "text/plain" } })
  if (!response.ok) throw new Error(`ČNB answered ${response.status}`)
  return response.text()
}

// Process-wide state, parked on globalThis so dev reloads share it.
const state = (globalThis as unknown as { __budgetFx?: FxState }).__budgetFx ?? newState()
;(globalThis as unknown as { __budgetFx?: FxState }).__budgetFx = state

type FxState = {
  fetcher: Fetcher
  inFlight: Map<string, Promise<CnbFile | null>>
  cooldownUntil: number
  /** Monthly lists ČNB had nothing for (not declared yet): url → retry after. */
  emptyUntil: Map<string, number>
}

function newState(): FxState {
  return { fetcher: defaultFetcher, inFlight: new Map(), cooldownUntil: 0, emptyUntil: new Map() }
}

/** Tests: replace the network (null restores it) and forget cooldowns. */
export function setFxFetcher(fetcher: Fetcher | null) {
  state.fetcher = fetcher ?? defaultFetcher
  state.inFlight.clear()
  state.cooldownUntil = 0
  state.emptyUntil.clear()
}

/** Fetches and parses one ČNB file; concurrent calls for the same URL share one request. */
function fetchFile(url: string, deadline: number): Promise<CnbFile | null> {
  const running = state.inFlight.get(url)
  if (running) return running
  const promise = (async () => {
    const left = Math.min(FETCH_TIMEOUT_MS, deadline - Date.now())
    if (left <= 0 || Date.now() < state.cooldownUntil) return null
    try {
      return parseCnbFile(await state.fetcher(url, AbortSignal.timeout(left)))
    } catch (error) {
      state.cooldownUntil = Date.now() + COOLDOWN_MS
      console.warn(`[budget fx] ${url}: ${error instanceof Error ? error.message : error}`)
      return null
    }
  })().finally(() => state.inFlight.delete(url))
  state.inFlight.set(url, promise)
  return promise
}

/** Runs `jobs` with at most `limit` running at once. */
async function pool<T>(items: T[], limit: number, job: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await job(item)
    }),
  )
}

/** The file's rates as Postgres array literals (codes, units and rates are validated by the parser). */
const asArrays = (file: CnbFile) => ({
  codes: `{${file.rates.map((r) => r.currency).join(",")}}`,
  units: `{${file.rates.map((r) => r.units).join(",")}}`,
  rates: `{${file.rates.map((r) => r.rate).join(",")}}`,
})

/** Saves through the security definer functions; a refused file is logged and skipped. */
async function save(kind: "daily" | "monthly", key: string, file: CnbFile) {
  const { codes, units, rates } = asArrays(file)
  try {
    await db.execute(
      kind === "daily"
        ? sql`select app.budget_fx_save_daily(${key}::date, ${file.date}::date, ${codes}::text[], ${units}::integer[], ${rates}::numeric[])`
        : sql`select app.budget_fx_save_monthly(${key}::date, ${file.date}::date, ${codes}::text[], ${units}::integer[], ${rates}::numeric[])`,
    )
  } catch (error) {
    console.warn(`[budget fx] not saved (${kind} ${key}, ČNB ${file.date}): ${error instanceof Error ? error.message : error}`)
  }
}

/** Days whose fixing must be (re)asked: unknown, or still open and not checked lately. */
async function daysToAsk(days: string[], now: number): Promise<string[]> {
  if (!days.length) return []
  const known = await db
    .select({ day: budgetFxDays.day, final: budgetFxDays.final, checkedAt: budgetFxDays.checkedAt })
    .from(budgetFxDays)
    .where(inArray(budgetFxDays.day, days))
  const fresh = new Set(known.filter((k) => k.final || now - k.checkedAt.getTime() < RECHECK_MS).map((k) => k.day))
  return days.filter((d) => !fresh.has(d))
}

async function fetchDays(days: string[], deadline: number, budget: { left: number }) {
  // A weekend is one request (dailyRequestDays); newest first, so a call that
  // runs out of budget has the recent days.
  await pool(dailyRequestDays(days), FETCH_CONCURRENCY, async (day) => {
    if (budget.left <= 0 || Date.now() >= deadline) return
    budget.left -= 1
    const file = await fetchFile(dailyUrl(day), deadline)
    if (file && file.date <= day) await save("daily", day, file)
  })
}

async function fetchMonths(months: string[], deadline: number, budget: { left: number }) {
  await pool(months, FETCH_CONCURRENCY, async (month) => {
    const url = monthlyUrl(month.slice(0, 7))
    if ((state.emptyUntil.get(url) ?? 0) > Date.now()) return
    if (budget.left <= 0 || Date.now() >= deadline) return
    budget.left -= 1
    const file = await fetchFile(url, deadline)
    if (!file) {
      if (Date.now() >= state.cooldownUntil) state.emptyUntil.set(url, Date.now() + EMPTY_MONTH_MS)
      return
    }
    if (file.date >= month) return
    await save("monthly", month, file)
  })
}

/** The calendar day a rate is looked up for: ČNB has nothing after today in Prague. */
export function rateDay(day: string, now = new Date()) {
  const today = todayIn(PRAGUE, now)
  return day > today ? today : day
}

function normalise(needs: FxNeed[], base: string, now: Date): FxNeed[] {
  const out = new Map<string, FxNeed>()
  for (const n of needs) {
    const day = rateDay(n.day, now)
    for (const currency of [n.currency, base]) {
      if (currency !== "CZK") out.set(`${currency}|${day}`, { currency, day })
    }
  }
  return [...out.values()]
}

/**
 * Makes sure the database has the rates for `needs` (and for `base` on the
 * same days, when the base isn't CZK), fetching from ČNB what's missing.
 * Best effort and bounded in time; never throws for network trouble.
 */
export async function ensureRates(needs: FxNeed[], base: string, now = new Date()): Promise<void> {
  const wanted = normalise(needs, base, now)
  if (!wanted.length) return
  const deadline = Date.now() + CALL_DEADLINE_MS
  const budget = { left: MAX_FETCHES }
  try {
    const days = [...new Set(wanted.map((n) => n.day))]
    await fetchDays(await daysToAsk(days, now.getTime()), deadline, budget)

    // Currencies the daily fixing doesn't quote: the month's "other currencies" list.
    const book = await loadRateBook(wanted, base, now)
    const months = new Set<string>()
    for (const n of wanted) {
      const picked = pickRate(book, n.currency, n.day)
      if (!picked || picked.approximate) months.add(firstOfMonth(n.day))
    }
    const listed = months.size
      ? await db
          .selectDistinct({ month: budgetFxRates.validOn })
          .from(budgetFxRates)
          .where(and(sql`${budgetFxRates.source} = 'monthly'`, inArray(budgetFxRates.validOn, [...months])))
      : []
    const have = new Set(listed.map((r) => r.month))
    await fetchMonths([...months].filter((m) => !have.has(m)).sort().reverse(), deadline, budget)
  } catch (error) {
    // A database error here only costs the conversion, not the page.
    console.warn(`[budget fx] ${error instanceof Error ? error.message : error}`)
  }
}

/** Every known rate and day mapping that conversions for `needs` could use. */
export async function loadRateBook(needs: FxNeed[], base: string, now = new Date()): Promise<RateBook> {
  const wanted = normalise(needs, base, now)
  if (!wanted.length) return { days: new Map(), rows: [] }
  const days = wanted.map((n) => n.day).sort()
  const from = addDaysIso(days[0]!, -FALLBACK_DAYS - 1)
  const to = days.at(-1)!
  const currencies = [...new Set(wanted.map((n) => n.currency))]
  const [dayRows, rateRows] = await Promise.all([
    db
      .select({ day: budgetFxDays.day, fixingDate: budgetFxDays.fixingDate })
      .from(budgetFxDays)
      .where(and(gte(budgetFxDays.day, days[0]!), lte(budgetFxDays.day, to))),
    db
      .select({
        source: budgetFxRates.source,
        validOn: budgetFxRates.validOn,
        currency: budgetFxRates.currency,
        units: budgetFxRates.units,
        rate: budgetFxRates.rate,
      })
      .from(budgetFxRates)
      .where(and(inArray(budgetFxRates.currency, currencies), gte(budgetFxRates.validOn, from), lte(budgetFxRates.validOn, to))),
  ])
  return {
    days: new Map(dayRows.map((r) => [r.day, r.fixingDate])),
    rows: rateRows.map((r): FxRateRow => ({ ...r, rate: trimRate(r.rate) })),
  }
}

/** "24.470000" → "24.47". */
const trimRate = (rate: string) => (rate.includes(".") ? rate.replace(/0+$/, "").replace(/\.$/, "") : rate)

/** ensureRates + loadRateBook, with lookups shifted to days ČNB can answer for. */
export async function rateBookFor(needs: FxNeed[], base: string, now = new Date()): Promise<RateBook> {
  await ensureRates(needs, base, now)
  const book = await loadRateBook(needs, base, now)
  // A future day reads today's (Prague) mapping: the latest rate there is.
  const today = todayIn(PRAGUE, now)
  const todays = book.days.get(today)
  if (todays) {
    for (const n of needs) if (n.day > today) book.days.set(n.day, todays)
  }
  return book
}
