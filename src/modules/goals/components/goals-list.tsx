"use client"

import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { NAV_FORWARD } from "@/components/motion"
import { ArrowDown, ArrowUp, CheckCircle, MoreHorizontal, Plus, Trash2, X } from "@/components/icons"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { formatAmount } from "../lib/progress"
import { goalStatusLabels, SUGGESTED_GOALS, type Goal, type GoalStatus } from "../schema"
import { deleteGoal, logGoalProgress, quickAddGoal, reorderGoals, setGoalStatus } from "../server-actions"
import { ProgressBar, ProgressLine } from "./goal-progress"

/** One-line add for the year on screen; Enter adds, the toast opens it to set a target. */
export function QuickAddGoal({ year }: { year: number }) {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const input = useRef<HTMLInputElement>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = title.trim()
    if (!value) {
      setError("Name the goal first, e.g. Read 20 books.")
      return
    }
    startTransition(async () => {
      const result = await quickAddGoal({ title: value, year })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setTitle("")
      setError(null)
      toast.success("Goal added", {
        action: { label: "Set a target", onClick: () => router.push(`/app/goals/${result.id}`) },
      })
      input.current?.focus()
    })
  }

  return (
    <form onSubmit={submit} className="glass grid gap-2 rounded-xl p-3" aria-label="Add a goal">
      <div className="flex gap-2">
        <label htmlFor="quick-goal" className="sr-only">
          New goal for {year}
        </label>
        <Input
          ref={input}
          id="quick-goal"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            if (error) setError(null)
          }}
          placeholder={`A goal for ${year}, e.g. Run a half marathon`}
          maxLength={120}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "quick-goal-error" : undefined}
          className="h-10 md:h-9"
        />
        <Button type="submit" size="lg" disabled={pending}>
          <Plus />
          Add goal
        </Button>
      </div>
      {error && (
        <p id="quick-goal-error" role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

/** The year's goals as cards, in the owner's order; one-tap progress for measured ones. */
export function GoalsList({
  goals: initial,
  elapsed,
  locale,
}: {
  goals: Goal[]
  elapsed: number | null
  locale: string
}) {
  const [goals, setGoals] = useState(initial)
  // New data from the server (after a save elsewhere) replaces the local copy.
  const [synced, setSynced] = useState(initial)
  if (initial !== synced) {
    setSynced(initial)
    setGoals(initial)
  }
  const [, startTransition] = useTransition()

  const active = goals.filter((g) => g.status === "active").length

  function replace(goal: Goal) {
    setGoals((all) => all.map((g) => (g.id === goal.id ? goal : g)))
  }

  function move(goal: Goal, by: -1 | 1) {
    const same = goals.filter((g) => g.status === goal.status)
    const i = same.findIndex((g) => g.id === goal.id)
    const j = i + by
    if (j < 0 || j >= same.length) return
    const order = [...same]
    ;[order[i], order[j]] = [order[j]!, order[i]!]
    const rest = goals.filter((g) => g.status !== goal.status)
    setGoals([...order, ...rest].sort((a, b) => statusRank(a.status) - statusRank(b.status)))
    startTransition(() => reorderGoals({ ids: order.map((g) => g.id) }))
  }

  function setStatus(goal: Goal, status: GoalStatus, message: string) {
    setGoals((all) => all.map((g) => (g.id === goal.id ? { ...g, status } : g)))
    startTransition(async () => {
      await setGoalStatus({ id: goal.id, status })
      toast.success(message)
    })
  }

  function remove(goal: Goal) {
    const before = goals
    removeWithUndo({
      message: "Goal deleted",
      hide: () => setGoals((all) => all.filter((g) => g.id !== goal.id)),
      restore: () => setGoals(before),
      commit: () => deleteGoal({ id: goal.id }),
    })
  }

  return (
    <div className="grid gap-3">
      {active > SUGGESTED_GOALS && (
        <p className="text-caption text-muted-foreground">
          {active} active goals. Fewer goals tend to get done: consider dropping or merging some.
        </p>
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {goals.map((goal) => {
          const same = goals.filter((g) => g.status === goal.status)
          const index = same.findIndex((g) => g.id === goal.id)
          return (
            <li key={goal.id}>
              <GoalCard
                goal={goal}
                elapsed={elapsed}
                locale={locale}
                canMoveUp={index > 0}
                canMoveDown={index < same.length - 1}
                onMove={(by) => move(goal, by)}
                onStatus={(status, message) => setStatus(goal, status, message)}
                onDelete={() => remove(goal)}
                onProgress={replace}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function statusRank(s: GoalStatus) {
  return s === "active" ? 0 : s === "done" ? 1 : 2
}

function GoalCard({
  goal,
  elapsed,
  locale,
  canMoveUp,
  canMoveDown,
  onMove,
  onStatus,
  onDelete,
  onProgress,
}: {
  goal: Goal
  elapsed: number | null
  locale: string
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (by: -1 | 1) => void
  onStatus: (status: GoalStatus, message: string) => void
  onDelete: () => void
  onProgress: (goal: Goal) => void
}) {
  const [pending, startTransition] = useTransition()
  const measured = goal.progress.kind === "target" && goal.status === "active"
  const unit = goal.targetUnit

  function logOne() {
    startTransition(async () => {
      const result = await logGoalProgress({ id: goal.id, by: 1 })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      onProgress(result.goal)
      toast.success(`${formatAmount(result.goal.currentValue, locale)}${unit ? ` ${unit}` : ""} so far`)
    })
  }

  return (
    <article
      className={cn(
        "glass grid h-full content-start gap-3 rounded-xl p-4",
        goal.status !== "active" && "opacity-80",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-1">
          <h2 className="text-card-title">
            <Link
              href={`/app/goals/${goal.id}`}
              transitionTypes={NAV_FORWARD}
              className="rounded outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {goal.title}
            </Link>
          </h2>
          {goal.why && <p className="text-meta line-clamp-2 text-muted-foreground">{goal.why}</p>}
        </div>
        {goal.status !== "active" && (
          <span className="text-micro rounded-full bg-track px-2 py-1 text-muted-foreground">{goalStatusLabels[goal.status]}</span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Options for ${goal.title}`}
            className="-mt-1.5 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-track hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <MoreHorizontal className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="glass glass-menu w-52">
            {goal.status === "active" ? (
              <>
                <DropdownMenuItem onClick={() => onStatus("done", "Goal achieved")}>
                  <CheckCircle />
                  Mark achieved
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onStatus("dropped", "Goal dropped")}>
                  <X />
                  Drop
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onClick={() => onStatus("active", "Goal active again")}>Make active again</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!canMoveUp} onClick={() => onMove(-1)}>
              <ArrowUp />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canMoveDown} onClick={() => onMove(1)}>
              <ArrowDown />
              Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="grid gap-1.5">
        <ProgressBar goal={goal} elapsed={elapsed} />
        <div className="flex min-h-11 items-center gap-2">
          <ProgressLine goal={goal} elapsed={elapsed} locale={locale} className="min-w-0 flex-1" />
          {measured && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={logOne}
              disabled={pending}
              aria-label={`Log one more for ${goal.title}`}
              className="h-11 min-w-11 md:h-8"
            >
              <Plus />1
            </Button>
          )}
        </div>
        {(goal.tasksTotal > 0 || goal.projectCount > 0) && goal.progress.kind === "target" && (
          <p className="text-caption text-muted-foreground tabular-nums">
            {goal.tasksDone} of {goal.tasksTotal} linked {goal.tasksTotal === 1 ? "task" : "tasks"} done
          </p>
        )}
      </div>
    </article>
  )
}
