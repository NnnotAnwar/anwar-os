/**
 * Descriptive statistics for a pasted list of numbers.
 *
 * Parsing rules (see `parseNumbers`):
 * - Whitespace (spaces, tabs, newlines) and semicolons always separate values.
 * - A comma is a decimal comma only when the input has more than one value after
 *   splitting on whitespace/semicolons, no value contains a dot, and every value
 *   with a comma looks like `3,5` (digits, one comma, digits). Then
 *   "3,5 4,25" → [3.5, 4.25] and "3,5; 4,2" → [3.5, 4.2].
 * - Otherwise commas separate values: "1,2,3" and "1, 2, 3" → [1, 2, 3].
 *   A lone "1,5" is therefore read as two values. Thousands separators are not
 *   supported.
 * - The Unicode minus sign "−" is accepted. Anything else that isn't a plain
 *   number (e.g. "12px", "n/a") is reported back as invalid and skipped.
 *
 * Quartiles and percentiles use linear interpolation between closest ranks
 * (Hyndman & Fan type 7): the default in Excel's PERCENTILE.INC / QUARTILE.INC,
 * NumPy and R. The median is always the textbook middle value.
 */

export type ParsedNumbers = {
  values: number[]
  /** Tokens that aren't numbers, in input order. */
  invalid: string[]
  decimalComma: boolean
}

const NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i
const DECIMAL_COMMA_TOKEN = /^[-+]?\d+,\d+$/

export function parseNumbers(text: string): ParsedNumbers {
  const chunks = text
    .replace(/−/g, "-")
    .split(/[\s;]+/)
    .filter(Boolean)

  const decimalComma =
    chunks.length > 1 &&
    chunks.some((c) => c.includes(",")) &&
    chunks.every((c) => !c.includes(".") && (!c.includes(",") || DECIMAL_COMMA_TOKEN.test(c)))

  const tokens = decimalComma
    ? chunks.map((c) => c.replace(",", "."))
    : chunks.flatMap((c) => c.split(",")).filter(Boolean)

  const values: number[] = []
  const invalid: string[] = []
  for (const token of tokens) {
    const n = NUMBER.test(token) ? Number(token) : Number.NaN
    if (Number.isFinite(n)) values.push(n)
    else invalid.push(token)
  }
  return { values, invalid, decimalComma }
}

/** Linear interpolation between closest ranks (type 7). `sorted` must be ascending; p in [0, 100]. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new RangeError("percentile of an empty list")
  if (!(p >= 0 && p <= 100)) throw new RangeError("p must be between 0 and 100")
  const h = (sorted.length - 1) * (p / 100)
  const lo = Math.floor(h)
  const hi = Math.min(lo + 1, sorted.length - 1)
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo])
}

export function median(sorted: readonly number[]): number {
  const n = sorted.length
  if (n === 0) throw new RangeError("median of an empty list")
  const mid = Math.floor(n / 2)
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Every value that occurs most often. Empty when no value repeats. */
export function modes(values: readonly number[]): number[] {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let top = 1
  for (const c of counts.values()) top = Math.max(top, c)
  if (top === 1) return []
  return [...counts]
    .filter(([, c]) => c === top)
    .map(([v]) => v)
    .sort((a, b) => a - b)
}

export type HistogramBin = {
  from: number
  to: number
  count: number
}

/**
 * Equal-width bins from min to max. Each bin is [from, to) except the last,
 * which includes max. Defaults to Sturges' rule, ⌈log₂ n⌉ + 1, capped at 20.
 */
export function histogram(values: readonly number[], binCount?: number): HistogramBin[] {
  if (values.length === 0) return []
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  if (min === max) return [{ from: min, to: max, count: values.length }]

  const bins = Math.max(1, Math.min(20, Math.floor(binCount ?? Math.ceil(Math.log2(values.length)) + 1)))
  const width = (max - min) / bins
  const result: HistogramBin[] = Array.from({ length: bins }, (_, i) => ({
    from: min + i * width,
    to: i === bins - 1 ? max : min + (i + 1) * width,
    count: 0,
  }))
  for (const v of values) {
    const index = Math.min(bins - 1, Math.floor((v - min) / width))
    result[index].count++
  }
  return result
}

export type BoxPlot = {
  q1: number
  median: number
  q3: number
  /** Most extreme values still within 1.5 × IQR of the box (Tukey). */
  lowerWhisker: number
  upperWhisker: number
  /** Everything beyond the whiskers, ascending. */
  outliers: number[]
}

/** Tukey box plot of an ascending, non-empty list. */
export function boxPlot(sorted: readonly number[]): BoxPlot {
  const q1 = percentile(sorted, 25)
  const q3 = percentile(sorted, 75)
  const fence = 1.5 * (q3 - q1)
  const inside = sorted.filter((v) => v >= q1 - fence && v <= q3 + fence)
  return {
    q1,
    median: median(sorted),
    q3,
    lowerWhisker: inside[0] ?? q1,
    upperWhisker: inside[inside.length - 1] ?? q3,
    outliers: sorted.filter((v) => v < q1 - fence || v > q3 + fence),
  }
}

export type Summary = {
  count: number
  sum: number
  mean: number
  median: number
  modes: number[]
  min: number
  max: number
  range: number
  populationVariance: number
  populationSD: number
  /** Undefined for a single value: n − 1 would be zero. */
  sampleVariance: number | undefined
  sampleSD: number | undefined
  q1: number
  q3: number
  iqr: number
  /** Ascending copy of the input, for percentile lookups. */
  sorted: number[]
}

export function summarize(values: readonly number[]): Summary | undefined {
  const n = values.length
  if (n === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const sum = values.reduce((acc, v) => acc + v, 0)
  const mean = sum / n
  // Two passes (mean first, then squared deviations) keep the variance stable
  // for large values with a small spread.
  const squares = values.reduce((acc, v) => acc + (v - mean) ** 2, 0)
  const populationVariance = squares / n
  const sampleVariance = n > 1 ? squares / (n - 1) : undefined
  const q1 = percentile(sorted, 25)
  const q3 = percentile(sorted, 75)
  return {
    count: n,
    sum,
    mean,
    median: median(sorted),
    modes: modes(values),
    min: sorted[0],
    max: sorted[n - 1],
    range: sorted[n - 1] - sorted[0],
    populationVariance,
    populationSD: Math.sqrt(populationVariance),
    sampleVariance,
    sampleSD: sampleVariance === undefined ? undefined : Math.sqrt(sampleVariance),
    q1,
    q3,
    iqr: q3 - q1,
    sorted,
  }
}
