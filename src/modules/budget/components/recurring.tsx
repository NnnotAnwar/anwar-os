"use client"

import { useState, useTransition, type FormEvent } from "react"
import { toast } from "sonner"
import { Pause, Play, Plus, Repeat, Trash2 } from "@/components/icons"
import { Toggle } from "@/components/editor-fields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { formatDay } from "../lib/dates"
import { amountToInput, formatMoney, parseAmount } from "../lib/money"
import { describeRule } from "../lib/recurring"
import { recurringFreqs, type Recurring, type RecurringFreq } from "../schema"
import { createRecurring, deleteRecurring, setRecurringActive, updateRecurring } from "../server-actions"
import { DirectionToggle, Field, FormError, Sheet, selectClass } from "./bits"
import { GenerateDueButton } from "./generate-due"
import { categoryGroups, type AccountOption, type CategoryOption } from "./types"

type Editing = { mode: "create" } | { mode: "edit"; item: Recurring } | null

export function RecurringBoard({
  items,
  accounts,
  categories,
  today,
  locale,
}: {
  items: Recurring[]
  accounts: AccountOption[]
  categories: CategoryOption[]
  today: string
  locale: string
}) {
  const [editing, setEditing] = useState<Editing>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [, start] = useTransition()
  const visible = items.filter((i) => !hidden.has(i.id))
  const due = visible.filter((i) => i.active && i.nextDue <= today).length

  function toggle(item: Recurring) {
    const active = !item.active
    start(async () => {
      const result = await setRecurringActive({ id: item.id, active })
      if (!result.ok) return void toast.error(result.error)
      toast.success(active ? `${item.note} resumed` : `${item.note} paused`, {
        action: { label: "Undo", onClick: () => start(() => void setRecurringActive({ id: item.id, active: !active })) },
      })
    })
  }

  function remove(item: Recurring) {
    setEditing(null)
    removeWithUndo({
      message: `${item.note} deleted · its past transactions stay`,
      hide: () => setHidden((prev) => new Set(prev).add(item.id)),
      restore: () =>
        setHidden((prev) => {
          const next = new Set(prev)
          next.delete(item.id)
          return next
        }),
      commit: () => deleteRecurring({ id: item.id }),
    })
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <GenerateDueButton count={due} variant={due > 0 ? "default" : "outline"} />
        <Button variant="outline" size="lg" onClick={() => setEditing({ mode: "create" })} disabled={accounts.length === 0}>
          <Plus />
          New recurring
        </Button>
      </div>
      {visible.length === 0 ? (
        <div className="glass grid gap-1 rounded-xl p-6">
          <p className="text-card-title">Nothing recurring yet</p>
          <p className="text-meta max-w-prose text-muted-foreground">
            Rent, salary, subscriptions: add them once, then “Generate due” records every payment up to today.
          </p>
        </div>
      ) : (
        <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl">
          {visible.map((item) => {
            const isDue = item.active && item.nextDue <= today
            return (
              <li key={item.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5", !item.active && "opacity-70")}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-track text-muted-foreground [&_svg]:size-4">
                  <Repeat />
                </span>
                <button
                  type="button"
                  onClick={() => setEditing({ mode: "edit", item })}
                  className="grid min-w-0 flex-1 gap-0.5 rounded-lg px-1 py-1 text-left outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"
                  aria-label={`Edit ${item.note}`}
                >
                  <span className="text-body-strong truncate">{item.note}</span>
                  <span className="text-caption truncate text-muted-foreground">
                    {describeRule(item)} · {item.categoryName ?? "Uncategorised"} · {item.accountName}
                    {item.subscription && " · Subscription"}
                  </span>
                </button>
                <span className="grid justify-items-end gap-0.5">
                  <span className={cn("text-body-strong tabular-nums", item.amountMinor > 0 && "text-text-accent")}>
                    {formatMoney(item.amountMinor, item.currency, locale, { signed: true })}
                  </span>
                  <span className={cn("text-caption tabular-nums", isDue ? "font-semibold text-warning-text" : "text-muted-foreground")}>
                    {!item.active ? (item.endOn && item.nextDue >= item.endOn ? "Finished" : "Paused") : isDue ? `Due ${formatDay(item.nextDue, locale, today)}` : `Next ${formatDay(item.nextDue, locale, today)}`}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground"
                  onClick={() => toggle(item)}
                  aria-label={item.active ? `Pause ${item.note}` : `Resume ${item.note}`}
                >
                  {item.active ? <Pause /> : <Play />}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <Sheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.mode === "edit" ? "Edit recurring" : "New recurring"}
        description="A start in the past fills in the missed payments when you generate them."
      >
        {editing && (
          <RecurringForm
            key={editing.mode === "edit" ? editing.item.id : "new"}
            item={editing.mode === "edit" ? editing.item : null}
            accounts={accounts}
            categories={categories}
            today={today}
            onDone={() => setEditing(null)}
            onDelete={remove}
          />
        )}
      </Sheet>
    </div>
  )
}

const freqUnit: Record<RecurringFreq, [string, string]> = {
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
  yearly: ["year", "years"],
}

export function RecurringForm({
  item,
  accounts,
  categories,
  today,
  onDone,
  onDelete,
  defaults,
}: {
  item: Recurring | null
  /** For a new one: start as a subscription, in this category. */
  defaults?: { subscription?: boolean; categoryId?: string }
  accounts: AccountOption[]
  categories: CategoryOption[]
  today: string
  onDone: () => void
  onDelete: (r: Recurring) => void
}) {
  const [direction, setDirection] = useState<"out" | "in">(item && item.amountMinor > 0 ? "in" : "out")
  const [note, setNote] = useState(item?.note ?? "")
  const [amount, setAmount] = useState(item ? amountToInput(Math.abs(item.amountMinor)) : "")
  const [accountId, setAccountId] = useState(item?.accountId ?? accounts[0]?.id ?? "")
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? defaults?.categoryId ?? "")
  const [subscription, setSubscription] = useState(item?.subscription ?? defaults?.subscription ?? false)
  const [freq, setFreq] = useState<RecurringFreq>(item?.freq ?? "monthly")
  const [interval, setEvery] = useState(String(item?.interval ?? 1))
  const [startOn, setStartOn] = useState(item?.startOn ?? today)
  const [endOn, setEndOn] = useState(item?.endOn ?? "")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const groups = categoryGroups(categories)
  const kind = direction === "out" ? "expense" : "income"
  const n = Math.max(1, Number(interval) || 1)

  function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = parseAmount(amount)
    if (!parsed || parsed.minor === 0) return setError("Enter an amount, e.g. 15 000.")
    const payload = {
      note,
      amountMinor: (direction === "out" ? -1 : 1) * parsed.minor,
      accountId,
      categoryId: categoryId || null,
      freq,
      interval: n,
      startOn,
      endOn: endOn || null,
      tags: item?.tags ?? [],
      subscription: direction === "out" && subscription,
    }
    start(async () => {
      const result = item ? await updateRecurring({ id: item.id, ...payload }) : await createRecurring(payload)
      if (!result.ok) return setError(result.error)
      toast.success(item ? "Saved" : "Recurring payment added")
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DirectionToggle value={direction} onChange={setDirection} idPrefix="rec-dir" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="What" htmlFor="rec-note">
          <Input id="rec-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} required placeholder="e.g. Rent" autoFocus={!item} autoComplete="off" />
        </Field>
        <Field label="Amount" htmlFor="rec-amount">
          <Input id="rec-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required placeholder="0,00" className="tabular-nums" />
        </Field>
        <Field label="Account" htmlFor="rec-account">
          <select id="rec-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={selectClass}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category" htmlFor="rec-category">
          <select id="rec-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={selectClass}>
            <option value="">Uncategorised</option>
            {groups[kind].map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Every" htmlFor="rec-interval">
          <div className="flex gap-2">
            <Input id="rec-interval" value={interval} onChange={(e) => setEvery(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" className="w-14 tabular-nums" aria-label="Interval" />
            <select id="rec-freq" value={freq} onChange={(e) => setFreq(e.target.value as RecurringFreq)} className={selectClass} aria-label="Unit">
              {recurringFreqs.map((f) => (
                <option key={f} value={f}>
                  {freqUnit[f][n === 1 ? 0 : 1]}
                </option>
              ))}
            </select>
          </div>
        </Field>
        <Field label="Starting" htmlFor="rec-start">
          <Input id="rec-start" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} required className="dark:[color-scheme:dark]" />
        </Field>
        <Field label="Ends (optional)" htmlFor="rec-end">
          <Input id="rec-end" type="date" value={endOn} min={startOn} onChange={(e) => setEndOn(e.target.value)} className="dark:[color-scheme:dark]" />
        </Field>
      </div>
      {direction === "out" && (
        <Toggle
          checked={subscription}
          onChange={setSubscription}
          label="Subscription"
          description="Counted under Subscriptions, with a reminder the day before each charge."
        />
      )}
      <FormError>{error}</FormError>
      <div className="flex flex-wrap items-center gap-2">
        {item && (
          <Button type="button" variant="ghost" className="text-destructive" onClick={() => onDelete(item)}>
            <Trash2 />
            Delete
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="lg" disabled={pending}>
            {item ? "Save" : "Add"}
          </Button>
        </div>
      </div>
    </form>
  )
}
