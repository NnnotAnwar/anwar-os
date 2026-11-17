"use client"

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ArrowsLeftRight, Plus, Repeat, Trash2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { isTyping, useAfterG } from "@/lib/keys"
import { formatTags, parseTags } from "@/lib/tags"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { formatDay } from "../lib/dates"
import { amountToInput, formatMoney, parseAmount } from "../lib/money"
import type { Transaction } from "../schema"
import { createTransaction, createTransfer, deleteTransactions, quickAdd, updateTransaction } from "../server-actions"
import { CategoryDot, DirectionToggle, Field, FormError, Sheet, selectClass } from "./bits"
import { categoryGroups, type AccountOption, type CategoryOption } from "./types"

// ---------------------------------------------------------------------------
// Quick add: "250 food lunch" + Enter.
// ---------------------------------------------------------------------------

export function QuickAdd({
  accounts,
  locale,
  autoFocus = false,
  onDetails,
}: {
  accounts: AccountOption[]
  locale: string
  autoFocus?: boolean
  /** Opens the full form (with whatever was typed as the note). */
  onDetails?: () => void
}) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus])

  // "n" focuses the field (not while typing, not as part of the shell's g-chord).
  const afterG = useAfterG()
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || afterG(e)) return
      if (document.querySelector("[data-slot=dialog-content]")) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [afterG])

  function submit(e: FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (!value) {
      setError("Type an amount and a category, e.g. “250 food lunch”.")
      return
    }
    start(async () => {
      const result = await quickAdd({ text: value })
      if (!result.ok) {
        setError(result.error)
        return
      }
      const tx = result.value
      setText("")
      setError(null)
      input.current?.focus()
      const what = [tx.categoryName ?? "Uncategorised", tx.note].filter(Boolean).join(" · ")
      toast.success(`${formatMoney(tx.amountMinor, tx.currency, locale, { signed: true })} ${what}`, {
        description: `${tx.accountName} · ${formatDay(tx.occurredOn, locale)}`,
        action: {
          label: "Undo",
          onClick: () => void deleteTransactions({ ids: [tx.id] }),
        },
      })
    })
  }

  return (
    <form onSubmit={submit} className="glass grid gap-2 rounded-xl p-3" aria-label="Quick add a transaction">
      <div className="flex gap-2">
        <label htmlFor="quick-tx" className="sr-only">
          Amount, category and note
        </label>
        <Input
          ref={input}
          id="quick-tx"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (error) setError(null)
          }}
          placeholder="250 food lunch"
          autoComplete="off"
          enterKeyHint="done"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "quick-tx-error" : "quick-tx-hint"}
          className="h-10 text-base md:h-9 md:text-sm"
          disabled={accounts.length === 0}
        />
        <Button type="submit" size="lg" disabled={pending || accounts.length === 0} className="h-10 md:h-9">
          <Plus />
          Add
        </Button>
      </div>
      {error ? (
        <FormError id="quick-tx-error">{error}</FormError>
      ) : (
        <p id="quick-tx-hint" className="text-caption flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
          <span>
            Amount, category, note. <kbd className="font-sans">+</kbd> for money in, <code>@cash</code> for an account,{" "}
            <code>#tag</code>, <code>yesterday</code> or <code>14.11.</code>
          </span>
          {onDetails && (
            <button type="button" onClick={onDetails} className="rounded text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
              Full form
            </button>
          )}
        </p>
      )}
    </form>
  )
}

// ---------------------------------------------------------------------------
// Full form: create and edit.
// ---------------------------------------------------------------------------

export type EditorState = { mode: "create" } | { mode: "edit"; tx: Transaction } | null

