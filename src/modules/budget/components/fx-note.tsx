import { cn } from "@/lib/utils"
import { ratesLabel, type FxNote } from "../fx/convert"
import { formatMoney } from "../lib/money"

/**
 * The small line under converted totals: "≈ EUR, USD converted · Rates: ČNB,
 * 25 Nov", and which currencies couldn't be converted. Nothing when nothing
 * needed converting.
 */
export function FxNoteLine({
  note,
  today,
  locale,
  className,
  unavailableText = "not converted (no rate)",
}: {
  note: FxNote
  today: string
  locale: string
  className?: string
  /** Null when the page lists the currencies without a rate itself. */
  unavailableText?: string | null
}) {
  const label = ratesLabel(note, today, locale)
  const missing = unavailableText !== null && note.unavailable.length > 0
  if (!label && !missing) return null
  return (
    <p className={cn("text-caption text-muted-foreground", className)}>
      {label && (
        <span title="Each amount converts at the Czech National Bank rate of its own day (the latest fixing on or before it).">
          ≈ {note.converted.join(", ")} converted · {label}
        </span>
      )}
      {label && missing && " · "}
      {missing && (
        <span>
          {note.unavailable.join(", ")} {unavailableText}
        </span>
      )}
    </p>
  )
}

/** "Left out of the totals (no ČNB rate): XTS 15.00 spent · …" for amounts that couldn't be converted. */
export function leftOutText(others: { currency: string; incomeMinor: number; expenseMinor: number }[], locale: string) {
  const parts = others.flatMap((c) => [
    ...(c.expenseMinor ? [`${formatMoney(c.expenseMinor, c.currency, locale)} spent`] : []),
    ...(c.incomeMinor ? [`${formatMoney(c.incomeMinor, c.currency, locale)} received`] : []),
  ])
  return `Left out of the totals (no ČNB rate): ${parts.join(" · ")}`
}

/**
 * A total, as "≈ CZK 44,277" when it includes converted amounts: whole units
 * then, since the cents of an approximation mean nothing (and it fits a phone).
 */
export function approxMoney(minor: number, currency: string, locale: string, note: FxNote, opts?: { signed?: boolean }) {
  if (!note.converted.length) return formatMoney(minor, currency, locale, opts)
  const whole = Math.sign(minor) * Math.round(Math.abs(minor) / 100) * 100
  return `≈ ${formatMoney(whole, currency, locale, opts)}`
}

/** "≈ " in front of a figure that includes converted amounts. */
export const approx = (note: FxNote) => (note.converted.length ? "≈ " : "")
