"use client"

import { useEffect, useId, useState, useTransition } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { GoalOption } from "../schema"
import { getGoalPicker, linkToGoal } from "../server-actions"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * "Goal" in the task and project editors. Self-contained: it loads its options,
 * and a change applies at once (with a toast), apart from the editor's own save.
 * Renders nothing until the item is saved (no id yet) or when there are no goals.
 */
export function GoalPicker({
  taskId,
  projectId,
  labelClassName = "text-small text-muted-foreground",
  selectClassName,
}: {
  taskId?: string
  projectId?: string
  labelClassName?: string
  selectClassName?: string
}) {
  const id = useId()
  const target = taskId ?? projectId ?? ""
  const valid = UUID.test(target)
  const [state, setState] = useState<{ options: GoalOption[]; current: string } | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!valid) return
    let alive = true
    getGoalPicker(taskId ? { taskId } : { projectId }).then(
      ({ options, current }) => {
        if (!alive) return
        // A goal from another year or already achieved stays selectable while it's the current one.
        const all = current && !options.some((o) => o.id === current.id) ? [current, ...options] : options
        setState({ options: all, current: current?.id ?? "" })
      },
      () => alive && setState({ options: [], current: "" }),
    )
    return () => {
      alive = false
    }
  }, [taskId, projectId, valid])

  if (!valid || (state && state.options.length === 0)) return null

  const years = new Set(state?.options.map((o) => o.year))

  function change(goalId: string) {
    const previous = state?.current ?? ""
    setState((s) => (s ? { ...s, current: goalId } : s))
    startTransition(async () => {
      const result = await linkToGoal(taskId ? { goalId: goalId || null, taskId } : { goalId: goalId || null, projectId })
      if (!result.ok) {
        setState((s) => (s ? { ...s, current: previous } : s))
        toast.error(result.error)
        return
      }
      const title = state?.options.find((o) => o.id === goalId)?.title
      toast.success(title ? `Counts towards “${title}”` : "No longer counts towards a goal")
    })
  }

  return (
    <div className="grid content-start gap-1">
      <label htmlFor={id} className={labelClassName}>
        Goal
      </label>
      <select
        id={id}
        value={state?.current ?? ""}
        onChange={(e) => change(e.target.value)}
        disabled={state === null || pending}
        className={cn(
          "text-body h-10 w-full rounded-lg border border-field-border bg-field px-2.5 outline-none focus-visible:border-accent-500 focus-visible:ring-3 focus-visible:ring-accent-500/20 md:h-9",
          selectClassName,
        )}
      >
        <option value="">{state === null ? "Loading…" : "None"}</option>
        {state?.options.map((o) => (
          <option key={o.id} value={o.id}>
            {years.size > 1 ? `${o.title} (${o.year})` : o.title}
          </option>
        ))}
      </select>
    </div>
  )
}
