import { Suspense } from "react"
import { z } from "zod"
import { Page, Reveal, SkeletonExit } from "@/components/motion"
import { PendingItems } from "@/components/offline/pending-items"
import { PageHeader } from "@/components/shell/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { TasksApp } from "../components/tasks-app"
import { taskViews, type TaskView } from "../schema"

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined)
const uuid = (v: string | undefined) => (v && z.uuid().safeParse(v).success ? v : null)

export default function TasksPage({ searchParams }: PageProps<"/app/tasks">) {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <PageHeader
          eyebrow="Do"
          title="Tasks"
          description="Type it the way you'd say it: “Call the bank tomorrow 10:00 !high #University”."
        />
        <PendingItems kinds={["task"]} />
        <Suspense
          fallback={
            <SkeletonExit>
              <TasksSkeleton />
            </SkeletonExit>
          }
        >
          <Reveal>
            <Body searchParams={searchParams} />
          </Reveal>
        </Suspense>
      </div>
    </Page>
  )
}

async function Body({ searchParams }: Pick<PageProps<"/app/tasks">, "searchParams">) {
  const params = await searchParams
  const viewer = await requireViewer()
  const view: TaskView = taskViews.includes(one(params.view) as TaskView) ? (one(params.view) as TaskView) : "today"
  const data = await actions.view.handler({ view, listId: view === "lists" ? uuid(one(params.list)) : null })
  return (
    <TasksApp
      data={data}
      locale={viewer.locale}
      timezone={viewer.timezone}
      openTaskId={uuid(one(params.task))}
      openNew={one(params.new) === "1"}
    />
  )
}

function TasksSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      <Skeleton className="h-10 w-80 max-w-full rounded-xl" />
      <Skeleton className="h-14 rounded-xl" />
      <div className="glass grid gap-px overflow-hidden rounded-xl">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-3.5">
            <Skeleton className="size-5 rounded-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  )
}
