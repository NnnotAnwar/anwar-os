"use client"

import { useDeferredValue, useState } from "react"
import { Textarea } from "@/components/ui/textarea"
import { formatNumber, formatPrecise, parseNumberInput } from "../lib/format"
import { histogram, parseNumbers, percentile, summarize, type Summary } from "../lib/statistics"
import { NumberField, ResultPanel, ResultRow, SectionLabel } from "./fields"

const SAMPLE = "12, 15, 15, 18, 21, 22, 22, 22, 25, 27, 30, 31, 34, 38, 41, 45, 52, 60"
const COMMON_PERCENTILES = [5, 10, 25, 50, 75, 90, 95]

const fmt = (value: number) => formatPrecise(value, 8)

export function StatisticsCalculator() {
  const [text, setText] = useState("")
  const [p, setP] = useState("90")
  // Parsing thousands of pasted numbers shouldn't block typing.
  const deferred = useDeferredValue(text)
  const parsed = parseNumbers(deferred)
  const summary = summarize(parsed.values)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
      <div className="grid content-start gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="stats-input" className="text-sm font-medium">
            Numbers
          </label>
          <button
            type="button"
            onClick={() => setText(text ? "" : SAMPLE)}
            className="rounded-md px-1.5 py-0.5 text-xs text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {text ? "Clear" : "Use sample data"}
          </button>
        </div>
        <Textarea
          id="stats-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Paste from a spreadsheet or type, e.g.\n4.2\n5.1\n3.9"}
          spellCheck={false}
          aria-describedby="stats-parse stats-rules"
          className="min-h-48 resize-y font-mono text-sm tabular [field-sizing:fixed] md:min-h-72"
        />
        <p id="stats-parse" className="text-xs text-muted-foreground" role="status">
          {parsed.values.length === 0
            ? "No numbers yet."
            : `${parsed.values.length} ${parsed.values.length === 1 ? "number" : "numbers"}${parsed.decimalComma ? " · read commas as decimals" : ""}`}
          {parsed.invalid.length > 0 && (
            <span className="block text-destructive">
              Skipped {parsed.invalid.length}: {parsed.invalid.slice(0, 5).join(", ")}
              {parsed.invalid.length > 5 && "…"}
            </span>
          )}
        </p>
        <p id="stats-rules" className="text-xs text-muted-foreground">
          Separate with new lines, spaces, commas or semicolons. Decimal commas like 3,5 work when values are separated by
          spaces, lines or semicolons.
        </p>
      </div>

      <ResultPanel label="Statistics">
        {summary ? (
          <SummaryView summary={summary} p={p} onP={setP} />
        ) : (
          <p className="text-sm text-muted-foreground">Results appear as soon as there&apos;s a number to work with.</p>
        )}
      </ResultPanel>
    </div>
  )
}

function SummaryView({ summary: s, p, onP }: { summary: Summary; p: string; onP: (value: string) => void }) {
  const pValue = parseNumberInput(p)
  const pValid = Number.isFinite(pValue) && pValue >= 0 && pValue <= 100

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Headline label="Mean" value={fmt(s.mean)} />
        <Headline label="Median" value={fmt(s.median)} />
        <Headline
          label="Std dev (sample)"
          value={s.sampleSD === undefined ? "—" : fmt(s.sampleSD)}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      <div className="grid gap-x-8 sm:grid-cols-2">
        <dl className="divide-y border-y">
          <ResultRow label="Count" value={formatNumber(s.count, 0)} />
          <ResultRow label="Sum" value={fmt(s.sum)} />
          <ResultRow label="Mode" value={s.modes.length === 0 ? "None" : s.modes.slice(0, 4).map(fmt).join(", ") + (s.modes.length > 4 ? "…" : "")} />
          <ResultRow label="Min" value={fmt(s.min)} />
          <ResultRow label="Max" value={fmt(s.max)} />
          <ResultRow label="Range" value={fmt(s.range)} />
        </dl>
        <dl className="divide-y border-b sm:border-t">
          <ResultRow label="Variance (sample)" hint="÷ (n − 1)" value={s.sampleVariance === undefined ? "—" : fmt(s.sampleVariance)} />
          <ResultRow label="Variance (population)" hint="÷ n" value={fmt(s.populationVariance)} />
          <ResultRow label="Std dev (population)" value={fmt(s.populationSD)} />
          <ResultRow label="Q1" value={fmt(s.q1)} />
          <ResultRow label="Q3" value={fmt(s.q3)} />
          <ResultRow label="Interquartile range" value={fmt(s.iqr)} />
        </dl>
      </div>

      <section className="grid gap-3" aria-labelledby="percentiles-heading">
        <SectionLabel id="percentiles-heading">Percentiles</SectionLabel>
        <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-start gap-3">
          <NumberField
            label="Percentile"
            value={p}
            onChange={onP}
            unit="th"
            error={p.trim() && !pValid ? "Use 0–100" : undefined}
          />
          <div className="grid gap-1.5">
            <span className="text-sm font-medium" aria-hidden>
              Value
            </span>
            <output aria-live="polite" className="flex h-10 items-center font-mono text-lg tabular">
              {pValid ? fmt(percentile(s.sorted, pValue)) : "—"}
            </output>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-xs tabular">
            <caption className="sr-only">Common percentiles</caption>
            <thead>
              <tr className="text-muted-foreground">
                {COMMON_PERCENTILES.map((q) => (
                  <th key={q} scope="col" className="px-1 py-1 text-right font-normal">
                    P{q}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {COMMON_PERCENTILES.map((q) => (
                  <td key={q} className="px-1 py-1 text-right">
                    {formatPrecise(percentile(s.sorted, q), 5)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Quartiles and percentiles interpolate linearly between ranks, the same method as Excel&apos;s PERCENTILE.INC and
          NumPy.
        </p>
      </section>

      <Histogram values={s.sorted} />
    </>
  )
}

function Headline({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <SectionLabel>{label}</SectionLabel>
      <p className="mt-1 truncate font-mono text-2xl font-medium tracking-tight tabular" title={value}>
        {value}
      </p>
    </div>
  )
}

function Histogram({ values }: { values: number[] }) {
  const bins = histogram(values)
  const peak = Math.max(...bins.map((b) => b.count))
  return (
    <section className="grid gap-3" aria-labelledby="histogram-heading">
      <SectionLabel id="histogram-heading">Distribution</SectionLabel>
      <ul className="flex h-32 items-end gap-0.5" aria-label={`Histogram with ${bins.length} equal-width bins`}>
        {bins.map((bin, i) => (
          <li
            key={i}
            className="flex h-full min-w-0 flex-1 flex-col justify-end"
            title={`${fmt(bin.from)} – ${fmt(bin.to)}: ${bin.count}`}
          >
            <span className="sr-only">{`${fmt(bin.from)} to ${fmt(bin.to)}: ${bin.count}`}</span>
            <div
              aria-hidden
              className="rounded-t-sm bg-accent-600/80"
              style={{ height: bin.count === 0 ? 0 : `max(2px, ${(bin.count / peak) * 100}%)` }}
            />
          </li>
        ))}
      </ul>
      <div className="flex justify-between font-mono text-xs text-muted-foreground tabular" aria-hidden>
        <span>{formatPrecise(bins[0].from, 5)}</span>
        <span>{formatPrecise(bins[bins.length - 1].to, 5)}</span>
      </div>
    </section>
  )
}
