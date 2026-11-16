"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { removeWithUndo } from "@/lib/undo-toast"
import { dueLabel } from "../lib/format"
import type { Task } from "../schema"
import { completeTask, deleteTask, reopenTask, scheduleTask, updateTask } from "../server-actions"
import type { RowState } from "./task-row"
import type { TaskPatch } from "./task-editor"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Optimistic task changes shared by the tasks page and Today's widget. A
 * completed task shows its tick, then folds away, then the write happens and a
 * toast offers Undo. The server refresh that follows replaces local state.
 */
export function useTaskMutations({ today, locale }: { today: string; locale: string }) {
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({})
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [patches, setPatches] = useState<Record<string, Partial<Task>>>({})

  const setRow = (id: string, state: RowState | null) =>
    setRowStates((prev) => {
      const next = { ...prev }
      if (state) next[id] = state
      else delete next[id]
      return next
    })
  const hide = (id: string, value: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  const patch = (id: string, value: Partial<Task> | null) =>
    setPatches((prev) => {
      const next = { ...prev }
      if (value) next[id] = { ...prev[id], ...value }
      else delete next[id]
      return next
    })

  const apply = useCallback(
    (tasks: Task[]) => tasks.filter((t) => !hidden.has(t.id)).map((t) => (patches[t.id] ? { ...t, ...patches[t.id] } : t)),
    [hidden, patches],
  )
  const stateOf = (id: string): RowState => rowStates[id] ?? "idle"

  function reset(id: string) {
    hide(id, false)
    setRow(id, null)
    patch(id, null)
  }

  /** Complete an open task, or restore a done one; either way it leaves the current view. */
  async function toggle(task: Task) {
    if (rowStates[task.id]) return
    const reopening = task.doneAt !== null
    const quick = reducedMotion()
    if (reopening) patch(task.id, { doneAt: null })
    else setRow(task.id, "checked")
    await sleep(quick ? 0 : 420)
    setRow(task.id, "leaving")
    await sleep(quick ? 0 : 220)
    hide(task.id, true)

    if (reopening) {
      const result = await reopenTask({ id: task.id })
      if (!result.ok) {
        reset(task.id)
        toast.error(result.error)
        return
      }
      toast.success("Back on your list", {
        action: {
          label: "Undo",
          onClick: () => {
            reset(task.id)
            void completeTask({ id: task.id })
          },
        },
      })
      return
    }

    const result = await completeTask({ id: task.id })
    if (!result.ok) {
      reset(task.id)
      toast.error(result.error)
      return
    }
    const next = result.value.nextDue
    toast.success(next ? `Done · repeats ${dueLabel(next, today, locale).text.toLowerCase()}` : "Done", {
      action: {
        label: "Undo",
        onClick: () => {
          reset(task.id)
          void reopenTask({ id: task.id })
        },
      },
    })
  }

  async function save(task: Task, change: TaskPatch, message?: string) {
    const previous = Object.fromEntries(Object.keys(change).map((k) => [k, task[k as keyof Task]])) as TaskPatch
    patch(task.id, change)
    const result = await updateTask({ id: task.id, ...change })
    if (!result.ok) {
      patch(task.id, previous)
      toast.error(result.error)
      return
    }
    if (message) {
      toast.success(message, {
        action: { label: "Undo", onClick: () => void updateTask({ id: task.id, ...previous }).then(() => patch(task.id, previous)) },
      })
    }
  }

  async function schedule(task: Task, dueDate: string | null) {
    if (dueDate === task.dueDate) return
    const previous = { dueDate: task.dueDate, dueTime: task.dueTime, rrule: task.rrule }
    patch(task.id, dueDate ? { dueDate } : { dueDate: null, dueTime: null, rrule: null })
    const result = await scheduleTask({ id: task.id, dueDate })
    if (!result.ok) {
      patch(task.id, previous)
      toast.error(result.error)
      return
    }
    toast.success(dueDate ? `Scheduled for ${dueLabel(dueDate, today, locale).text.toLowerCase()}` : "Date removed", {
      action: {
        label: "Undo",
        onClick: () => {
          patch(task.id, previous)
          void updateTask({ id: task.id, ...previous })
        },
      },
    })
  }

  function remove(task: Task) {
    removeWithUndo({
      message: "Task deleted",
      hide: () => hide(task.id, true),
      restore: () => hide(task.id, false),
      commit: () => deleteTask({ id: task.id }),
    })
  }

  return { apply, stateOf, toggle, save, schedule, remove, isHidden: (id: string) => hidden.has(id) }
}

export type TaskMutations = ReturnType<typeof useTaskMutations>
