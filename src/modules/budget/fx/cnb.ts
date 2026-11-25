// The Czech National Bank's exchange-rate files. Pure: no I/O, safe in tests.
//
// Two files, one format:
//   daily fixing   …/central-bank-exchange-rate-fixing/daily.txt?date=DD.MM.YYYY
//   other currencies (monthly) …/fx-rates-of-other-currencies/fx_rates.txt?year=YYYY&month=M
//
//   20 Nov 2026 #223                  ← the date the rates were declared, sequence
//   Country|Currency|Amount|Code|Rate
//   EMU|euro|1|EUR|24.470             ← CZK for `Amount` units
//   Japan|yen|100|JPY|14.031
//
// The daily file asked for a day without a fixing (weekend, holiday, today
// before 14:30, a future day) answers with the latest fixing before it. The
// monthly list is declared on the last working day of a month and is valid for
// the whole following month ("year=2026&month=10" is the list for November).
// The Czech files write "20.11.2026" and "24,470"; both styles are read.

export const CNB_DAILY_URL =
  "https://www.cnb.cz/en/financial-markets/foreign-exchange-market/central-bank-exchange-rate-fixing/central-bank-exchange-rate-fixing/daily.txt"
export const CNB_MONTHLY_URL =
  "https://www.cnb.cz/en/financial-markets/foreign-exchange-market/fx-rates-of-other-currencies/fx-rates-of-other-currencies/fx_rates.txt"

/** One published rate: `rate` CZK buys `units` units of `currency`. */
export type CnbRate = {
  currency: string
  units: number
  /** Decimal with a dot, at most 6 decimals, e.g. "24.470". */
  rate: string
}

export type CnbFile = {
  /** The declaration date, ISO (YYYY-MM-DD). */
  date: string
  seq: number
  rates: CnbRate[]
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

const pad = (n: number) => String(n).padStart(2, "0")

function isoOf(year: number, month: number, day: number): string | null {
  if (year < 1991 || year > 2999 || month < 1 || month > 12 || day < 1) return null
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > last) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

/** "20 Nov 2026", "20.11.2026", "20.Nov 2026" → "2026-11-20". */
export function parseCnbDate(text: string): string | null {
  const t = text.trim()
  const numeric = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/.exec(t)
  if (numeric) return isoOf(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]))
  const named = /^(\d{1,2})[.\s]\s*([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(t)
  if (named) {
    const month = MONTHS.indexOf(named[2]!.toLowerCase()) + 1
    return month ? isoOf(Number(named[3]), month, Number(named[1])) : null
  }
  return null
}

/** "24.470" or "24,470" → "24.470"; null for anything else (no grouping, at most 6 decimals). */
export function parseCnbRate(text: string): string | null {
  const t = text.trim().replace(",", ".")
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(t)) return null
  if (!/[1-9]/.test(t)) return null
  return t
}

/**
 * Reads either ČNB file. Lines that don't fit (blank, footers) are skipped; a
 * row with a malformed code, amount or rate is dropped rather than guessed.
 * Null when the header line is missing or the file has no rates at all (the
 * monthly file for a month not declared yet comes back empty).
 */
export function parseCnbFile(text: string): CnbFile | null {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const head = /^(.+?)\s+#\s*(\d+)$/.exec(lines[0] ?? "")
  if (!head) return null
  const date = parseCnbDate(head[1]!)
  if (!date) return null
  const columns = (lines[1] ?? "").split("|").map((c) => c.trim().toLowerCase())
  // English "Amount|Code|Rate", Czech "množství|kód|kurz".
  const find = (...names: string[]) => columns.findIndex((c) => names.includes(c))
  const at = { amount: find("amount", "množství"), code: find("code", "kód"), rate: find("rate", "kurz") }
  if (at.amount < 0 || at.code < 0 || at.rate < 0) return null

  const seen = new Set<string>()
  const rates: CnbRate[] = []
  for (const line of lines.slice(2)) {
    const cells = line.split("|").map((c) => c.trim())
    if (cells.length !== columns.length) continue
    const currency = cells[at.code]!.toUpperCase()
    const units = Number(cells[at.amount]!.replace(/\s/g, ""))
    const rate = parseCnbRate(cells[at.rate]!)
    if (!/^[A-Z]{3}$/.test(currency) || currency === "CZK" || seen.has(currency)) continue
    if (!Number.isInteger(units) || !isUnitsValue(units) || !rate) continue
    seen.add(currency)
    rates.push({ currency, units, rate })
  }
  if (rates.length === 0) return null
  return { date, seq: Number(head[2]), rates }
}

/** ČNB quotes per 1, 10, 100, … 1 000 000 units. */
export function isUnitsValue(units: number) {
  return [1, 10, 100, 1000, 10000, 100000, 1000000].includes(units)
}

/**
 * Which days to ask the daily file for, newest first, so that `days` are all
 * answered with as few requests as possible. The answer for a day covers every
 * day back to its fixing, and ČNB never fixes on weekends, so asking for a
 * Sunday also answers the Saturday and Friday before it (and a Saturday the
 * Friday). Other days are asked for one by one.
 */
export function dailyRequestDays(days: string[]): string[] {
  const requests: string[] = []
  const answered = new Set<string>()
  for (const day of [...new Set(days)].sort().reverse()) {
    if (answered.has(day)) continue
    requests.push(day)
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
    const back = weekday === 0 ? 2 : weekday === 6 ? 1 : 0
    for (let i = 1; i <= back; i++) answered.add(new Date(Date.parse(`${day}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10))
  }
  return requests
}

/** The daily file for an ISO day: the fixing of that day, or the latest before it. */
export function dailyUrl(isoDay: string) {
  const [y, m, d] = isoDay.split("-")
  return `${CNB_DAILY_URL}?date=${d}.${m}.${y}`
}

/**
 * The monthly "other currencies" list valid in `validMonth` (YYYY-MM): ČNB
 * files it under the month it was declared in, the month before.
 */
export function monthlyUrl(validMonth: string) {
  let year = Number(validMonth.slice(0, 4))
  let month = Number(validMonth.slice(5, 7)) - 1
  if (month === 0) {
    month = 12
    year -= 1
  }
  return `${CNB_MONTHLY_URL}?year=${year}&month=${month}`
}
