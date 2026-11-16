import { Suspense } from "react"
import { z } from "zod"
import { Page, Reveal, SkeletonExit } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { InboxApp, type InboxView } from "../components/inbox-app"

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined)

export default function InboxPage({ searchParams }: PageProps<"/app/inbox">) {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <PageHeader
          eyebrow="Capture"
          title="Inbox"
          description="Everything you jot down lands here. Sort it one at a time into a task, note, link, idea or event."
        />
        <Suspense
          fallback={
            <SkeletonExit>
              <InboxSkeleton />
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

async function Body({ searchParams }: Pick<PageProps<"/app/inbox">, "searchParams">) {
  const params = await searchParams
  const viewer = await requireViewer()
  const view: InboxView = one(params.view) === "processed" ? "processed" : "process"
  const item = one(params.item)
  const [items, processed] = await Promise.all([
    actions.list.handler({ processed: false, limit: 500 }),
    view === "processed" ? actions.list.handler({ processed: true, limit: 100 }) : Promise.resolve([]),
  ])
  return (
    <InboxApp
      view={view}
      items={items}
      processed={processed}
      now={new Date().toISOString()}
      locale={viewer.locale}
      focusItemId={item && z.uuid().safeParse(item).success ? item : null}
      autoCapture={one(params.capture) === "1"}
    />
  )
}

function InboxSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      <Skeleton className="h-10 w-56 rounded-xl" />
      <Skeleton className="h-14 rounded-xl" />
      <Skeleton className="h-36 rounded-xl" />
      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
