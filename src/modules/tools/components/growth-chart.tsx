"use client"

import { useState, type KeyboardEvent, type PointerEvent } from "react"
import { compactNumber, niceTicks } from "../lib/chart"
import type { YearRow } from "../lib/compound"
import { formatNumber } from "../lib/format"

const money = (value: number) => formatNumber(value, 0)

/**
 * Stacked area chart: what you put in at the bottom, interest on top, so the
 * top edge is the balance. Point or use the arrow keys to read any year; the
 * chosen year shows above the chart. Inline SVG, theme colours only.
 */
export function GrowthChart({ rows, initial }: { rows: YearRow[]; initial: number }) {
  const last = rows[rows.length - 1]!
  const [picked, setPicked] = useState<number | null>(null)
  const index = picked === null ? rows.length - 1 : Math.min(picked, rows.length - 1)
  const row = rows[index]!

  const peak = Math.max(...rows.map((r) => Math.max(r.balance, r.contributed)), 1)
  const ticks = niceTicks(peak, 4)
  const top = ticks[ticks.length - 1]!
  // Year 0 is the starting amount, so the areas begin at the left edge.
  const points = [{ year: 0, contributed: initial, balance: initial }, ...rows]
  const W = 100
  const H = 60
  const x = (year: number) => (year / last.year) * W
  const y = (value: number) => H - (Math.max(0, value) / top) * H

  const line = (pick: (p: (typeof points)[number]) => number) => points.map((p) => `${x(p.year)},${y(pick(p))}`).join(" L")
  const contributedTop = `M${line((p) => Math.min(p.contributed, p.balance))}`
  const balanceTop = `M${line((p) => p.balance)}`
  const close = ` L${W},${H} L0,${H} Z`

  function onPointer(e: PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    const year = Math.round(((e.clientX - box.left) / box.width) * last.year)
    setPicked(Math.max(0, Math.min(rows.length - 1, year - 1)))
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault()
      setPicked(e.key === "Home" ? 0 : rows.length - 1)
    } else if (step) {
      e.preventDefault()
      setPicked(Math.max(0, Math.min(rows.length - 1, index + step)))
    }
  }

  return (
    <figure className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1" aria-live="polite">
        <p className="text-meta text-muted-foreground">
          After <span className="font-semibold text-foreground tabular-nums">year {row.year}</span>
        </p>
        <p className="text-meta flex gap-3 tabular-nums">
          <span>
            <span className="text-muted-foreground">Balance </span>
            <span className="font-semibold">{money(row.balance)}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Interest </span>
            <span className="font-semibold text-text-accent">{money(row.interest)}</span>
          </span>
        </p>
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Year on the chart"
        aria-valuemin={1}
        aria-valuemax={last.year}
        aria-valuenow={row.year}
        aria-valuetext={`Year ${row.year}: balance ${money(row.balance)}, of which ${money(row.interest)} interest`}
        onKeyDown={onKey}
        className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div className="text-caption relative w-9 text-right text-muted-foreground tabular-nums" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t / top) * 100}%` }}>
              {compactNumber(t)}
            </span>
          ))}
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-44 w-full touch-pan-y overflow-visible"
          aria-hidden
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setPicked(null)}
        >
          {ticks.map((t) => (
            <line key={t} x1="0" x2={W} y1={y(t)} y2={y(t)} vectorEffect="non-scaling-stroke" className="stroke-hairline" />
          ))}
          <path d={balanceTop + close} className="fill-accent-500/45" />
          <path d={contributedTop + close} className="fill-muted-foreground/30" />
          <path d={balanceTop} fill="none" vectorEffect="non-scaling-stroke" strokeWidth="2" className="stroke-accent-600" />
          <line
            x1={x(row.year)}
            x2={x(row.year)}
            y1="0"
            y2={H}
            vectorEffect="non-scaling-stroke"
            strokeDasharray="3 3"
            className="stroke-foreground/40"
          />
          <line
            x1={x(row.year)}
            x2={x(row.year) + 0.001}
            y1={y(row.balance)}
            y2={y(row.balance)}
            vectorEffect="non-scaling-stroke"
            strokeWidth="9"
            strokeLinecap="round"
            className="stroke-accent-600"
          />
        </svg>
      </div>
      <figcaption className="text-caption flex justify-between pl-11 text-muted-foreground tabular-nums">
        <span aria-hidden>Start</span>
        <span className="sr-only">
          Balance grows from {money(initial)} to {money(last.balance)} over {last.year} years.
        </span>
        <span aria-hidden>Year {last.year}</span>
      </figcaption>
    </figure>
  )
}