export function TransactionEditor({
  state,
  onClose,
  onDelete,
  accounts,
  categories,
  today,
  defaultAccountId,
}: {
  state: EditorState
  onClose: () => void
  onDelete: (tx: Transaction) => void
  accounts: AccountOption[]
  categories: CategoryOption[]
  today: string
  defaultAccountId?: string
}) {
  return (
    <Sheet
      open={state !== null}
      onOpenChange={(open) => !open && onClose()}
      title={state?.mode === "edit" ? "Edit transaction" : "New transaction"}
      description={state?.mode === "edit" && state.tx.transferId ? "One leg of a transfer between your accounts." : undefined}
    >
      {state && (
        <EditorForm
          key={state.mode === "edit" ? state.tx.id : "new"}
          state={state}
          onClose={onClose}
          onDelete={onDelete}
          accounts={accounts}
          categories={categories}
          today={today}
          defaultAccountId={defaultAccountId}
        />
      )}
    </Sheet>
  )
}

function EditorForm({
  state,
  onClose,
  onDelete,
  accounts,
  categories,
  today,
  defaultAccountId,
}: {
  state: NonNullable<EditorState>
  onClose: () => void
  onDelete: (tx: Transaction) => void
  accounts: AccountOption[]
  categories: CategoryOption[]
  today: string
  defaultAccountId?: string
}) {
  const tx = state.mode === "edit" ? state.tx : null
  const [direction, setDirection] = useState<"out" | "in">(tx && tx.amountMinor > 0 ? "in" : "out")
  const [amount, setAmount] = useState(tx ? amountToInput(Math.abs(tx.amountMinor)) : "")
  const [accountId, setAccountId] = useState(tx?.accountId ?? defaultAccountId ?? accounts[0]?.id ?? "")
  const [categoryId, setCategoryId] = useState(tx?.categoryId ?? "")
  const [occurredOn, setOccurredOn] = useState(tx?.occurredOn ?? today)
  const [note, setNote] = useState(tx?.note ?? "")
  const [tags, setTags] = useState(formatTags(tx?.tags ?? []))
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const groups = categoryGroups(categories)
  const kind = direction === "out" ? "expense" : "income"

  function pickCategory(id: string) {
    setCategoryId(id)
    const cat = categories.find((c) => c.id === id)
    if (cat) setDirection(cat.kind === "income" ? "in" : "out")
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = parseAmount(amount)
    if (!parsed || parsed.minor === 0) {
      setError("Enter an amount, e.g. 250 or 1 234,50.")
      return
    }
    const payload = {
      accountId,
      categoryId: categoryId || null,
      amountMinor: (direction === "out" ? -1 : 1) * parsed.minor,
      occurredOn,
      note,
      tags: parseTags(tags),
    }
    start(async () => {
      const result = tx ? await updateTransaction({ id: tx.id, ...payload }) : await createTransaction(payload)
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success(tx ? "Transaction saved" : "Transaction added")
      onClose()
    })
  }

  const currency = accounts.find((a) => a.id === accountId)?.currency ?? ""
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DirectionToggle value={direction} onChange={setDirection} idPrefix="tx-dir" />
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Amount${currency ? ` (${currency})` : ""}`} htmlFor="tx-amount">
          <Input
            id="tx-amount"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setError(null)
            }}
            inputMode="decimal"
            placeholder="0,00"
            autoComplete="off"
            autoFocus={!tx}
            required
            className="tabular-nums"
          />
        </Field>
        <Field label="Date" htmlFor="tx-date">
          <Input id="tx-date" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} required className="dark:[color-scheme:dark]" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Account" htmlFor="tx-account">
          <select id="tx-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={selectClass} required>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category" htmlFor="tx-category">
          <select id="tx-category" value={categoryId} onChange={(e) => pickCategory(e.target.value)} className={selectClass}>
            <option value="">Uncategorised</option>
            <optgroup label={kind === "expense" ? "Spending" : "Income"}>
              {groups[kind].map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </optgroup>
            <optgroup label={kind === "expense" ? "Income" : "Spending"}>
              {groups[kind === "expense" ? "income" : "expense"].map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
      </div>
      <Field label="Note" htmlFor="tx-note">
        <Input id="tx-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Lunch with Petr" autoComplete="off" />
      </Field>
      <Field label="Tags" htmlFor="tx-tags" hint="Separate with commas.">
        <Input id="tx-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="trip, work" autoComplete="off" />
      </Field>
      <FormError>{error}</FormError>
      <div className="flex flex-wrap items-center gap-2">
        {tx && (
          <Button type="button" variant="ghost" onClick={() => onDelete(tx)} className="text-destructive">
            <Trash2 />
            Delete
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="lg" disabled={pending}>
            {tx ? "Save" : "Add transaction"}
          </Button>
        </div>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Transfer between own accounts.
// ---------------------------------------------------------------------------

export function TransferSheet({
  open,
  onOpenChange,
  accounts,
  today,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: AccountOption[]
  today: string
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Transfer" description="Move money between your own accounts. Transfers don't count as income or spending.">
      {open && <TransferForm accounts={accounts} today={today} onDone={() => onOpenChange(false)} />}
    </Sheet>
  )
}

function TransferForm({ accounts, today, onDone }: { accounts: AccountOption[]; today: string; onDone: () => void }) {
  const [from, setFrom] = useState(accounts[0]?.id ?? "")
  const [to, setTo] = useState(accounts.find((a) => a.id !== accounts[0]?.id && a.currency === accounts[0]?.currency)?.id ?? "")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(today)
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = parseAmount(amount)
    if (!parsed || parsed.minor === 0) return setError("Enter an amount above zero.")
    start(async () => {
      const result = await createTransfer({ fromAccountId: from, toAccountId: to, amountMinor: parsed.minor, occurredOn: date, note })
      if (!result.ok) return setError(result.error)
      toast.success("Transfer recorded")
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="From" htmlFor="tr-from">
          <select id="tr-from" value={from} onChange={(e) => setFrom(e.target.value)} className={selectClass}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </select>
        </Field>
        <Field label="To" htmlFor="tr-to">
          <select id="tr-to" value={to} onChange={(e) => setTo(e.target.value)} className={selectClass} required>
            <option value="" disabled>
              Choose…
            </option>
            {accounts
              .filter((a) => a.id !== from)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Amount" htmlFor="tr-amount">
          <Input id="tr-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" required autoFocus className="tabular-nums" />
        </Field>
        <Field label="Date" htmlFor="tr-date">
          <Input id="tr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="dark:[color-scheme:dark]" />
        </Field>
      </div>
      <Field label="Note" htmlFor="tr-note">
        <Input id="tr-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Monthly savings" maxLength={500} />
      </Field>
      <FormError>{error}</FormError>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="lg" disabled={pending || accounts.length < 2}>
          Transfer
        </Button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// The list, grouped by day, plus the sheets it opens.
// ---------------------------------------------------------------------------

export function TransactionsBoard({
  transactions,
  accounts,
  categories,
  today,
  locale,
  openNew,
  editId,
  defaultAccountId,
}: {
  transactions: Transaction[]
  accounts: AccountOption[]
  categories: CategoryOption[]
  today: string
  locale: string
  openNew: boolean
  editId: string | null
  defaultAccountId?: string
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [editor, setEditor] = useState<EditorState>(() => {
    if (openNew) return { mode: "create" }
    const tx = editId ? transactions.find((t) => t.id === editId) : undefined
    return tx ? { mode: "edit", tx } : null
  })
  const [transfer, setTransfer] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const openAccounts = accounts.filter((a) => !a.archived)

  function closeEditor() {
    setEditor(null)
    // Drop ?new / ?edit so a refresh doesn't reopen the sheet.
    if (params.has("new") || params.has("edit")) {
      const q = new URLSearchParams(params)
      q.delete("new")
      q.delete("edit")
      router.replace(q.size ? `?${q}` : "?", { scroll: false })
    }
  }

  function remove(tx: Transaction) {
    setEditor(null)
    const ids = transactions.filter((t) => t.id === tx.id || (tx.transferId && t.transferId === tx.transferId)).map((t) => t.id)
    removeWithUndo({
      message: tx.transferId ? "Transfer deleted" : "Transaction deleted",
      hide: () => setHidden((prev) => new Set([...prev, ...ids])),
      restore: () =>
        setHidden((prev) => {
          const next = new Set(prev)
          for (const id of ids) next.delete(id)
          return next
        }),
      commit: () => deleteTransactions({ ids: [tx.id] }),
    })
  }

  const visible = transactions.filter((t) => !hidden.has(t.id))
  const days = new Map<string, Transaction[]>()
  for (const t of visible) days.set(t.occurredOn, [...(days.get(t.occurredOn) ?? []), t])

  return (
    <div className="grid gap-3">
      <QuickAdd accounts={openAccounts} locale={locale} autoFocus={false} onDetails={() => setEditor({ mode: "create" })} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="lg" onClick={() => setEditor({ mode: "create" })} disabled={openAccounts.length === 0}>
          <Plus />
          New transaction
        </Button>
        <Button variant="ghost" size="lg" onClick={() => setTransfer(true)} disabled={openAccounts.length < 2}>
          <ArrowsLeftRight />
          Transfer
        </Button>
        <p className="text-caption ml-auto self-center text-muted-foreground max-sm:hidden">
          Press <kbd className="rounded border border-field-border px-1 font-sans">N</kbd> to type a new one
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="glass grid gap-1 rounded-xl p-6">
          <p className="text-card-title">Nothing here yet</p>
          <p className="text-meta max-w-prose text-muted-foreground">
            Type something like “250 food lunch” above and press Enter, or import a bank export from the Import tab.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {[...days.entries()].map(([day, rows]) => {
            const net = rows.filter((r) => !r.transferId).reduce((s, r) => s + r.amountMinor, 0)
            return (
              <section key={day} aria-labelledby={`day-${day}`} className="grid gap-1.5">
                <header className="flex items-baseline justify-between px-1">
                  <h3 id={`day-${day}`} className="text-eyebrow text-muted-foreground">
                    {day === today ? "Today" : formatDay(day, locale, today)}
                  </h3>
                  {rows[0] && net !== 0 && (
                    <span className="text-caption text-muted-foreground tabular-nums">{formatMoney(net, rows[0].currency, locale, { signed: true })}</span>
                  )}
                </header>
                <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl">
                  {rows.map((tx) => (
                    <li key={tx.id}>
                      <TransactionRow tx={tx} locale={locale} onOpen={() => setEditor({ mode: "edit", tx })} />
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      <TransactionEditor
        state={editor}
        onClose={closeEditor}
        onDelete={remove}
        accounts={openAccounts.length ? openAccounts : accounts}
        categories={categories}
        today={today}
        defaultAccountId={defaultAccountId}
      />
      <TransferSheet open={transfer} onOpenChange={setTransfer} accounts={openAccounts} today={today} />
    </div>
  )
}

export function TransactionRow({ tx, locale, onOpen }: { tx: Transaction; locale: string; onOpen?: () => void }) {
  const title = tx.transferId ? (tx.amountMinor < 0 ? "Transfer out" : "Transfer in") : (tx.categoryName ?? "Uncategorised")
  const body = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-track [&_svg]:size-4">
        {tx.transferId ? <ArrowsLeftRight className="text-muted-foreground" /> : <CategoryDot color={tx.categoryColor} className="size-3" />}
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-body-strong truncate">{tx.note || title}</span>
        <span className="text-caption flex min-w-0 items-center gap-1 text-muted-foreground">
          <span className="truncate">
            {[tx.note ? title : null, tx.accountName, ...tx.tags.map((t) => `#${t}`)].filter(Boolean).join(" · ")}
          </span>
          {tx.recurringId && <Repeat className="size-3 shrink-0" aria-label="From a recurring payment" />}
        </span>
      </span>
      <span className={cn("text-body-strong shrink-0 tabular-nums", tx.amountMinor > 0 && !tx.transferId && "text-text-accent")}>
        {formatMoney(tx.amountMinor, tx.currency, locale, { signed: true, fixed: true })}
      </span>
    </>
  )
  if (!onOpen) return <div className="flex min-h-14 items-center gap-3 px-3 py-2">{body}</div>
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left outline-none hover:bg-track focus-visible:bg-track focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      aria-label={`${title}${tx.note ? `, ${tx.note}` : ""}, ${formatMoney(tx.amountMinor, tx.currency, locale, { signed: true })}. Edit`}
    >
      {body}
    </button>
  )
}
