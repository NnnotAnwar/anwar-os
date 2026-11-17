"use client"

import { useState, useTransition, type FormEvent } from "react"
import { toast } from "sonner"
import { Plus, Target, Trash2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { formatDay } from "../lib/dates"
import { monthlyNeeded } from "../lib/goals"
import { amountToInput, CURRENCIES, formatMoney, parseAmount } from "../lib/money"
import type { Goal } from "../schema"
import { createGoal, deleteGoal, updateGoal } from "../server-actions"
import { Bar, Field, FormError, Sheet, selectClass } from "./bits"
import type { AccountOption } from "./types"

type Editing = { mode: "create" } | { mode: "edit"; goal: Goal } | null

export function GoalsBoard({ goals, accounts, today, locale }: { goals: Goal[]; accounts: AccountOption[]; today: string; locale: string }) {
  const [editing, setEditing] = useState<Editing>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const visible = goals.filter((g) => !hidden.has(g.id))

  function remove(goal: Goal) {
    setEditing(null)
    removeWithUndo({
      message: `${goal.name} deleted`,
      hide: () => setHidden((prev) => new Set(prev).add(goal.id)),
      restore: () =>
        setHidden((prev) => {
          const next = new Set(prev)
          next.delete(goal.id)
          return next
        }),
      commit: () => deleteGoal({ id: goal.id }),
    })
  }

  return (
    <div className="grid gap-4">
      <div>
        <Button size="lg" onClick={() => setEditing({ mode: "create" })}>
          <Plus />
          New goal
        </Button>
      </div>
      {visible.length === 0 ? (
        <div className="glass grid gap-1 rounded-xl p-6">
          <p className="text-card-title">No goals yet</p>
          <p className="text-meta max-w-prose text-muted-foreground">
            A cushion, a trip, a deposit. Link a savings account and the progress follows its balance.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map((goal) => {
            const ratio = goal.progressMinor / goal.targetMinor
            const reached = ratio >= 1
            const needed = monthlyNeeded(goal, today)
            const late = goal.deadline !== null && goal.deadline < today && !reached
            return (
              <li key={goal.id}>
                <button
                  type="button"
                  onClick={() => setEditing({ mode: "edit", goal })}
                  className="glass press grid h-full w-full content-start gap-3 rounded-xl p-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  aria-label={`Edit goal ${goal.name}`}
                >
                  <span className="flex items-start gap-3">
                    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground [&_svg]:size-4", reached && "animate-pop")}>
                      <Target />
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="text-body-strong truncate">{goal.name}</span>
                      <span className="text-caption truncate text-muted-foreground">
                        {goal.accountName ? `From ${goal.accountName}` : "Tracked by hand"}
                        {goal.deadline && ` · by ${formatDay(goal.deadline, locale, today)}`}
                      </span>
                    </span>
                    <span className="text-metric-sm">{Math.min(999, Math.floor(ratio * 100))} %</span>
                  </span>
                  <Bar value={ratio} />
                  <span className="text-meta flex flex-wrap justify-between gap-x-3 tabular-nums">
                    <span>
                      {formatMoney(goal.progressMinor, goal.currency, locale)}{" "}
                      <span className="text-muted-foreground">of {formatMoney(goal.targetMinor, goal.currency, locale)}</span>
                    </span>
                    <span className={cn("text-muted-foreground", late && "text-warning-text")}>
                      {reached
                        ? "Reached"
                        : late
                          ? "Past the deadline"
                          : needed !== null
                            ? `${formatMoney(needed, goal.currency, locale)} a month to make it`
                            : `${formatMoney(goal.targetMinor - goal.progressMinor, goal.currency, locale)} to go`}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing?.mode === "edit" ? "Edit goal" : "New goal"}>
        {editing && (
          <GoalForm
            key={editing.mode === "edit" ? editing.goal.id : "new"}
            goal={editing.mode === "edit" ? editing.goal : null}
            accounts={accounts}
            onDone={() => setEditing(null)}
            onDelete={remove}
          />
        )}
      </Sheet>
    </div>
  )
}

function GoalForm({
  goal,
  accounts,
  onDone,
  onDelete,
}: {
  goal: Goal | null
  accounts: AccountOption[]
  onDone: () => void
  onDelete: (g: Goal) => void
}) {
  const [name, setName] = useState(goal?.name ?? "")
  const [target, setTarget] = useState(goal ? amountToInput(goal.targetMinor) : "")
  const [accountId, setAccountId] = useState(goal?.accountId ?? "")
  const [currency, setCurrency] = useState(goal?.currency ?? "CZK")
  const [saved, setSaved] = useState(goal ? amountToInput(goal.savedMinor) : "")
  const [deadline, setDeadline] = useState(goal?.deadline ?? "")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const account = accounts.find((a) => a.id === accountId)

  function submit(e: FormEvent) {
    e.preventDefault()
    const t = parseAmount(target)
    if (!t || t.minor === 0) return setError("Set a target, e.g. 150 000.")
    const s = saved.trim() ? parseAmount(saved) : { minor: 0 }
    if (!s) return setError("Enter the saved amount as a number.")
    const payload = {
      name,
      targetMinor: t.minor,
      currency: account?.currency ?? currency,
      deadline: deadline || null,
      accountId: accountId || null,
      savedMinor: accountId ? (goal?.savedMinor ?? 0) : s.minor,
    }
    start(async () => {
      const result = goal ? await updateGoal({ id: goal.id, ...payload }) : await createGoal(payload)
      if (!result.ok) return setError(result.error)
      toast.success(goal ? "Goal saved" : "Goal added")
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Name" htmlFor="goal-name">
        <Input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="e.g. Emergency fund" autoFocus={!goal} autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Target${account ? ` (${account.currency})` : ""}`} htmlFor="goal-target">
          <Input id="goal-target" value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" required placeholder="150 000" className="tabular-nums" />
        </Field>
        <Field label="Deadline (optional)" htmlFor="goal-deadline">
          <Input id="goal-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="dark:[color-scheme:dark]" />
        </Field>
        <Field label="Progress from" htmlFor="goal-account" className="col-span-2">
          <select id="goal-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={selectClass}>
            <option value="">I’ll enter it by hand</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                Balance of {a.name} · {a.currency}
              </option>
            ))}
          </select>
        </Field>
        {!accountId && (
          <>
            <Field label="Saved so far" htmlFor="goal-saved">
              <Input id="goal-saved" value={saved} onChange={(e) => setSaved(e.target.value)} inputMode="decimal" placeholder="0" className="tabular-nums" />
            </Field>
            <Field label="Currency" htmlFor="goal-currency">
              <select id="goal-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={selectClass}>
                {[...new Set([currency, ...CURRENCIES])].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
      </div>
      <FormError>{error}</FormError>
      <div className="flex flex-wrap items-center gap-2">
        {goal && (
          <Button type="button" variant="ghost" className="text-destructive" onClick={() => onDelete(goal)}>
            <Trash2 />
            Delete
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="lg" disabled={pending}>
            {goal ? "Save" : "Add goal"}
          </Button>
        </div>
      </div>
    </form>
  )
}
