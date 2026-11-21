import { Suspense } from "react"
import NextLink from "next/link"
import { notFound } from "next/navigation"
import { Robot } from "@/components/icons"
import { NAV_TAB, Page, Reveal, SkeletonExit } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { ActivityList } from "../components/activity-list"
import { NotConnected } from "../components/not-connected"
import { OpsPanel } from "../components/ops-panel"

export default function OpsPage() {
  return (
    <Page>
      <div className="grid w-full gap-6">
        <PageHeader
          eyebrow="Control panel"
          title="Ops"
          description="Every service on the server: health, logs, restarts and deploys. Protected ones (web, database, proxy, agent) can only be restarted."
          actions={
            <NextLink
              href="/app/bots"
              transitionTypes={NAV_TAB}
              className="text-meta inline-flex min-h-11 items-center gap-1.5 rounded text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0"
            >
              <Robot className="size-4" />
              Bots
            </NextLink>
          }
        />
        <Suspense
          fallback={
            <SkeletonExit>
              <PanelSkeleton />
            </SkeletonExit>
          }
        >
          <Reveal>
            <Body />
          </Reveal>
        </Suspense>
      </div>
    </Page>
  )
}

async function Body() {
  const viewer = await requireViewer()
  if (viewer.role !== "owner") notFound()
  const [res, events] = await Promise.all([actions.services.handler({ stats: true }), actions.events.handler({ limit: 30 })])
  const now = new Date()

  return (
    <div className="grid gap-6">
      <section aria-labelledby="services-title" className="grid gap-3">
        {res.connected ? (
          <OpsPanel initial={res.services} />
        ) : (
          <>
            <h2 id="services-title" className="text-eyebrow text-muted-foreground">
              Services
            </h2>
            <NotConnected offline={res} />
          </>
        )}
      </section>

      <section aria-labelledby="activity-title" id="activity" className="grid scroll-mt-24 gap-3">
        <h2 id="activity-title" className="text-eyebrow text-muted-foreground">
          Activity
        </h2>
        <ActivityList events={events} now={now} locale={viewer.locale} />
      </section>
    </div>
  )
}

function PanelSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      <Skeleton className="h-4 w-24" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-48 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
