// Converting amounts with ČNB rates. Pure: safe on the server, in the browser
// and in tests.
//
// The rule: an amount converts at the rate of its own day: that day's daily
// fixing, or the latest fixing before it (ČNB fixes on working days only).
// A currency outside the daily fixing (KZT, UAH, …) uses the monthly "other
// currencies" list valid in that month. When neither is known (ČNB was
// unreachable), the latest earlier rate within FALLBACK_DAYS is used and the
// result is marked approximate; older than that, the amount isn't converted.
// ČNB quotes everything in CZK, so a base currency other than CZK is crossed
// through CZK: amount × (CZK per unit of the currency) ÷ (CZK per unit of the base).
//
// Rounding: every amount (one transaction, one balance) is converted on its
// own, exactly (rates are decimal strings scaled to integers, BigInt math),
// and rounded once to the base currency's minor unit, half away from zero.
// Totals are sums of those rounded amounts, so a total always equals the sum
// of its lines. Minor units are hundredths in every currency (as everywhere
// in Budget), so the units cancel out.

export const FX_SOURCE = "ČNB"
/** How old a fallback rate may be before the amount stays unconverted. */
export const FALLBACK_DAYS = 45

export type FxRateRow = {
  source: "daily" | "monthly"
  /** daily: the fixing date; monthly: the first day of the month the list is valid in. */
  validOn: string
  currency: string
  units: number
  /** CZK for `units` units, a decimal string ("24.470"). */
  rate: string
}

/** What the database knows around some days, for some currencies. */
export type RateBook = {
  /** Calendar day → the daily fixing that applies to it (latest on or before). */
  days: Map<string, string>
  rows: FxRateRow[]
}

/** The rate an amount on `day` converts at. */
export type PickedRate = {
  currency: string
  units: number
  rate: string
  source: "daily" | "monthly" | "identity"
  /** The date the rate was declared for (the fixing date, or the month's first day). */
  rateOn: string
  /** An older rate stood in for the right one. */
  approximate: boolean
}

export type Conversion = {
  minor: number
  /** The newest rate date involved. */
  rateOn: string
  approximate: boolean
}

const ZERO = BigInt(0)
const TWO = BigInt(2)
const SCALE = BigInt(1_000_000)
const SCALE_DIGITS = 6

/** "24.470" → 24470000n (micro-units). Throws on anything that isn't a plain decimal. */
export function scaleRate(rate: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(rate.trim())
  if (!m) throw new Error(`Not a rate: ${rate}`)
  return BigInt(m[1]!) * SCALE + BigInt((m[2] ?? "").padEnd(SCALE_DIGITS, "0"))
}

/** a ÷ b rounded half away from zero (b > 0). */
function divRound(a: bigint, b: bigint): bigint {
  const negative = a < ZERO
  const abs = negative ? -a : a
  const q = (abs * TWO + b) / (TWO * b)
  return negative ? -q : q
}

type Quote = { units: number; rate: string }
export const CZK_QUOTE: Quote = { units: 1, rate: "1" }

/**
 * `amountMinor` of a currency quoted `from` into a currency quoted `to` (both
 * as CZK per units), rounded half away from zero to a whole minor unit.
 */
export function convertMinor(amountMinor: number, from: Quote, to: Quote): number {
  if (!Number.isSafeInteger(amountMinor)) throw new Error("amountMinor must be a safe integer")
  const num = BigInt(amountMinor) * scaleRate(from.rate) * BigInt(to.units)
  const den = BigInt(from.units) * scaleRate(to.rate)
  if (den <= ZERO) throw new Error("A rate must be above zero")
  return Number(divRound(num, den))
}

/** How many `to` one unit of `from` is worth, rounded to 6 decimals. */
export function unitRate(from: Quote, to: Quote): number {
  const num = scaleRate(from.rate) * BigInt(to.units) * SCALE
  const den = BigInt(from.units) * scaleRate(to.rate)
  return Number(divRound(num, den)) / Number(SCALE)
}

