"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import { dueLabel } from "../lib/format"
import type { Task } from "../schema"
import { PriorityMark, TaskCheckbox } from "./task-checkbox"
import { useTaskMutations } from "./use-task-mutations"

/** The Today widget's rows: tick to complete right here, tap the title to open it. */
export function TodayTaskList({ tasks, total, today, locale }: { tasks: Task[]; total: number; today: string; locale: string }) {
  const m = useTaskMutations({ today, locale })
  const visible = m.apply(tasks)
  const more = total - tasks.length

  if (visible.length === 0) {
    return <p className="text-meta text-muted-foreground">All done for today.</p>
  }

  return (
    <div className="grid gap-1">
      <ul className="-mx-1 grid">
        {visible.map((task) => {
          const state = m.stateOf(task.id)
          const checked = state !== "idle"
          const overdue = task.dueDate !== null && task.dueDate < today
          return (
            <li
              key={task.id}
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                state === "leaving" ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
              )}
            >
              <div className="flex min-h-0 items-center gap-2.5 overflow-hidden rounded-lg px-1 py-1">
                <TaskCheckbox
                  checked={checked}
                  priority={task.priority}
                  onToggle={() => void m.toggle(task)}
                  label={`Complete “${task.title}”`}
                />
                <Link
                  href={`/app/tasks?task=${task.id}`}
                  className={cn(
                    "text-body flex min-w-0 flex-1 items-baseline gap-1.5 rounded outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
                    checked && "text-muted-foreground line-through",
                  )}
                >
                  <PriorityMark priority={task.priority} />
                  <span className="truncate">{task.title}</span>
                </Link>
                <span className={cn("text-caption shrink-0 tabular-nums", overdue ? "font-semibold text-warning-text" : "text-muted-foreground")}>
                  {overdue ? dueLabel(task.dueDate!, today, locale).text : task.dueTime}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
      {more > 0 && (
        <Link href="/app/tasks" className="text-caption px-1 text-text-accent underline-offset-4 hover:underline">
          {more} more for today
        </Link>
      )}
    </div>
  )
}
