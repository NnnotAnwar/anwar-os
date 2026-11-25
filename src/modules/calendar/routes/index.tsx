import { Suspense } from "react"
import { z } from "zod"
import { Page, Reveal, SkeletonExit } from "@/components/motion"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shell/page-header"
import { requireViewer } from "@/core/auth"
import { runModuleAction } from "@/core/module-actions"
import { actions } from "../actions"
import { CalendarApp } from "../components/calendar-app"
import { monthGrid, startOfWeek } from "../lib/days"
import { AGENDA_DAYS, views, type View } from "../lib/links"
import { addDays, formatIsoDate, parseIsoDate, startOfLocalDay, wallClock, type LocalDate } from "../lib/zoned"
import type { DayTask } from "../schema"

type TaskRow = { id: string; title: string; dueDate: string | null; dueTime: string | null; doneAt: string | null; priority: string }

/** Tasks due in the range, through the tasks module; none when it isn't available. */
async function tasksBetween(from: LocalDate, to: LocalDate): Promise<DayTask[]> {
  try {
    const rows = await runModuleAction<TaskRow[]>("tasks", "between", { from: formatIsoDate(from), to: formatIsoDate(to) })
    return rows.flatMap((t) =>
      t.dueDate
        ? [{ id: t.id, title: t.title, date: t.dueDate, time: t.dueTime, done: t.doneAt !== null, highPriority: t.priority === "high" }]
        : [],
    )
  } catch {
    return []
  }
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined)

/** The local dates a view shows, padded a day each side for zone edges. */
function rangeFor(view: View, anchor: LocalDate): [LocalDate, LocalDate] {
  if (view === "month") {
    const grid = monthGrid(anchor)
    return [addDays(grid[0]!, -1), addDays(grid[41]!, 2)]
  }
  if (view === "week") {
    const monday = startOfWeek(anchor)
    return [addDays(monday, -1), addDays(monday, 8)]
  }
  return [addDays(anchor, -1), addDays(anchor, AGENDA_DAYS + 1)]
}

export default function CalendarPage({ searchParams }: PageProps<"/app/calendar">) {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-6xl gap-4">
        <PageHeader eyebrow="Plan" title="Calendar" />
        <Suspense
          fallback={
            <SkeletonExit>
              <CalendarSkeleton />
            </SkeletonExit>
          }
        >
          <Reveal>
            <CalendarBody searchParams={searchParams} />
          </Reveal>
        </Suspense>
      </div>
    </Page>
  )
}

async function CalendarBody({ searchParams }: Pick<PageProps<"/app/calendar">, "searchParams">) {
  const params = await searchParams
  const viewer = await requireViewer()
  const now = new Date()
  const today = wallClock(now, viewer.timezone)
  const todayDate = { year: today.year, month: today.month, day: today.day }
  const view: View = views.includes(one(params.view) as View) ? (one(params.view) as View) : "month"
  const anchor = parseIsoDate(one(params.date)) ?? todayDate
  const eventParam = one(params.event)
  const openEventId = eventParam && z.uuid().safeParse(eventParam).success ? eventParam : null

  const [from, to] = rangeFor(view, anchor)
  const [occurrences, feed, tasks] = await Promise.all([
    actions.range.handler({ from: startOfLocalDay(from, viewer.timezone), to: startOfLocalDay(to, viewer.timezone) }),
    actions.getFeed.handler({}),
    tasksBetween(from, to),
  ])

  return (
    <CalendarApp
      view={view}
      anchor={formatIsoDate(anchor)}
      today={formatIsoDate(todayDate)}
      now={now.toISOString()}
      timezone={viewer.timezone}
      locale={viewer.locale}
      occurrences={occurrences}
      tasks={tasks}
      openEventId={openEventId}
      openNew={one(params.new) === "1"}
      feed={feed}
    />
  )
}

function CalendarSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="ml-auto h-9 w-48" />
      </div>
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-[28rem] w-full rounded-xl" />
    </div>
  )
}
