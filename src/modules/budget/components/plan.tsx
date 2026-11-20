"use client"

import { useCallback, useState, useTransition, type FormEvent, type PointerEvent } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { formatMonth } from "../lib/dates"
import { amountToInput, CURRENCIES, formatMoney, parseAmount } from "../lib/money"
import type { ComparisonRow } from "../lib/projection"
import type { PlanRow } from "../schema"
import { savePlan } from "../server-actions"
import { Field, FormError, selectClass } from "./bits"

// Series colours, validated with the dataviz palette checker (light: indigo-600
// + teal-600; dark: indigo-500 + #0f9f90). Projected is also dashed, so the
// two never depend on colour alone.
const ACTUAL = "stroke-accent-600 dark:stroke-accent-500"
const PROJECTED = "stroke-[#0d9488] dark:stroke-[#0f9f90]"
const ACTUAL_FILL = "fill-accent-600 dark:fill-accent-500"
const PROJECTED_FILL = "fill-[#0d9488] dark:fill-[#0f9f90]"

export function PlanForm({ plan, currentMonth }: { plan: PlanRow | null; currentMonth: string }) {
  const [starting, setStarting] = useState(plan ? amountToInput(plan.startingCapitalMinor) : "")
  const [monthly, setMonthly] = useState(plan ? amountToInput(plan.monthlyContributionMinor) : "")
  const [rate, setRate] = useState(plan ? String(plan.annualReturnBp / 100) : "7")
  const [years, setYears] = useState(String(plan?.horizonYears ?? 10))
  const [startMonth, setStartMonth] = useState(plan?.startOn.slice(0, 7) ?? currentMonth)
  const [currency, setCurrency] = useState(plan?.currency ?? "CZK")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit(e: FormEvent) {
    e.preventDefault()
    const s = starting.trim() ? parseAmount(starting) : { minor: 0, sign: null }
    const m = monthly.trim() ? parseAmount(monthly) : { minor: 0, sign: null }
    const r = Number(rate.replace(",", "."))
    if (!s || !m) return setError("Enter amounts as numbers, e.g. 250 000.")
    if (!Number.isFinite(r)) return setError("Enter the return as a percentage, e.g. 7 or 6,5.")
    start(async () => {
      const result = await savePlan({
        startingCapitalMinor: s.minor,
        monthlyContributionMinor: m.minor,
        annualReturnBp: Math.round(r * 100),
        horizonYears: Number(years),
        startMonth,
        currency,
      })
      if (!result.ok) return setError(result.error)
      setError(null)
      toast.success("Plan saved")
    })
  }

  return (
    <form onSubmit={submit} className="glass grid gap-4 rounded-xl p-4" aria-label="Plan">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Field label="Starting capital" htmlFor="plan-start">
          <Input id="plan-start" value={starting} onChange={(e) => setStarting(e.target.value)} inputMode="decimal" placeholder="0" className="tabular-nums" />
        </Field>
        <Field label="Every month" htmlFor="plan-monthly">
          <Input id="plan-monthly" value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="decimal" placeholder="10 000" className="tabular-nums" />
        </Field>
        <Field label="Return a year, %" htmlFor="plan-rate" hint="Subtract inflation to see it in today’s money.">
          <Input id="plan-rate" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className="tabular-nums" />
        </Field>
        <Field label="Years" htmlFor="plan-years">
          <Input id="plan-years" type="number" min={1} max={60} value={years} onChange={(e) => setYears(e.target.value)} className="tabular-nums" />
        </Field>
        <Field label="Starts" htmlFor="plan-month">
          <Input id="plan-month" type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} required className="dark:[color-scheme:dark]" />
        </Field>
        <Field label="Currency" htmlFor="plan-currency" hint="Actuals count accounts in this currency.">
          <select id="plan-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={selectClass}>
            {[...new Set([currency, ...CURRENCIES])].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <FormError>{error}</FormError>
      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={pending}>
          {plan ? "Save plan" : "Create plan"}
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Chart: projected vs actual net worth, one axis, hover crosshair + tooltip.
// ---------------------------------------------------------------------------

const PAD = { top: 16, right: 16, bottom: 28, left: 64 }

/** A round step (1, 2, 2.5, 5 × 10ⁿ) that splits `range` into about four parts. */
function niceStep(range: number) {
  if (range <= 0) return 1
  const raw = range / 4
  const exp = 10 ** Math.floor(Math.log10(raw))
  const f = raw / exp
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp
}

const whole = (minor: number, currency: string, locale: string) => formatMoney(Math.round(minor / 100) * 100, currency, locale)

function compact(minor: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(minor / 100)
  } catch {
    return String(Math.round(minor / 100))
  }
}

export function PlanChart({ rows, currency, locale }: { rows: ComparisonRow[]; currency: string; locale: string }) {
  const [hover, setHover] = useState<number | null>(null)
  // Drawn at the container's real width, so 11px labels stay 11px on a phone.
  const [W, setW] = useState(720)
  const H = W < 480 ? 220 : 260
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const observer = new ResizeObserver(([entry]) => entry && setW(Math.max(280, Math.round(entry.contentRect.width))))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const actualRows = rows.filter((r) => r.actualMinor !== null)
  const top = Math.max(...rows.map((r) => r.projectedMinor), ...actualRows.map((r) => r.actualMinor!))
  const bottom = Math.min(0, ...actualRows.map((r) => r.actualMinor!))
  const step = niceStep(top - bottom)
  const min = Math.floor(bottom / step) * step
  const max = Math.max(min + step, Math.ceil(top / step) * step)
  const n = rows.length - 1
  const x = (i: number) => PAD.left + (i / Math.max(1, n)) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + (1 - (v - min) / (max - min || 1)) * (H - PAD.top - PAD.bottom)

  const projectedPath = rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r.projectedMinor).toFixed(1)}`).join("")
  const actualPath = actualRows.map((r, i) => `${i ? "L" : "M"}${x(r.index).toFixed(1)},${y(r.actualMinor!).toFixed(1)}`).join("")
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step)
  const yearStep = Math.max(1, Math.ceil(n / 12 / 6))
  const lastActual = actualRows.at(-1)
  const lastProjected = rows.at(-1)!

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * W
    const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * n)
    setHover(Math.max(0, Math.min(n, i)))
  }

  const h = hover !== null ? rows[hover] : null
  return (
    <figure className="glass grid gap-3 rounded-xl p-4">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-card-title">Net worth: plan vs reality</span>
        <span className="text-caption flex items-center gap-4 text-muted-foreground" aria-hidden>
          <span className="flex items-center gap-1.5">
            <svg width="18" height="4">
              <line x1="0" y1="2" x2="18" y2="2" className={ACTUAL} strokeWidth="2" />
            </svg>
            Actual
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="18" height="4">
              <line x1="0" y1="2" x2="18" y2="2" className={PROJECTED} strokeWidth="2" strokeDasharray="4 3" />
            </svg>
            Projected
          </span>
        </span>
      </figcaption>
      <div ref={measure} className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-pan-y overflow-visible"
          role="img"
          aria-label={`Projected net worth reaches ${formatMoney(lastProjected.projectedMinor, currency, locale)} in ${formatMonth(lastProjected.month, locale)}${lastActual ? `; actual is ${formatMoney(lastActual.actualMinor!, currency, locale)} in ${formatMonth(lastActual.month, locale)}` : ""}. The table below has every value.`}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-hairline" strokeWidth="1" />
              <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[11px] tabular-nums">
                {compact(t, currency, locale)}
              </text>
            </g>
          ))}
          {rows
            .filter((r) => r.index % (12 * yearStep) === 0)
            .map((r) => (
              <text key={r.index} x={x(r.index)} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[11px] tabular-nums">
                {r.index === 0 ? "Start" : `Y${r.index / 12}`}
              </text>
            ))}
          <path d={projectedPath} fill="none" className={PROJECTED} strokeWidth="2" strokeDasharray="6 4" strokeLinejoin="round" />
          {actualPath && <path d={actualPath} fill="none" className={ACTUAL} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
          {lastActual && (
            <circle cx={x(lastActual.index)} cy={y(lastActual.actualMinor!)} r="4" className={cn(ACTUAL_FILL, "stroke-background")} strokeWidth="2" />
          )}
          <circle cx={x(n)} cy={y(lastProjected.projectedMinor)} r="4" className={cn(PROJECTED_FILL, "stroke-background")} strokeWidth="2" />
          <text x={x(n)} y={y(lastProjected.projectedMinor) - 10} textAnchor="end" className="fill-foreground text-[11px] font-semibold tabular-nums">
            {compact(lastProjected.projectedMinor, currency, locale)}
          </text>
          {h && (
            <g aria-hidden>
              <line x1={x(h.index)} x2={x(h.index)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-muted-foreground/50" strokeWidth="1" />
              <circle cx={x(h.index)} cy={y(h.projectedMinor)} r="4" className={cn(PROJECTED_FILL, "stroke-background")} strokeWidth="2" />
              {h.actualMinor !== null && <circle cx={x(h.index)} cy={y(h.actualMinor)} r="4" className={cn(ACTUAL_FILL, "stroke-background")} strokeWidth="2" />}
            </g>
          )}
        </svg>
        {h && (
          <div
            aria-hidden
            className="glass glass-menu text-caption pointer-events-none absolute top-0 grid gap-1 rounded-lg p-2 tabular-nums"
            style={{ left: `${(x(h.index) / W) * 100}%`, transform: `translateX(${h.index > n / 2 ? "calc(-100% - 8px)" : "8px"})` }}
          >
            <span className="font-semibold">{formatMonth(h.month, locale, "short")}</span>
            <span>Projected {whole(h.projectedMinor, currency, locale)}</span>
            {h.actualMinor !== null && <span>Actual {whole(h.actualMinor, currency, locale)}</span>}
            <span className="text-muted-foreground">Put in {whole(h.contributedMinor, currency, locale)}</span>
          </div>
        )}
      </div>
    </figure>
  )
}
