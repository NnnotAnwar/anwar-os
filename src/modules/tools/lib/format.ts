/**
 * Number input and output for the calculators. Formatting is pinned to one
 * locale so server and client render the same string (no hydration mismatch).
 * Thousands are grouped with a thin space, which reads the same to English,
 * Czech and Russian eyes and never collides with a decimal comma.
 */

const THIN_SPACE = " "

/**
 * Reads a number typed into a field. Accepts a dot or a comma as the decimal
 * separator, spaces as grouping and the Unicode minus. Returns NaN for empty or
 * malformed input.
 */
export function parseNumberInput(raw: string): number {
  const text = raw.trim().replace(/[\s  ]/g, "").replace(/−/g, "-").replace(",", ".")
  if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return Number.NaN
  return Number(text)
}

export function formatNumber(value: number, maximumFractionDigits = 2, minimumFractionDigits = 0): string {
  if (!Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: Math.min(minimumFractionDigits, maximumFractionDigits),
    // No "-0" when a small negative rounds away.
    signDisplay: "negative",
  })
    .format(value)
    .replace(/,/g, THIN_SPACE)
    .replace("-", "−")
}

/** Up to `significant` significant digits; switches to exponent notation outside ±1e15 / below 1e-6. */
export function formatPrecise(value: number, significant = 10): string {
  if (!Number.isFinite(value)) return "—"
  if (value === 0) return "0"
  const abs = Math.abs(value)
  if (abs >= 1e15 || abs < 1e-6) {
    return value.toExponential(Math.min(significant, 20) - 1).replace(/\.?0+e/, "e").replace(/-/g, "−")
  }
  const rounded = Number(value.toPrecision(significant))
  const decimals = Math.max(0, significant - Math.floor(Math.log10(Math.abs(rounded))) - 1)
  return formatNumber(rounded, Math.min(decimals, 20))
}
