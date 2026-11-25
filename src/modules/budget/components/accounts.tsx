"use client"

import { useState, useTransition, type FormEvent } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Bank, Inbox, PiggyBank, Plus, Trash2, TrendingUp, Wallet } from "@/components/icons"
import { NAV_FORWARD } from "@/components/motion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { FX_SOURCE, type FxNote } from "../fx/convert"
import { amountToInput, CURRENCIES, formatMoney, parseAmount } from "../lib/money"
import { accountKindLabels, accountKinds, type Account, type AccountKind } from "../schema"
import { archiveAccount, createAccount, deleteAccount, updateAccount } from "../server-actions"
import { Field, FormError, Sheet, selectClass } from "./bits"
import { FxNoteLine } from "./fx-note"

const kindIcon: Record<AccountKind, typeof Bank> = { cash: Wallet, bank: Bank, savings: PiggyBank, investment: TrendingUp }

type Editing = { mode: "create" } | { mode: "edit"; account: Account } | null

export function AccountsBoard({ accounts, locale, today, openNew }: { accounts: Account[]; locale: string; today: string; openNew: boolean }) {
  const [editing, setEditing] = useState<Editing>(openNew ? { mode: "create" } : null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [, start] = useTransition()
  const open = accounts.filter((a) => !a.archived && !hidden.has(a.id))
  const archived = accounts.filter((a) => a.archived && !hidden.has(a.id))

  function toggleArchive(account: Account) {
    const value = !account.archived
    start(async () => {
      const result = await archiveAccount({ id: account.id, archived: value })
      if (!result.ok) return void toast.error(result.error)
      toast.success(value ? `${account.name} archived` : `${account.name} is back`, {
        action: { label: "Undo", onClick: () => start(() => void archiveAccount({ id: account.id, archived: !value })) },
      })
    })
  }

  function remove(account: Account) {
    setEditing(null)
    removeWithUndo({
      message: `${account.name} deleted`,
      hide: () => setHidden((prev) => new Set(prev).add(account.id)),
      restore: () =>
        setHidden((prev) => {
          const next = new Set(prev)
          next.delete(account.id)
          return next
        }),
      commit: () => deleteAccount({ id: account.id }),
    })
  }

  const row = (a: Account) => {
    const Icon = kindIcon[a.kind]
    return (
      <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground [&_svg]:size-4">
          <Icon />
        </span>
        <button
          type="button"
          onClick={() => setEditing({ mode: "edit", account: a })}
          className="grid min-w-0 flex-1 gap-0.5 rounded-lg px-1 py-1 text-left outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={`Edit ${a.name}`}
        >
          <span className="text-body-strong truncate">{a.name}</span>
          <span className="text-caption text-muted-foreground">
            {accountKindLabels[a.kind]} · {a.currency} · {a.transactionCount} {a.transactionCount === 1 ? "transaction" : "transactions"}
          </span>
        </button>
        <span className="ml-auto grid justify-items-end gap-0.5">
          <span className={cn("text-body-strong tabular-nums", a.balanceMinor < 0 && "text-destructive")}>
            {formatMoney(a.balanceMinor, a.currency, locale, { fixed: true })}
          </span>
          {a.baseBalance && (
            <span className="text-caption text-muted-foreground tabular-nums" title={`At the ČNB rate of ${a.baseBalance.rateOn}`}>
              ≈ {formatMoney(a.baseBalance.minor, a.baseBalance.currency, locale, { fixed: true })}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1 max-sm:basis-full max-sm:justify-end">
          <Link
            href={`/app/budget/transactions?account=${a.id}`}
            transitionTypes={NAV_FORWARD}
            className="text-small flex h-9 items-center rounded-lg px-2.5 text-text-accent outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Transactions
          </Link>
          <Button variant="ghost" size="sm" onClick={() => toggleArchive(a)} className="h-9 text-muted-foreground">
            <Inbox />
            {a.archived ? "Unarchive" : "Archive"}
          </Button>
        </div>
      </li>
    )
  }

  return (
    <div className="grid gap-4">
      <div>
        <Button size="lg" onClick={() => setEditing({ mode: "create" })}>
          <Plus />
          New account
        </Button>
      </div>
      {open.length === 0 ? (
        <div className="glass grid gap-1 rounded-xl p-6">
          <p className="text-card-title">No accounts yet</p>
          <p className="text-meta text-muted-foreground">Add your bank account, cash, savings — each keeps its own currency and balance.</p>
        </div>
      ) : (
        <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl">{open.map(row)}</ul>
      )}
      <RatesFootnote accounts={accounts} today={today} locale={locale} />
      {archived.length > 0 && (
        <section aria-labelledby="archived-title" className="grid gap-2">
          <h2 id="archived-title" className="text-eyebrow px-1 text-muted-foreground">
            Archived
          </h2>
          <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl opacity-80">{archived.map(row)}</ul>
        </section>
      )}
      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing?.mode === "edit" ? "Edit account" : "New account"}>
        {editing && (
          <AccountForm
            key={editing.mode === "edit" ? editing.account.id : "new"}
            account={editing.mode === "edit" ? editing.account : null}
            today={today}
            onDone={() => setEditing(null)}
            onDelete={remove}
          />
        )}
      </Sheet>
    </div>
  )
}

/** "≈ at ČNB rates · Rates: ČNB, 25 Nov" under accounts in other currencies, or why one has no equivalent. */
function RatesFootnote({ accounts, today, locale }: { accounts: Account[]; today: string; locale: string }) {
  const converted = accounts.flatMap((a) => (a.baseBalance ? [a.baseBalance] : []))
  const missing = [...new Set(accounts.filter((a) => a.baseBalance === null).map((a) => a.currency))]
  if (!converted.length && !missing.length) return null
  const note: FxNote = {
    source: FX_SOURCE,
    rateOn: converted.reduce<string | null>((d, c) => (!d || c.rateOn > d ? c.rateOn : d), null),
    approximate: converted.some((c) => c.approximate),
    converted: [...new Set(accounts.filter((a) => a.baseBalance).map((a) => a.currency))].sort(),
    unavailable: missing.sort(),
  }
  return <FxNoteLine note={note} today={today} locale={locale} className="px-1" unavailableText="balances have no rate right now" />
}

function AccountForm({
  account,
  today,
  onDone,
  onDelete,
}: {
  account: Account | null
  today: string
  onDone: () => void
  onDelete: (a: Account) => void
}) {
  const [name, setName] = useState(account?.name ?? "")
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "bank")
  const [currency, setCurrency] = useState(account?.currency ?? "CZK")
  const [opening, setOpening] = useState(account ? amountToInput(account.openingBalanceMinor) : "")
  const [openedOn, setOpenedOn] = useState(account?.openedOn ?? today)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit(e: FormEvent) {
    e.preventDefault()
    let openingMinor = 0
    if (opening.trim()) {
      const parsed = parseAmount(opening)
      if (!parsed) return setError("Enter the opening balance as a number, e.g. 12 500,00.")
      openingMinor = (parsed.sign === "-" ? -1 : 1) * parsed.minor
    }
    const payload = { name, kind, currency, openingBalanceMinor: openingMinor, openedOn }
    start(async () => {
      const result = account ? await updateAccount({ id: account.id, ...payload }) : await createAccount(payload)
      if (!result.ok) return setError(result.error)
      toast.success(account ? "Account saved" : "Account added")
      onDone()
    })
  }

  const currencies = [...new Set([currency, ...CURRENCIES])]
  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Name" htmlFor="acc-name">
        <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Fio current account" required autoFocus={!account} autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind" htmlFor="acc-kind">
          <select id="acc-kind" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)} className={selectClass}>
            {accountKinds.map((k) => (
              <option key={k} value={k}>
                {accountKindLabels[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Currency" htmlFor="acc-currency" hint={account && account.transactionCount > 0 ? "Changing it relabels, it doesn't convert." : undefined}>
          <select id="acc-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={selectClass}>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Opening balance" htmlFor="acc-opening" hint="Negative for a debt.">
          <Input id="acc-opening" value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="decimal" placeholder="0" className="tabular-nums" />
        </Field>
        <Field label="As of" htmlFor="acc-opened">
          <Input id="acc-opened" type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} required className="dark:[color-scheme:dark]" />
        </Field>
      </div>
      <FormError>{error}</FormError>
      <div className="flex flex-wrap items-center gap-2">
        {account && account.transactionCount === 0 && (
          <Button type="button" variant="ghost" className="text-destructive" onClick={() => onDelete(account)}>
            <Trash2 />
            Delete
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="lg" disabled={pending}>
            {account ? "Save" : "Add account"}
          </Button>
        </div>
      </div>
    </form>
  )
}
