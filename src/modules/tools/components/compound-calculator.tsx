"use client"

import { useState, type ReactNode } from "react"
import { ChartLine, TableIcon } from "@/components/icons"
import { cn } from "@/lib/utils"
import { compoundGrowth, type YearRow } from "../lib/compound"
import { formatNumber, parseNumberInput } from "../lib/format"
import { NumberField, ResultPanel, ResultRow, SectionLabel } from "./fields"
import { GrowthChart } from "./growth-chart"

const money = (value: number) => formatNumber(value, 0)

/** The chart, or the same numbers as a table (for reading exact values, copying, screen readers). */
function Projection({ rows, initial }: { rows: YearRow[]; initial: number }) {
  const [view, setView] = useState<"chart" | "table">("chart")
  return (
    <section className="grid gap-3" aria-labelledby="growth-heading">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel id="growth-heading">Growth</SectionLabel>
        <div className="segmented" role="group" aria-label="Show as">
          {(
            [
              ["chart", "Chart", ChartLine],
              ["table", "Table", TableIcon],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={cn(
                "text-small flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-sm:h-9",
                view === value && "segment-active text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
      {view === "chart" ? <GrowthChart rows={rows} initial={initial} /> : <YearTable rows={rows} />}
    </section>
  )
}

export function CompoundCalculator() {
  const [initial, setInitial] = useState("10000")
  const [monthly, setMonthly] = useState("300")
  const [rate, setRate] = useState("7")
  const [years, setYears] = useState("20")

  const res = compoundGrowth({
    initial: parseNumberInput(initial),
    monthly: parseNumberInput(monthly),
    annualRate: parseNumberInput(rate),
    years: parseNumberInput(years),
  })
  const errors = res.ok ? {} : res.errors
  const show = (raw: string, error?: string) => (raw.trim() === "" ? undefined : error)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start">
      <form className="grid grid-cols-2 gap-4 lg:grid-cols-1" onSubmit={(e) => e.preventDefault()} aria-label="Plan">
        <NumberField label="Starting amount" value={initial} onChange={setInitial} error={show(initial, errors.initial)} />
        <NumberField
          label="Monthly contribution"
          value={monthly}
          onChange={setMonthly}
          hint="Added at the end of each month"
          error={show(monthly, errors.monthly)}
        />
        <NumberField
          label="Annual return"
          value={rate}
          onChange={setRate}
          unit="%"
          hint="Compounded monthly"
          error={show(rate, errors.annualRate)}
        />
        <NumberField label="Years" value={years} onChange={setYears} unit="yrs" error={show(years, errors.years)} />
      </form>

      <ResultPanel label="Projection">
        {res.ok ? (
          <>
            <div className="grid gap-1" role="status">
              <SectionLabel>Balance after {res.result.rows.length} {res.result.rows.length === 1 ? "year" : "years"}</SectionLabel>
              <p className="truncate font-mono text-4xl font-medium tracking-tight tabular sm:text-5xl">
                {money(res.result.finalBalance)}
              </p>
            </div>
            <dl className="divide-y border-y">
              <ResultRow
                label={<Swatch className="bg-muted-foreground/45">You put in</Swatch>}
                value={money(res.result.totalContributed)}
              />
              <ResultRow label={<Swatch className="bg-accent-500">Interest earned</Swatch>} value={money(res.result.totalInterest)} />
              {res.result.finalBalance > 0 && (
                <ResultRow
                  label="Interest share of balance"
                  value={`${formatNumber((res.result.totalInterest / res.result.finalBalance) * 100, 1)}%`}
                />
              )}
            </dl>
            <Projection rows={res.result.rows} initial={parseNumberInput(initial)} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            Fill in every field to see the projection.
          </p>
        )}
      </ResultPanel>
    </div>
  )
}

function Swatch({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${className}`} aria-hidden />
      {children}
    </span>
  )
}


function YearTable({ rows }: { rows: YearRow[] }) {
  return (
    <div className="max-h-80 overflow-y-auto">
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs tabular sm:text-sm">
          <caption className="sr-only">Year by year: what you put in, interest and balance</caption>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th scope="col" className="py-2 pr-2 font-normal">
                Year
              </th>
              <th scope="col" className="px-2 py-2 text-right font-normal">
                Put in
              </th>
              <th scope="col" className="px-2 py-2 text-right font-normal">
                Interest
              </th>
              <th scope="col" className="py-2 pl-2 text-right font-normal">
                Balance
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.year}>
                <th scope="row" className="py-1.5 pr-2 text-left font-normal text-muted-foreground">
                  {row.year}
                </th>
                <td className="px-2 py-1.5 text-right">{money(row.contributed)}</td>
                <td className="px-2 py-1.5 text-right">{money(row.interest)}</td>
                <td className="py-1.5 pl-2 text-right font-medium">{money(row.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
