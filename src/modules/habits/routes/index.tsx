import { Suspense } from "react"
import { Page, Reveal, SkeletonExit } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { HabitsBoard } from "../components/habits-board"
import { formatDayLabel } from "../lib/format"

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined)

export default function HabitsPage({ searchParams }: PageProps<"/app/habits">) {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <PageHeader eyebrow="Grow" title="Habits" description="Small things on the days you choose. Tick them off here, on Today or in Telegram." />
        <Suspense
          fallback={
            <SkeletonExit>
              <HabitsSkeleton />
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

async function Body({ searchParams }: Pick<PageProps<"/app/habits">, "searchParams">) {
  const params = await searchParams
  const [viewer, data, settings] = await Promise.all([
    requireViewer(),
    actions.overview.handler({ includeArchived: true }),
    actions.settings.handler({}),
  ])
  return (
    <HabitsBoard
      data={data}
      settings={settings}
      todayLabel={formatDayLabel(data.today, viewer.locale)}
      openNew={one(params.new) === "1"}
      showArchived={one(params.archived) === "1"}
    />
  )
}

function HabitsSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      <Skeleton className="h-10 w-36 rounded-lg" />
      <div className="glass grid gap-px overflow-hidden rounded-xl">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <Skeleton className="size-6 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-2 w-full max-w-sm" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
