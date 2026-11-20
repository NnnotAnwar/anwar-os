// Small helpers for the calculators' inline SVG charts.

/** A "nice" step (1, 2, 2.5 or 5 × 10ⁿ) so roughly `count` steps cover `span`. */
export function niceStep(span: number, count = 4): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1
  const raw = span / Math.max(1, count)
  const power = 10 ** Math.floor(Math.log10(raw))
  const fraction = raw / power
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return nice * power
}

/** Axis ticks from 0 (or `min` when it is below 0) up to the first nice value ≥ max. */
export function niceTicks(max: number, count = 4, min = 0): number[] {
  const low = Math.min(0, min)
  const step = niceStep(Math.max(max, 0) - low, count)
  const start = Math.floor(low / step) * step
  const ticks: number[] = []
  for (let v = start; v < max + step * 0.999 && ticks.length < 50; v += step) ticks.push(Number(v.toPrecision(12)))
  if (ticks.length < 2) ticks.push(start + step)
  return ticks
}

/** Short axis labels: 950, 12k, 1.2M, 3.4B (thin-space free, minus as U+2212). */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  const sign = value < 0 ? "−" : ""
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ]
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = abs / size
      return `${sign}${Number(scaled.toFixed(scaled < 10 ? 1 : 0))}${suffix}`
    }
  }
  return `${sign}${Number(abs.toFixed(abs < 10 ? 2 : abs < 100 ? 1 : 0))}`
}
