"use client"

import Link from "next/link"
import { Check } from "@/components/icons"
import { cn } from "@/lib/utils"
import type { DayTask } from "../schema"

/** Where a task opens: its details in Tasks. */
export const taskHref = (id: string) => `/app/tasks?task=${id}`

/** A task's mark next to the events' category dots: a ring, ticked once done. */
export function TaskMark({ done, className }: { done: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-3 shrink-0 items-center justify-center rounded-full border-[1.5px] border-accent-500",
        done && "bg-accent-500 text-white",
        className,
      )}
    >
      {done && <Check className="size-2" />}
    </span>
  )
}

/** Tasks first by time ("any time" ones lead, like all-day events), done ones last. */
export function sortDayTasks(tasks: DayTask[]) {
  return [...tasks].sort(
    (a, b) => Number(a.done) - Number(b.done) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title),
  )
}

/** One agenda / day-panel row for a task, laid out like an event row; opens it in Tasks. */
export function DayTaskRow({ task }: { task: DayTask }) {
  return (
    <Link
      href={taskHref(task.id)}
      className={cn(
        "group flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-white/40 focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:bg-white/5",
        task.done && "opacity-60",
      )}
    >
      <span className="text-small w-[5.75rem] shrink-0 pt-px text-muted-foreground tabular-nums">{task.time ?? "Any time"}</span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-body flex min-w-0 items-center gap-1.5">
          <TaskMark done={task.done} />
          <span className={cn("truncate", task.done && "line-through decoration-muted-foreground/60")}>{task.title}</span>
        </span>
        <span className="text-caption text-muted-foreground">
          {task.done ? "Task · done" : task.highPriority ? "Task · high priority" : "Task"}
        </span>
      </span>
    </Link>
  )
}
