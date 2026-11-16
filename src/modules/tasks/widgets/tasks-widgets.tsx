import Link from "next/link"
import type { ViewerContext } from "@/core/module"
import { actions } from "../actions"
import { TodayTaskList } from "../components/today-task-list"

const LIMIT = 6

/** Today: overdue and due-today tasks, completable in place. */
export async function TodaysTasks({ ctx }: { ctx: ViewerContext }) {
  const { tasks, total, today } = await actions.dueToday.handler({ limit: LIMIT })
  if (tasks.length === 0) {
    return (
      <p className="text-meta text-muted-foreground">
        Nothing due today.{" "}
        <Link href="/app/tasks?new=1" className="text-text-accent underline-offset-4 hover:underline">
          Add a task
        </Link>
      </p>
    )
  }
  return <TodayTaskList tasks={tasks} total={total} today={today} locale={ctx.locale} />
}
