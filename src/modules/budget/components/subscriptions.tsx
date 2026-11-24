"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Pause, Play, Plus, Receipt, Repeat, X } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { formatDay } from "../lib/dates"
import { formatMoney } from "../lib/money"
import { describeRule } from "../lib/recurring"
import { relativeDay } from "../lib/subscriptions"
import type { RecurringCost, SubscriptionItem, SubscriptionsData } from "../schema"
import { deleteRecurring, setRecurringActive, setRecurringSubscription } from "../server-actions"
import { Sheet } from "./bits"
import { RecurringForm } from "./recurring"
import type { AccountOption, CategoryOption } from "./types"

type Editing = { mode: "create" } | { mode: "edit"; item: SubscriptionItem } | null

/** Budget → Subscriptions: what recurring expenses cost, sorted by next charge. */
export function SubscriptionsBoard({
  data,
  accounts,
  categories,
  locale,
}: {
  data: SubscriptionsData
  accounts: AccountOption[]
  categories: CategoryOption[]
  locale: string
}) {
  const [editing, setEditing] = useState<Editing>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [, start] = useTransition()
  const visible = data.items.filter((i) => !hidden.has(i.id))
  const subscriptions = visible.filter((i) => i.subscription)
  const others = visible.filter((i) => !i.subscription)
  const subscriptionCategory = categories.find((c) => c.kind === "expense" && !c.parentId && c.name.toLowerCase() === "subscriptions")

  function pause(item: SubscriptionItem) {
    const active = !item.active
    start(async () => {
      const result = await setRecurringActive({ id: item.id, active })
      if (!result.ok) return void toast.error(result.error)
      toast.success(active ? `${item.note} resumed` : `${item.note} paused · no charges until you resume it`, {
        action: { label: "Undo", onClick: () => start(() => void setRecurringActive({ id: item.id, active: !active })) },
      })
    })
  }

  function mark(item: SubscriptionItem, subscription: boolean) {
    start(async () => {
      const result = await setRecurringSubscription({ id: item.id, subscription })
      if (!result.ok) return void toast.error(result.error)
      toast.success(subscription ? `${item.note} is a subscription` : `${item.note} moved to other payments`, {
        action: { label: "Undo", onClick: () => start(() => void setRecurringSubscription({ id: item.id, subscription: !subscription })) },
      })
    })
  }

  function cancel(item: SubscriptionItem) {
    setEditing(null)
    removeWithUndo({
      message: `${item.note} cancelled · its past payments stay in Budget`,
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

  const row = (item: SubscriptionItem) => (
    <SubscriptionRow
      key={item.id}
      item={item}
      today={data.today}
      locale={locale}
      onEdit={() => setEditing({ mode: "edit", item })}
      onPause={() => pause(item)}
      onCancel={() => cancel(item)}
      onMark={item.subscription ? undefined : () => mark(item, true)}
    />
  )

  return (
    <div className="grid gap-4">
      <Summary data={data} locale={locale} />

      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={() => setEditing({ mode: "create" })} disabled={accounts.length === 0}>
          <Plus />
          New subscription
        </Button>
      </div>

      {visible.length === 0 ? (
        <div className="glass grid justify-items-start gap-2 rounded-xl p-6">
          <p className="text-card-title">No subscriptions yet</p>
          <p className="text-meta max-w-prose text-muted-foreground">
            Add Netflix, Spotify, the gym: you&apos;ll see what they cost a month and a year, when each one charges next, and get a
            Telegram reminder the day before.
          </p>
        </div>
      ) : (
        <>
          <section aria-labelledby="subs-list" className="grid gap-2">
            <h2 id="subs-list" className="text-eyebrow text-text-accent">
              Subscriptions
            </h2>
            {subscriptions.length ? (
              <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl">{subscriptions.map(row)}</ul>
            ) : (
              <p className="text-meta glass rounded-xl p-4 text-muted-foreground">
                None marked yet. Tap “Subscription” on a payment below, or add a new one.
              </p>
            )}
          </section>
          {others.length > 0 && (
            <section aria-labelledby="other-list" className="grid gap-2">
              <div className="grid gap-0.5">
                <h2 id="other-list" className="text-eyebrow text-text-accent">
                  Other recurring payments
                </h2>
                <p className="text-caption text-muted-foreground">Rent, bills, savings: not counted as subscriptions.</p>
              </div>
              <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl">{others.map(row)}</ul>
            </section>
          )}
        </>
      )}

      <Sheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.mode === "edit" ? `Edit ${editing.item.note}` : "New subscription"}
        description="Charges become transactions when you generate due payments under Recurring."
      >
        {editing && (
          <RecurringForm
            key={editing.mode === "edit" ? editing.item.id : "new"}
            item={editing.mode === "edit" ? editing.item : null}
            accounts={accounts}
            categories={categories}
            today={data.today}
            defaults={{ subscription: true, categoryId: subscriptionCategory?.id }}
            onDone={() => setEditing(null)}
            onDelete={() => editing.mode === "edit" && cancel(editing.item)}
          />
        )}
      </Sheet>
    </div>
  )
}

function costLine(costs: RecurringCost[], locale: string) {
  return costs.map((c) => ({
    key: c.currency,
    month: formatMoney(c.monthlyMinor, c.currency, locale),
    year: formatMoney(c.yearlyMinor, c.currency, locale),
    count: c.count,
  }))
}

function Summary({ data, locale }: { data: SubscriptionsData; locale: string }) {
  const subs = costLine(data.subscriptions, locale)
  const all = costLine(data.allRecurring, locale)
  const [main, ...rest] = subs
  const others = data.allRecurring.some((c) => {
    const s = data.subscriptions.find((x) => x.currency === c.currency)
    return !s || s.count !== c.count
  })
  return (
    <section aria-labelledby="subs-total" className="glass grid gap-2 rounded-xl p-4 [--glass-shadow:var(--shadow-glass-lg)] md:p-5">
      <p id="subs-total" className="text-eyebrow text-muted-foreground">
        What they cost
      </p>
      {main ? (
        <>
          <p className="text-heading tabular-nums" data-testid="subscriptions-total">
            Subscriptions cost <span className="text-text-accent">{main.month}</span> a month · {main.year} a year
          </p>
          <p className="text-caption text-muted-foreground tabular-nums">
            {main.count === 1 ? "1 active subscription" : `${main.count} active subscriptions`}
            {rest.map((r) => ` · also ${r.month} a month in ${r.key}`)}
          </p>
        </>
      ) : (
        <p className="text-heading">No active subscriptions</p>
      )}
      {others && all.length > 0 && (
        <p className="text-caption text-muted-foreground tabular-nums">
          All recurring payments: {all.map((a) => `${a.month} a month`).join(" · ")}
        </p>
      )}
    </section>
  )
}

function SubscriptionRow({
  item,
  today,
  locale,
  onEdit,
  onPause,
  onCancel,
  onMark,
}: {
  item: SubscriptionItem
  today: string
  locale: string
  onEdit: () => void
  onPause: () => void
  onCancel: () => void
  onMark?: () => void
}) {
  const finished = !item.nextCharge && item.active
  const relative = item.nextCharge ? relativeDay(item.nextCharge, today) : null
  const status = !item.active
    ? "Paused"
    : finished
      ? "Finished"
      : `${relative ?? "Next"} · ${formatDay(item.nextCharge!, locale, today)}`
  const soon = relative === "Today" || relative === "Tomorrow"
  const monthly = item.freq !== "monthly" || item.interval !== 1
  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5", !item.nextCharge && "opacity-70")} data-testid="subscription-row">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-track text-muted-foreground [&_svg]:size-4">
        {item.subscription ? <Receipt /> : <Repeat />}
      </span>
      <button
        type="button"
        onClick={onEdit}
        className="grid min-w-0 flex-1 gap-0.5 rounded-lg px-1 py-1 text-left outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`Edit ${item.note}`}
      >
        <span className="text-body-strong truncate">{item.note}</span>
        <span className="text-caption truncate text-muted-foreground">
          {describeRule(item)} · {item.categoryName ?? "Uncategorised"} · {item.accountName}
        </span>
      </button>
      <span className="grid justify-items-end gap-0.5">
        <span className="text-body-strong tabular-nums">{formatMoney(Math.abs(item.amountMinor), item.currency, locale)}</span>
        <span className={cn("text-caption tabular-nums", soon ? "font-semibold text-warning-text" : "text-muted-foreground")}>{status}</span>
        {monthly && item.monthlyMinor > 0 && (
          <span className="text-caption tabular-nums text-muted-foreground">≈ {formatMoney(item.monthlyMinor, item.currency, locale)} a month</span>
        )}
      </span>
      <div className="flex items-center">
        {onMark && (
          <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={onMark} aria-label={`Mark ${item.note} as a subscription`}>
            <Plus />
            Subscription
          </Button>
        )}
        {!finished && (
          <Button
            variant="ghost"
            size="icon"
            className="size-11 text-muted-foreground md:size-9"
            onClick={onPause}
            aria-label={item.active ? `Pause ${item.note}` : `Resume ${item.note}`}
          >
            {item.active ? <Pause /> : <Play />}
          </Button>
        )}
        <Button variant="ghost" size="icon" className="size-11 text-muted-foreground md:size-9" onClick={onCancel} aria-label={`Cancel ${item.note}`}>
          <X />
        </Button>
      </div>
    </li>
  )
}
