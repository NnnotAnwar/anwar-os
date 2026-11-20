// Money as integer minor units (2 decimals: haléře, cents). Pure: safe on the
// server, in the browser and in tests.

export const MAX_MAJOR = 1e12

export type ParsedAmount = {
  /** Absolute value in minor units. */
  minor: number
  /** "+" or "-" when the text said so explicitly, null otherwise. */
  sign: "+" | "-" | null
}

const GROUP_SPACES = /[\s   '’]/g
const MINUS = /^[-−–]/
const TRAILING_MINUS = /[-−–]$/

/**
 * Reads an amount the way people type or banks export it:
 * "1 234,50", "1.234,50", "1,234.50", "-250", "+5000", "250 Kč", "(100,00)",
 * "1234.5", "250-". A single separator followed by exactly three digits is a
 * thousands separator ("1,234" → 1234); with one or two digits it's decimal.
 * Returns null for anything that isn't one clear amount.
 */
export function parseAmount(input: string | null | undefined): ParsedAmount | null {
  if (input == null) return null
  let text = input.trim()
  if (!text) return null

  let sign: ParsedAmount["sign"] = null
  if (/^\(.*\)$/.test(text)) {
    sign = "-"
    text = text.slice(1, -1)
  }
  // One currency symbol or code ("Kč", "CZK", "€", "руб.") before or after the
  // number; any other letters mean this is text, not an amount.
  text = text
    .replace(/^(?:\p{L}{1,3}\.?|\p{Sc})\s*/u, "")
    .replace(/\s*(?:\p{L}{1,3}\.?|\p{Sc})$/u, "")
    .trim()
  if (/\p{L}|\p{Sc}/u.test(text)) return null
  if (text.startsWith("+")) {
    if (sign) return null
    sign = "+"
    text = text.slice(1)
  } else if (MINUS.test(text)) {
    if (sign) return null
    sign = "-"
    text = text.slice(1)
  } else if (TRAILING_MINUS.test(text)) {
    sign = "-"
    text = text.slice(0, -1)
  }
  text = text.replace(GROUP_SPACES, "")
  if (!/^\d[\d.,]*$/.test(text) && !/^[.,]\d{1,2}$/.test(text)) return null

  const lastDot = text.lastIndexOf(".")
  const lastComma = text.lastIndexOf(",")
  let intPart: string
  let fracPart = ""

  if (lastDot >= 0 && lastComma >= 0) {
    // Both kinds: the last one is the decimal separator, the other groups.
    const decimal = lastDot > lastComma ? "." : ","
    const group = decimal === "." ? "," : "."
    const at = text.lastIndexOf(decimal)
    intPart = text.slice(0, at)
    fracPart = text.slice(at + 1)
    if (intPart.includes(decimal) || !validGroups(intPart, group)) return null
    intPart = intPart.replaceAll(group, "")
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ","
    const parts = text.split(sep)
    if (parts.length > 2) {
      // "1.234.567": grouping only.
      if (!validGroups(text, sep)) return null
      intPart = text.replaceAll(sep, "")
    } else {
      const [head, tail] = parts as [string, string]
      if (tail.length === 3 && head.length > 0 && head !== "0") {
        intPart = head + tail
      } else {
        intPart = head
        fracPart = tail
      }
    }
  } else {
    intPart = text
  }

  if (!/^\d*$/.test(intPart) || !/^\d{0,2}$/.test(fracPart)) return null
  if (!intPart && !fracPart) return null
  const major = Number(intPart || "0")
  if (major >= MAX_MAJOR) return null
  const minor = major * 100 + Number(fracPart.padEnd(2, "0"))
  return { minor, sign }
}

/** "1.234.567" with sep "." → groups of three after the first (1–3 digits). */
function validGroups(text: string, sep: string) {
  if (!text.includes(sep)) return /^\d*$/.test(text)
  const [first, ...rest] = text.split(sep)
  return /^\d{1,3}$/.test(first!) && rest.every((g) => /^\d{3}$/.test(g))
}

/** Signed minor units from text; a bare number takes `defaultSign`. */
export function parseSignedAmount(input: string, defaultSign: 1 | -1 = 1): number | null {
  const parsed = parseAmount(input)
  if (!parsed || parsed.minor === 0) return null
  const sign = parsed.sign === "-" ? -1 : parsed.sign === "+" ? 1 : defaultSign
  return sign * parsed.minor
}

const formatters = new Map<string, Intl.NumberFormat>()

/**
 * "CZK 1,234.50" / "1 234,50 Kč" depending on locale. Whole amounts drop the
 * decimals unless `fixed` is set (tables keep them aligned).
 */
export function formatMoney(
  minor: number,
  currency: string,
  locale = "en",
  { fixed = false, signed = false }: { fixed?: boolean; signed?: boolean } = {},
) {
  const whole = minor % 100 === 0 && !fixed
  const key = `${locale}|${currency}|${whole}|${signed}`
  let f = formatters.get(key)
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: whole ? 0 : 2,
        signDisplay: signed ? "exceptZero" : "auto",
      })
    } catch {
      f = new Intl.NumberFormat("en", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })
    }
    formatters.set(key, f)
  }
  return f.format(minor / 100)
}

/** Plain editable text for an input: 123450 → "1234.50", 5000 → "50". */
export function amountToInput(minor: number) {
  const abs = Math.abs(minor)
  const major = Math.floor(abs / 100)
  const cents = abs % 100
  return `${minor < 0 ? "-" : ""}${major}${cents ? `.${String(cents).padStart(2, "0")}` : ""}`
}

/** Share of income kept, as a whole percent; null without income. */
export function savingsRate(incomeMinor: number, expenseMinor: number): number | null {
  if (incomeMinor <= 0) return null
  return Math.round(((incomeMinor - expenseMinor) / incomeMinor) * 100)
}

export const CURRENCIES = ["CZK", "EUR", "USD", "GBP", "PLN", "KZT", "RUB", "CHF"] as const
