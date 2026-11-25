"use client"

import Link from "next/link"
import { useState, useTransition, type FormEvent } from "react"
import { toast } from "sonner"
import { Gauge, Plus, Trash2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { formatMonth } from "../lib/dates"
import { limitBarClass } from "../lib/limits"
import { amountToInput, formatMoney, parseAmount } from "../lib/money"
import type { CategoryLimit, LimitsData } from "../schema"
import { removeLimit, setLimit } from "../server-actions"
import { Bar, CategoryDot, Field, FormError, Sheet, selectClass } from "./bits"
import { FxNoteLine } from "./fx-note"

type Editing = { mode: "create" } | { mode: "edit"; limit: CategoryLimit } | null

export function LimitsBoard({ data, current, locale }: { data: LimitsData; current: boolean; locale: string }) {
  const [editing, setEditing] = useState<Editing>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const visible = data.items.filter((x) => !hidden.has(x.categoryId))
  const money = (minor: number) => formatMoney(minor, data.baseCurrency, locale)
  const over = visible.filter((x) => x.status === "over").length
  const near = visible.filter((x) => x.status === "near").length

  function remove(limit: CategoryLimit) {
    setEditing(null)
    removeWithUndo({
      message: `${limit.name}: limit removed`,
      hide: () => setHidden((prev) => new Set(prev).add(limit.categoryId)),
      restore: () =>
        setHidden((prev) => {
          const next = new Set(prev)
          next.delete(limit.categoryId)
          return next
        }),
      commit: () => removeLimit({ categoryId: limit.categoryId }),
    })
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={() => setEditing({ mode: "create" })} disabled={data.withoutLimit.length === 0}>
          <Plus />
          Set a limit
        </Button>
        {visible.length > 0 && (
          <p className="text-meta text-muted-foreground tabular-nums">
            {money(visible.reduce((n, x) => n + x.spentMinor, 0))} of {money(visible.reduce((n, x) => n + x.limitMinor, 0))}
            {over > 0 && <span className="text-destructive"> · {over} over</span>}
            {near > 0 && <span className="text-warning-text"> · {near} close</span>}
          </p>
        )}
      </div>
      <FxNoteLine note={data.fx} today={data.today} locale={locale} className="-mt-2 px-1" unavailableText="spending has no rate, so it isn't counted" />

      {visible.length === 0 ? (
        <div className="glass grid gap-1 rounded-xl p-6">
          <p className="text-card-title">No limits yet</p>
          <p className="text-meta max-w-prose text-muted-foreground">
            Pick a category you want to keep in check, say Eating out, and set what a month may cost. Budget shows what&apos;s left, the expense
            bot adds it to every receipt, and Telegram warns you at 90 %.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label={`Limits for ${formatMonth(data.month, locale)}`}>
          {visible.map((limit) => {
            const pacing = current && limit.status === "ok" && limit.paceMinor !== null && limit.paceMinor > limit.limitMinor
            return (
              <li key={limit.categoryId}>
                <button
                  type="button"
                  onClick={() => setEditing({ mode: "edit", limit })}
                  className="glass press grid h-full w-full content-start gap-3 rounded-xl p-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  aria-label={`Edit the limit for ${limit.name}`}
                >
                  <span className="flex items-center gap-2.5">
                    <CategoryDot color={limit.color} />
                    <span className="text-body-strong min-w-0 flex-1 truncate">{limit.name}</span>
                    <span
                      className={cn(
                        "text-metric-sm tabular-nums",
                        limit.status === "over" && "text-destructive",
                        limit.status === "near" && "text-warning-text",
                      )}
                    >
                      {limit.percent} %
                    </span>
                  </span>
                  <Bar value={limit.spentMinor / limit.limitMinor} className={limitBarClass(limit.status)} />
                  <span className="text-meta flex flex-wrap justify-between gap-x-3 tabular-nums">
                    <span>
                      {money(limit.spentMinor)} <span className="text-muted-foreground">of {money(limit.limitMinor)}</span>
                    </span>
                    <span className={cn("text-muted-foreground", limit.leftMinor < 0 && "font-semibold text-destructive")}>
                      {limit.leftMinor >= 0 ? `${money(limit.leftMinor)} left` : `Over by ${money(-limit.leftMinor)}`}
                    </span>
                  </span>
                  {pacing && <span className="text-caption text-warning-text tabular-nums">On pace for {money(limit.paceMinor!)} this month</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <Sheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.mode === "edit" ? `${editing.limit.name} limit` : "Set a limit"}
        description="A monthly ceiling. It applies to every month and counts the category's subcategories."
      >
        {editing && (
          <LimitForm
            key={editing.mode === "edit" ? editing.limit.categoryId : "new"}
            limit={editing.mode === "edit" ? editing.limit : null}
            data={data}
            locale={locale}
            onDone={() => setEditing(null)}
            onRemove={remove}
          />
        )}
      </Sheet>
    </div>
  )
}

function LimitForm({
  limit,
  data,
  locale,
  onDone,
  onRemove,
}: {
  limit: CategoryLimit | null
  data: LimitsData
  locale: string
  onDone: () => void
  onRemove: (limit: CategoryLimit) => void
}) {
  // Biggest spenders first: those are the ones worth a limit.
  const options = [...data.withoutLimit].sort((a, b) => b.averageMinor - a.averageMinor || a.name.localeCompare(b.name))
  const [categoryId, setCategoryId] = useState(limit?.categoryId ?? options[0]?.categoryId ?? "")
  const [amount, setAmount] = useState(limit ? amountToInput(limit.limitMinor) : "")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const average = limit ? limit.averageMinor : (options.find((o) => o.categoryId === categoryId)?.averageMinor ?? 0)
  // A round suggestion just above the average: 5 340 → 5 500.
  const suggestion = average > 0 ? Math.ceil(average / 50000) * 50000 : 0

  function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = parseAmount(amount)
    if (!parsed || parsed.minor <= 0) return setError("Set an amount above zero, e.g. 6 000.")
    if (!categoryId) return setError("Choose a category.")
    start(async () => {
      const result = await setLimit({ categoryId, amountMinor: Math.abs(parsed.minor) })
      if (!result.ok) return setError(result.error)
      toast.success(limit ? "Limit saved" : "Limit set")
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {!limit && (
        <Field label="Category" htmlFor="limit-category">
          <select id="limit-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={selectClass} required>
            {options.map((o) => (
              <option key={o.categoryId} value={o.categoryId}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field
        label={`A month (${data.baseCurrency})`}
        htmlFor="limit-amount"
        hint={
          average > 0 ? (
            <>
              You averaged {formatMoney(average, data.baseCurrency, locale)} a month over the last three months.{" "}
              {suggestion > 0 && amount !== amountToInput(suggestion) && (
                <button
                  type="button"
                  onClick={() => setAmount(amountToInput(suggestion))}
                  className="text-text-accent underline-offset-4 outline-none hover:underline focus-visible:underline"
                >
                  Use {formatMoney(suggestion, data.baseCurrency, locale)}
                </button>
              )}
            </>
          ) : (
            "No spending here in the last three months."
          )
        }
      >
        <Input
          id="limit-amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          required
          placeholder="6 000"
          className="tabular-nums"
          autoFocus={!!limit}
          autoComplete="off"
        />
      </Field>
      {limit && (
        <Link
          href={`/app/budget/transactions?category=${limit.categoryId}&month=${data.month}`}
          className="text-meta inline-flex items-center gap-1.5 text-text-accent underline-offset-4 outline-none hover:underline focus-visible:underline [&_svg]:size-4"
        >
          <Gauge />
          {formatMonth(data.month, locale)}: {formatMoney(limit.spentMinor, data.baseCurrency, locale)} spent · see the transactions
        </Link>
      )}
      <FormError>{error}</FormError>
      <div className="flex flex-wrap items-center gap-2">
        {limit && (
          <Button type="button" variant="ghost" className="text-destructive" onClick={() => onRemove(limit)}>
            <Trash2 />
            Remove limit
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="lg" disabled={pending}>
            {limit ? "Save" : "Set limit"}
          </Button>
        </div>
      </div>
    </form>
  )
}
