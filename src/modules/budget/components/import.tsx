"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Upload } from "@/components/icons"
import { NAV_FORWARD } from "@/components/motion"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  guessMapping,
  looksLikeHeader,
  mapRows,
  markDuplicates,
  MAX_IMPORT_ROWS,
  parseCsv,
  type ColumnMapping,
  type ImportField,
} from "../lib/csv"
import { formatDay } from "../lib/dates"
import { formatMoney } from "../lib/money"
import { deleteTransactions, existingKeys, importTransactions } from "../server-actions"
import { Field, FormError, selectClass } from "./bits"
import type { AccountOption } from "./types"

const FIELDS: { field: ImportField; label: string; required: boolean }[] = [
  { field: "date", label: "Date", required: true },
  { field: "amount", label: "Amount", required: true },
  { field: "note", label: "Note", required: false },
  { field: "category", label: "Category", required: false },
]

const PREVIEW = 100

export function ImportWizard({ accounts, locale }: { accounts: AccountOption[]; locale: string }) {
  const [text, setText] = useState("")
  const [fileName, setFileName] = useState<string | null>(null)
  const [hasHeader, setHasHeader] = useState<boolean | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [flipSign, setFlipSign] = useState(false)
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "")
  const [existing, setExisting] = useState<{ key: string; keys: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const table = useMemo(() => parseCsv(text), [text])
  const header = (hasHeader ?? (table[0] ? looksLikeHeader(table[0]) : false)) ? table[0]! : null
  const body = header ? table.slice(1) : table
  const width = Math.max(0, ...table.map((r) => r.length))
  const columns = Array.from({ length: width }, (_, i) => (header?.[i] ? `${header[i]}` : `Column ${i + 1}`))
  const activeMapping = mapping ?? guessMapping(header, body.slice(0, 50))
  const mapped = useMemo(() => mapRows(body, activeMapping, { flipSign }), [body, activeMapping, flipSign])
  const rows = mapped.rows

  // What's already in the account for these dates, for the duplicate column.
  const range = rows.length ? [rows.reduce((m, r) => (r.occurredOn < m ? r.occurredOn : m), rows[0]!.occurredOn), rows.reduce((m, r) => (r.occurredOn > m ? r.occurredOn : m), rows[0]!.occurredOn)] : null
  const checkKey = range && accountId ? `${accountId}|${range[0]}|${range[1]}` : null
  useEffect(() => {
    if (!checkKey || !range) return
    let cancelled = false
    void existingKeys({ accountId, from: range[0], to: range[1] }).then((result) => {
      if (!cancelled && result.ok) setExisting({ key: checkKey, keys: result.value })
    })
    return () => {
      cancelled = true
    }
  }, [checkKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const keys = existing && existing.key === checkKey ? existing.keys : null
  const duplicate = keys ? markDuplicates(rows, keys) : rows.map(() => false)
  const fresh = rows.filter((_, i) => !duplicate[i])
  const account = accounts.find((a) => a.id === accountId)

  async function readFile(file: File) {
    if (file.size > 5_000_000) return setError("That file is over 5 MB. Export a shorter period.")
    const buffer = await file.arrayBuffer()
    // Czech banks still export windows-1250 now and then; fall back when UTF-8 fails.
    let decoded: string
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer)
    } catch {
      decoded = new TextDecoder("windows-1250").decode(buffer)
    }
    reset(decoded)
    setFileName(file.name)
  }

  function reset(value: string) {
    setText(value)
    setFileName(null)
    setHasHeader(null)
    setMapping(null)
    setError(null)
  }

  function submit() {
    if (!accountId) return setError("Choose the account to import into.")
    if (fresh.length === 0) return setError("Nothing new to import.")
    if (fresh.length > MAX_IMPORT_ROWS) return setError(`Import up to ${MAX_IMPORT_ROWS} rows at a time — split the file.`)
    start(async () => {
      const result = await importTransactions({
        accountId,
        rows: fresh.map(({ occurredOn, amountMinor, note, categoryName }) => ({ occurredOn, amountMinor, note, categoryName })),
      })
      if (!result.ok) return setError(result.error)
      const { ids, skipped } = result.value
      reset("")
      toast.success(`${ids.length} ${ids.length === 1 ? "transaction" : "transactions"} imported${skipped ? ` · ${skipped} already there` : ""}`, {
        duration: 10_000,
        action: ids.length
          ? {
              label: "Undo",
              onClick: () =>
                void deleteTransactions({ ids }).then((r) => (r.ok ? toast.success("Import undone") : toast.error(r.error))),
            }
          : undefined,
      })
    })
  }

  return (
    <div className="grid gap-4">
      <section className="glass grid gap-3 rounded-xl p-4" aria-labelledby="imp-source">
        <h2 id="imp-source" className="text-card-title">
          1. Your data
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-small inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 text-primary-foreground outline-none focus-within:ring-3 focus-within:ring-ring/50 hover:bg-primary/80 [&_svg]:size-4">
            <Upload />
            Choose a CSV file
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void readFile(file)
                e.target.value = ""
              }}
            />
          </label>
          <span className="text-caption text-muted-foreground">{fileName ?? "or paste below"}</span>
        </div>
        <label htmlFor="imp-text" className="sr-only">
          CSV text
        </label>
        <Textarea
          id="imp-text"
          value={text}
          onChange={(e) => reset(e.target.value)}
          rows={6}
          placeholder={"Datum;Částka;Poznámka\n16.11.2026;-1 234,50;Albert\n15.11.2026;45 000,00;Výplata"}
          className="font-mono text-xs"
          spellCheck={false}
        />
        <p className="text-caption text-muted-foreground">
          Commas, semicolons or tabs. Czech numbers (1 234,50) and dates (16.11.2026) work, as do ISO dates.
        </p>
      </section>

      {table.length > 0 && (
        <section className="glass grid gap-3 rounded-xl p-4" aria-labelledby="imp-map">
          <h2 id="imp-map" className="text-card-title">
            2. Columns
          </h2>
          <label className="text-meta flex min-h-9 items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(header)}
              onChange={(e) => {
                setHasHeader(e.target.checked)
                setMapping(null)
              }}
              className="size-4 accent-[var(--color-accent-600)]"
            />
            The first row is a header
          </label>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {FIELDS.map(({ field, label, required }) => (
              <Field key={field} label={required ? label : `${label} (optional)`} htmlFor={`imp-${field}`}>
                <select
                  id={`imp-${field}`}
                  value={activeMapping[field] ?? ""}
                  onChange={(e) => setMapping({ ...activeMapping, [field]: e.target.value === "" ? null : Number(e.target.value) })}
                  className={selectClass}
                  aria-invalid={required && activeMapping[field] === null}
                >
                  <option value="">{required ? "Choose…" : "None"}</option>
                  {columns.map((c, i) => (
                    <option key={i} value={i}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <label className="text-meta flex min-h-9 items-start gap-2">
            <input type="checkbox" checked={flipSign} onChange={(e) => setFlipSign(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent-600)]" />
            <span>
              Spending is listed as positive numbers
              <span className="text-caption block text-muted-foreground">Flips every sign, e.g. for the expense bot’s export.</span>
            </span>
          </label>
          <Field label="Import into" htmlFor="imp-account">
            <select id="imp-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={cn(selectClass, "md:max-w-xs")}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
            </select>
          </Field>
        </section>
      )}

      {table.length > 0 && (
        <section className="glass grid gap-3 rounded-xl p-4" aria-labelledby="imp-preview">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="imp-preview" className="text-card-title">
              3. Check and import
            </h2>
            <p className="text-meta text-muted-foreground tabular-nums" aria-live="polite">
              {fresh.length} new · {rows.length - fresh.length} already there · {mapped.errors.length} unreadable
            </p>
          </header>
          {mapped.errors.length > 0 && (
            <details className="text-meta">
              <summary className="cursor-pointer text-warning-text">
                {mapped.errors.length} {mapped.errors.length === 1 ? "row" : "rows"} will be skipped
              </summary>
              <ul className="text-caption mt-1 grid gap-0.5 text-muted-foreground">
                {mapped.errors.slice(0, 20).map((e) => (
                  <li key={e.line}>{e.line ? `Row ${e.line}: ${e.message}` : e.message}</li>
                ))}
              </ul>
            </details>
          )}
          {rows.length > 0 && (
            <div className="-mx-2 overflow-x-auto">
              <table className="text-meta w-full min-w-[30rem] tabular-nums">
                <thead>
                  <tr className="text-caption text-left text-muted-foreground">
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      Date
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">
                      Amount
                    </th>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      Note
                    </th>
                    <th scope="col" className="px-2 py-1.5 font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {rows.slice(0, PREVIEW).map((r, i) => (
                    <tr key={r.line} className={cn(duplicate[i] && "text-muted-foreground")}>
                      <td className="px-2 py-1.5 whitespace-nowrap">{formatDay(r.occurredOn, locale)}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">{formatMoney(r.amountMinor, account?.currency ?? "CZK", locale, { signed: true, fixed: true })}</td>
                      <td className="max-w-56 truncate px-2 py-1.5">
                        {r.note}
                        {r.categoryName && <span className="text-caption text-muted-foreground"> · {r.categoryName}</span>}
                      </td>
                      <td className="text-caption px-2 py-1.5">{keys === null ? "…" : duplicate[i] ? "Already there" : "New"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > PREVIEW && <p className="text-caption px-2 pt-2 text-muted-foreground">Showing the first {PREVIEW} of {rows.length}.</p>}
            </div>
          )}
          <FormError>{error}</FormError>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Link href="/app/budget/transactions" transitionTypes={NAV_FORWARD} className="text-small rounded text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
              See transactions
            </Link>
            <Button size="lg" onClick={submit} disabled={pending || fresh.length === 0 || keys === null}>
              {pending ? "Importing…" : `Import ${fresh.length} ${fresh.length === 1 ? "row" : "rows"}`}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
