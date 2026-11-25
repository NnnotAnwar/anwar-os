"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowsLeftRight, CheckSquare, Pencil, Plus, Receipt, Repeat, Trash2 } from "@/components/icons"
import { pendingRemovals, usePendingRemovals } from "@/components/list/pending"
import { RowContextMenu } from "@/components/list/row-menu"
import { BulkBar, SelectButton, SelectCheck, useSelection } from "@/components/list/selection"
import { EmptyState, ShortcutHint } from "@/components/list/shortcut-hint"
import { SwipeRow, type RowAction } from "@/components/list/swipe-row"
import { useListKeyboard } from "@/components/list/use-list-keyboard"
import { Button } from "@/components/ui/button"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { formatDay } from "../lib/dates"
import { formatMoney } from "../lib/money"
import type { Transaction } from "../schema"
import { deleteTransactions } from "../server-actions"
import { CategoryDot } from "./bits"
import { QuickAdd, TransactionEditor, TransferSheet, type EditorState } from "./transactions"
import type { AccountOption, CategoryOption } from "./types"
import { dayNet, type DayNet } from "../lib/day-net"

/**
 * The month's transactions grouped by day. On phones: swipe left to delete,
 * right to edit, hold for the menu. On desktop: J/K, E or Enter to edit,
 * X to select, ⌫ to delete, N for a new one, / to search.
 */
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
  const removed = usePendingRemovals()
  const container = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement | null>(null)
  const [editor, setEditor] = useState<EditorState>(() => {
    if (openNew) return { mode: "create" }
    const tx = editId ? transactions.find((t) => t.id === editId) : undefined
    return tx ? { mode: "edit", tx } : null
  })
  const [transfer, setTransfer] = useState(false)
  const openAccounts = accounts.filter((a) => !a.archived)

  const visible = useMemo(() => transactions.filter((t) => !removed.has(t.id)), [transactions, removed])
  const byId = new Map(visible.map((t) => [t.id, t]))
  const selection = useSelection(visible.map((t) => t.id))

  // The search field lives in the filter bar above; "/" focuses it.
  useEffect(() => {
    filterRef.current = document.getElementById("f-query") as HTMLInputElement | null
  }, [])

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

  /** Deletes with Undo; a transfer leg takes its other leg along. */
  function remove(ids: string[]) {
    if (!ids.length) return
    setEditor(null)
    selection.done()
    const transferIds = new Set(ids.map((id) => byId.get(id)?.transferId).filter(Boolean))
    const all = [...new Set([...ids, ...transactions.filter((t) => t.transferId && transferIds.has(t.transferId)).map((t) => t.id)])]
    const single = ids.length === 1 ? byId.get(ids[0]!) : null
    removeWithUndo({
      message: single ? (single.transferId ? "Transfer deleted" : "Transaction deleted") : `${ids.length} transactions deleted`,
      hide: () => all.forEach((id) => pendingRemovals.add(id)),
      restore: () => all.forEach((id) => pendingRemovals.remove(id)),
      commit: () => deleteTransactions({ ids }),
    })
  }

  const edit = (id: string | null) => {
    const tx = id ? byId.get(id) : undefined
    if (tx) setEditor({ mode: "edit", tx })
  }
  const targets = (id: string | null) => (selection.count ? [...selection.ids] : id ? [id] : [])

  useListKeyboard({
    container,
    filter: filterRef,
    selection,
    enabled: editor === null && !transfer,
    handlers: {
      new: () => document.getElementById("quick-tx")?.focus(),
      open: edit,
      edit,
      delete: (id) => remove(targets(id)),
    },
  })

  function actionsFor(tx: Transaction): RowAction[] {
    return [
      { id: "edit", label: "Edit", icon: Pencil, tone: "accent", onSelect: () => edit(tx.id), shortcut: "E" },
      { id: "select", label: "Select", icon: CheckSquare, onSelect: () => selection.toggle(tx.id), shortcut: "X" },
      { id: "delete", label: "Delete", icon: Trash2, tone: "destructive", onSelect: () => remove([tx.id]), shortcut: "⌫" },
    ]
  }

  const days = new Map<string, Transaction[]>()
  for (const t of visible) days.set(t.occurredOn, [...(days.get(t.occurredOn) ?? []), t])
  const selectedSum = new Map<string, number>()
  for (const id of selection.ids) {
    const t = byId.get(id)
    if (t) selectedSum.set(t.currency, (selectedSum.get(t.currency) ?? 0) + t.amountMinor)
  }

  return (
    <div ref={container} className="grid gap-3">
      <QuickAdd accounts={openAccounts} locale={locale} shortcut={false} onDetails={() => setEditor({ mode: "create" })} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="lg" onClick={() => setEditor({ mode: "create" })} disabled={openAccounts.length === 0}>
          <Plus />
          New transaction
        </Button>
        <Button variant="ghost" size="lg" onClick={() => setTransfer(true)} disabled={openAccounts.length < 2}>
          <ArrowsLeftRight />
          Transfer
        </Button>
        <div className="ml-auto">
          <SelectButton selection={selection} disabled={visible.length === 0} />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={Receipt} title="Nothing here yet">
          Type something like “250 food lunch” above and press Enter, or bring in a bank export from Import.
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {[...days.entries()].map(([day, rows]) => {
            const net = dayNet(rows)
            return (
              <section key={day} aria-labelledby={`day-${day}`} className="grid gap-1.5">
                <header className="flex items-baseline justify-between px-1">
                  <h3 id={`day-${day}`} className="text-eyebrow text-muted-foreground">
                    {day === today ? "Today" : formatDay(day, locale, today)}
                  </h3>
                  {net && <DayNetLabel net={net} locale={locale} />}
                </header>
                <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl">
                  {rows.map((tx) => {
                    const actions = actionsFor(tx)
                    const checked = selection.has(tx.id)
                    return (
                      <li key={tx.id} data-row-id={tx.id}>
                        <SwipeRow disabled={selection.active} leading={actions[0]} trailing={[actions[2]!]}>
                          <RowContextMenu actions={actions} label={rowTitle(tx)}>
                            <div
                              className={cn(checked && "bg-secondary")}
                              onClickCapture={(e) => {
                                if (!selection.active && !e.shiftKey) return
                                e.preventDefault()
                                e.stopPropagation()
                                if (e.shiftKey) selection.extend(tx.id)
                                else selection.toggle(tx.id)
                              }}
                            >
                              <TransactionRow
                                tx={tx}
                                locale={locale}
                                onOpen={() => edit(tx.id)}
                                leading={selection.active ? <SelectCheck checked={checked} /> : undefined}
                              />
                            </div>
                          </RowContextMenu>
                        </SwipeRow>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {visible.length > 0 && (
        <ShortcutHint
          className="pt-1"
          items={[
            [["J", "K"], "move"],
            [["E", "↵"], "edit"],
            [["N"], "new"],
            [["X"], "select"],
            [["⌫"], "delete"],
            [["/"], "search"],
          ]}
          touch="Swipe left to delete, right to edit. Hold a row for more."
        />
      )}

      <BulkBar selection={selection} noun={["transaction", "transactions"]} total={visible.length}>
        {selectedSum.size > 0 && (
          <span className="text-meta px-2 tabular-nums max-sm:hidden">
            {[...selectedSum.entries()].map(([c, v]) => formatMoney(v, c, locale, { signed: true })).join(" · ")}
          </span>
        )}
        <Button variant="destructive" size="lg" disabled={!selection.count} onClick={() => remove([...selection.ids])}>
          <Trash2 />
          <span className="max-sm:sr-only">Delete</span>
        </Button>
      </BulkBar>

      <TransactionEditor
        state={editor}
        onClose={closeEditor}
        onDelete={(tx) => remove([tx.id])}
        accounts={openAccounts.length ? openAccounts : accounts}
        categories={categories}
        today={today}
        defaultAccountId={defaultAccountId}
      />
      <TransferSheet open={transfer} onOpenChange={setTransfer} accounts={openAccounts} today={today} />
    </div>
  )
}

function rowTitle(tx: Transaction) {
  return tx.transferId ? (tx.amountMinor < 0 ? "Transfer out" : "Transfer in") : (tx.categoryName ?? "Uncategorised")
}

/** The day's net beside its heading; nothing for a day that nets to zero. */
function DayNetLabel({ net, locale }: { net: DayNet; locale: string }) {
  const parts =
    net.kind === "per-currency"
      ? net.nets.filter((n) => n.minor !== 0).map((n) => formatMoney(n.minor, n.currency, locale, { signed: true }))
      : net.minor !== 0
        ? [`${net.kind === "converted" ? "≈ " : ""}${formatMoney(net.minor, net.currency, locale, { signed: true })}`]
        : []
  if (parts.length === 0) return null
  return (
    <span
      className="text-caption text-muted-foreground tabular-nums"
      title={net.kind === "converted" ? "Other currencies at the ČNB rate of their day" : undefined}
    >
      {parts.join(" · ")}
    </span>
  )
}

export function TransactionRow({
  tx,
  locale,
  onOpen,
  leading,
}: {
  tx: Transaction
  locale: string
  onOpen: () => void
  leading?: React.ReactNode
}) {
  const title = rowTitle(tx)
  return (
    <button
      type="button"
      data-row-primary
      onClick={onOpen}
      className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left outline-none hover:bg-white/40 focus-visible:bg-track focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset dark:hover:bg-white/5"
      aria-label={`${title}${tx.note ? `, ${tx.note}` : ""}, ${formatMoney(tx.amountMinor, tx.currency, locale, { signed: true })}. Edit`}
    >
      {leading ?? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-track [&_svg]:size-4">
          {tx.transferId ? <ArrowsLeftRight className="text-muted-foreground" /> : <CategoryDot color={tx.categoryColor} className="size-3" />}
        </span>
      )}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-body-strong truncate">{tx.note || title}</span>
        <span className="text-caption flex min-w-0 items-center gap-1 text-muted-foreground">
          <span className="truncate">
            {[tx.note ? title : null, tx.accountName, ...tx.tags.map((t) => `#${t}`)].filter(Boolean).join(" · ")}
          </span>
          {tx.recurringId && <Repeat className="size-3 shrink-0" aria-label="From a recurring payment" />}
        </span>
      </span>
      <span className="grid shrink-0 justify-items-end gap-0.5">
        <span className={cn("text-body-strong tabular-nums", tx.amountMinor > 0 && !tx.transferId && "text-text-accent")}>
          {formatMoney(tx.amountMinor, tx.currency, locale, { signed: true, fixed: true })}
        </span>
        {tx.baseAmount && (
          <span className="text-caption text-muted-foreground tabular-nums" title={`At the ČNB rate of ${tx.baseAmount.rateOn}`}>
            ≈ {formatMoney(tx.baseAmount.minor, tx.baseAmount.currency, locale, { signed: true, fixed: true })}
          </span>
        )}
      </span>
    </button>
  )
}
