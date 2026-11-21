import { Suspense } from "react"
import NextLink from "next/link"
import { notFound } from "next/navigation"
import { Pulse } from "@/components/icons"
import { NAV_TAB, Page, Reveal, SkeletonExit } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions as opsActions } from "@/modules/ops/actions"
import { serviceStatus, statusLabels, uptimeLabel } from "@/modules/ops/lib/status"
import { actions } from "../actions"
import { BotsApp, type ServiceState } from "../components/bots-app"

export default function BotsPage() {
  return (
    <Page>
      <div className="grid w-full gap-6">
        <PageHeader
          eyebrow="Control panel"
          title="Bots"
          description="Your Telegram bots: who uses them, how much, and whether they are alive."
          actions={
            <NextLink
              href="/app/ops"
              transitionTypes={NAV_TAB}
              className="text-meta inline-flex min-h-11 items-center gap-1.5 rounded text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0"
            >
              <Pulse className="size-4" />
              Ops
            </NextLink>
          }
        />
        <Suspense
          fallback={
            <SkeletonExit>
              <div className="grid gap-3 lg:grid-cols-2" aria-hidden>
                <Skeleton className="h-64 rounded-xl" />
                <Skeleton className="h-64 rounded-xl" />
              </div>
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
  const [bots, ops] = await Promise.all([actions.overview.handler({}), opsActions.services.handler({ stats: false })])
  const now = new Date()

  let services: Record<string, ServiceState> | null = null
  if (ops.connected) {
    services = {}
    for (const s of ops.services) {
      const status = serviceStatus(s)
      const uptime = uptimeLabel(s, now)
      services[s.name] = {
        label: `· ${statusLabels[status].toLowerCase()}${uptime ? ` · ${uptime}` : ""}`,
        tone: status === "ok" ? "ok" : status === "down" ? "down" : status === "stopped" ? "off" : "warn",
      }
    }
  }

  return <BotsApp bots={bots} services={services} locale={viewer.locale} renderedAt={now.toISOString()} />
}
