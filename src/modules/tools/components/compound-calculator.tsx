"use client"

import { useState, type ReactNode } from "react"
import { compoundGrowth, type YearRow } from "../lib/compound"
import { formatNumber, parseNumberInput } from "../lib/format"
import { NumberField, ResultPanel, ResultRow, SectionLabel } from "./fields"

const money = (value: number) => formatNumber(value, 0)

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
                label={<Swatch className="bg-chart-3">You put in</Swatch>}
                value={money(res.result.totalContributed)}
              />
              <ResultRow label={<Swatch className="bg-accent-600">Interest earned</Swatch>} value={money(res.result.totalInterest)} />
              {res.result.finalBalance > 0 && (
                <ResultRow
                  label="Interest share of balance"
                  value={`${formatNumber((res.result.totalInterest / res.result.finalBalance) * 100, 1)}%`}
                />
              )}
            </dl>
            <GrowthChart rows={res.result.rows} />
            <YearTable rows={res.result.rows} />
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

/** Stacked columns per year: contributions at the bottom, interest on top. */
function GrowthChart({ rows }: { rows: YearRow[] }) {
  const peak = Math.max(...rows.map((r) => Math.max(r.balance, r.contributed)), 1)
  const last = rows[rows.length - 1]
  return (
    <figure className="grid gap-2">
      <div
        className="flex h-40 items-end gap-px"
        role="img"
        aria-label={`Balance grows from ${money(rows[0].balance)} after year 1 to ${money(last.balance)} after year ${last.year}`}
      >
        {rows.map((row) => {
          const base = Math.max(0, Math.min(row.contributed, row.balance))
          const gain = Math.max(0, row.balance - row.contributed)
          return (
            <div
              key={row.year}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`Year ${row.year}: ${money(row.balance)}`}
            >
              <div className="rounded-t-[2px] bg-accent-600" style={{ height: `${(gain / peak) * 100}%` }} />
              <div className="bg-chart-3" style={{ height: `${(base / peak) * 100}%` }} />
            </div>
          )
        })}
      </div>
      <figcaption className="flex justify-between font-mono text-xs text-muted-foreground tabular" aria-hidden>
        <span>Year 1</span>
        <span>Year {last.year}</span>
      </figcaption>
    </figure>
  )
}

function YearTable({ rows }: { rows: YearRow[] }) {
  return (
    <section className="grid gap-2" aria-labelledby="years-heading">
      <SectionLabel id="years-heading">Year by year</SectionLabel>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs tabular sm:text-sm">
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
    </section>
  )
}
