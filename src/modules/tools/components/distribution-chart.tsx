"use client"

import { useState } from "react"
import { formatPrecise } from "../lib/format"
import { boxPlot, histogram, type Summary } from "../lib/statistics"
import { SectionLabel } from "./fields"

const fmt = (value: number) => formatPrecise(value, 6)

/**
 * Histogram with a box plot underneath on the same scale, drawn as inline SVG.
 * Marks scale with the container (non-scaling strokes); labels are HTML so they
 * stay readable at any width. Hover or focus a bar to read it; screen readers
 * get the summary sentence and the bins as a list.
 */
export function Distribution({ summary: s }: { summary: Summary }) {
  const bins = histogram(s.sorted)
  const box = boxPlot(s.sorted)
  const peak = Math.max(...bins.map((b) => b.count), 1)
  const [active, setActive] = useState<number | null>(null)
  const span = s.max - s.min
  const x = (v: number) => (span === 0 ? 50 : ((v - s.min) / span) * 100)
  const shown = active === null ? null : bins[active]

  const description = `Values run from ${fmt(s.min)} to ${fmt(s.max)}. Half of them lie between ${fmt(box.q1)} and ${fmt(box.q3)}, around a median of ${fmt(box.median)}${box.outliers.length ? `; ${box.outliers.length} ${box.outliers.length === 1 ? "value is an outlier" : "values are outliers"}` : ""}.`

  return (
    <section className="grid gap-3" aria-labelledby="histogram-heading">
      <div className="flex items-baseline justify-between gap-2">
        <SectionLabel id="histogram-heading">Distribution</SectionLabel>
        <p className="text-caption text-muted-foreground tabular-nums" aria-live="polite">
          {shown ? `${fmt(shown.from)} – ${fmt(shown.to)}: ${shown.count} ${shown.count === 1 ? "value" : "values"}` : `${bins.length} bins`}
        </p>
      </div>
      <figure className="grid gap-1.5">
        <figcaption className="sr-only">{description}</figcaption>

        <svg
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
          className="h-36 w-full overflow-visible"
          aria-hidden
          onMouseLeave={() => setActive(null)}
        >
          {[0.25, 0.5, 0.75].map((t) => (
            <line key={t} x1="0" x2="100" y1={40 - t * 40} y2={40 - t * 40} vectorEffect="non-scaling-stroke" className="stroke-hairline" />
          ))}
          {bins.map((bin, i) => {
            const w = 100 / bins.length
            const h = bin.count === 0 ? 0 : Math.max(0.6, (bin.count / peak) * 40)
            return (
              <g key={i} onMouseEnter={() => setActive(i)}>
                {/* The whole column is the hover target, not just the bar. */}
                <rect x={i * w} y="0" width={w} height="40" className="fill-transparent" />
                <rect
                  x={i * w + w * 0.08}
                  y={40 - h}
                  width={w * 0.84}
                  height={h}
                  rx="0.6"
                  className={active === i ? "fill-accent-500" : "fill-accent-500/70"}
                />
              </g>
            )
          })}
          <line x1="0" x2="100" y1="40" y2="40" vectorEffect="non-scaling-stroke" className="stroke-muted-foreground/40" />
        </svg>

        {/* Box plot: whiskers, the IQR box and the median, outliers as ticks. */}
        <svg viewBox="0 0 100 12" preserveAspectRatio="none" className="h-7 w-full overflow-visible" aria-hidden>
          <line x1={x(box.lowerWhisker)} x2={x(box.q1)} y1="6" y2="6" vectorEffect="non-scaling-stroke" className="stroke-muted-foreground" strokeWidth="1.5" />
          <line x1={x(box.q3)} x2={x(box.upperWhisker)} y1="6" y2="6" vectorEffect="non-scaling-stroke" className="stroke-muted-foreground" strokeWidth="1.5" />
          {[box.lowerWhisker, box.upperWhisker].map((v, i) => (
            <line key={i} x1={x(v)} x2={x(v)} y1="2.5" y2="9.5" vectorEffect="non-scaling-stroke" className="stroke-muted-foreground" strokeWidth="1.5" />
          ))}
          <rect
            x={x(box.q1)}
            y="1"
            width={Math.max(0.4, x(box.q3) - x(box.q1))}
            height="10"
            rx="1"
            vectorEffect="non-scaling-stroke"
            className="fill-secondary stroke-accent-500"
            strokeWidth="1.5"
          />
          <line x1={x(box.median)} x2={x(box.median)} y1="1" y2="11" vectorEffect="non-scaling-stroke" className="stroke-text-accent" strokeWidth="2.5" />
          {box.outliers.map((v, i) => (
            <line key={i} x1={x(v)} x2={x(v)} y1="3" y2="9" vectorEffect="non-scaling-stroke" className="stroke-warning-text" strokeWidth="2" />
          ))}
        </svg>

        <div className="text-caption relative h-4 text-muted-foreground tabular-nums" aria-hidden>
          <span className="absolute left-0">{fmt(s.min)}</span>
          <span className="absolute -translate-x-1/2 font-semibold text-text-accent" style={{ left: `${Math.min(88, Math.max(12, x(box.median)))}%` }}>
            {fmt(box.median)}
          </span>
          <span className="absolute right-0">{fmt(s.max)}</span>
        </div>
        <p className="text-caption flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-4 rounded-sm border-[1.5px] border-accent-500 bg-secondary" />
            Middle half (Q1–Q3)
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-0.5 rounded bg-text-accent" />
            Median
          </span>
          {box.outliers.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-0.5 rounded bg-warning-text" />
              {box.outliers.length} {box.outliers.length === 1 ? "outlier" : "outliers"} (beyond 1.5 × IQR)
            </span>
          )}
        </p>

        <ul className="sr-only">
          {bins.map((bin, i) => (
            <li key={i}>{`${fmt(bin.from)} to ${fmt(bin.to)}: ${bin.count}`}</li>
          ))}
        </ul>
      </figure>
    </section>
  )
}