export const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** The rate for `currency` on `day` (see the rule at the top), or null. */
export function pickRate(book: RateBook, currency: string, day: string): PickedRate | null {
  if (currency === "CZK") return { currency, ...CZK_QUOTE, source: "identity", rateOn: day, approximate: false }
  const rows = book.rows.filter((r) => r.currency === currency)
  const exact = (row: FxRateRow): PickedRate => ({ currency, units: row.units, rate: row.rate, source: row.source, rateOn: row.validOn, approximate: false })

  // A fixing on the day itself, or the one ČNB answered with for the day.
  const fixing = book.days.get(day)
  const daily =
    rows.find((r) => r.source === "daily" && r.validOn === day) ??
    (fixing ? rows.find((r) => r.source === "daily" && r.validOn === fixing) : undefined)
  if (daily) return exact(daily)
  // A currency outside the daily fixing: that month's list.
  const monthly = rows.find((r) => r.source === "monthly" && r.validOn === firstOfMonth(day))
  if (monthly) return exact(monthly)
  // Anything earlier, within reason.
  let best: FxRateRow | null = null
  for (const r of rows) {
    if (r.validOn > day || daysBetween(r.validOn, day) > FALLBACK_DAYS) continue
    if (!best || r.validOn > best.validOn) best = r
  }
  return best ? { ...exact(best), approximate: true } : null
}

/** `amountMinor` in `currency` on `day`, in `base`; null without a usable rate. */
export function convertOn(book: RateBook, amountMinor: number, currency: string, day: string, base: string): Conversion | null {
  if (currency === base) return { minor: amountMinor, rateOn: day, approximate: false }
  const from = pickRate(book, currency, day)
  const to = pickRate(book, base, day)
  if (!from || !to) return null
  const dates = [from, to].filter((r) => r.source !== "identity").map((r) => r.rateOn)
  return {
    minor: convertMinor(amountMinor, from, to),
    rateOn: dates.sort().at(-1) ?? day,
    approximate: from.approximate || to.approximate,
  }
}

/**
 * Collects what a set of conversions used, for the "≈ · Rates: ČNB, 25 Nov"
 * note: the newest rate date, whether any rate was a stand-in, and which
 * currencies were converted or couldn't be.
 */
export class FxTally {
  rateOn: string | null = null
  approximate = false
  readonly converted = new Set<string>()
  readonly unavailable = new Set<string>()

  constructor(
    private readonly book: RateBook,
    readonly base: string,
  ) {}

  /** Converts and records; null (and the currency noted as unavailable) without a rate. */
  convert(amountMinor: number, currency: string, day: string): number | null {
    if (currency === this.base) return amountMinor
    const result = convertOn(this.book, amountMinor, currency, day, this.base)
    if (!result) {
      this.unavailable.add(currency)
      return null
    }
    this.converted.add(currency)
    if (!this.rateOn || result.rateOn > this.rateOn) this.rateOn = result.rateOn
    if (result.approximate) this.approximate = true
    return result.minor
  }

  note(): FxNote {
    return {
      source: FX_SOURCE,
      rateOn: this.rateOn,
      approximate: this.approximate,
      converted: [...this.converted].sort(),
      unavailable: [...this.unavailable].sort(),
    }
  }
}

/** How the amounts on a screen were converted. */
export type FxNote = {
  source: typeof FX_SOURCE
  /** The newest rate date used; null when nothing needed converting. */
  rateOn: string | null
  /** At least one amount used an older rate than its own day's (ČNB unreachable). */
  approximate: boolean
  /** Currencies converted into the base currency. */
  converted: string[]
  /** Currencies left out of the totals: no rate (ČNB down, or a currency ČNB doesn't quote). */
  unavailable: string[]
}

export const emptyFxNote = (): FxNote => ({ source: FX_SOURCE, rateOn: null, approximate: false, converted: [], unavailable: [] })

/** "25 Nov" (or "25 Nov 2025" outside `today`'s year), for the rates note. */
export function formatRateDate(iso: string, today?: string, locale = "en") {
  const sameYear = !today || today.slice(0, 4) === iso.slice(0, 4)
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`))
}

/** "Rates: ČNB, 25 Nov" plus a word when some rates were stand-ins. */
export function ratesLabel(note: FxNote, today?: string, locale = "en") {
  if (!note.rateOn) return null
  return `Rates: ${note.source}, ${formatRateDate(note.rateOn, today, locale)}${note.approximate ? " (some older: ČNB unreachable)" : ""}`
}
