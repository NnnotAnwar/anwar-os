import { Suspense } from "react"
import { Page } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { calendarDate } from "@/lib/time"
import { getPublicCv } from "@/modules/cv/public"
import { actions as goalActions } from "@/modules/goals/actions"
import { actions } from "../actions"
import { NowSettingsForm } from "../components/now-settings-form"

/** /app/now: what the public /now page says and shows. */
export default function NowSettingsPage() {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-3xl gap-6">
        <PageHeader
          eyebrow="Public site"
          title="Now page"
          description="What visitors see on /now. It's built from your goals, projects and writing, so it stays current on its own."
        />
        <Suspense fallback={<FormSkeleton />}>
          <Loader />
        </Suspense>
      </div>
    </Page>
  )
}

async function Loader() {
  const viewer = await requireViewer()
  const year = calendarDate(new Date(), viewer.timezone).year
  const [settings, goals, cv] = await Promise.all([
    actions.get.handler({}),
    goalActions.list.handler({ year, status: ["active", "done"], limit: 50 }),
    getPublicCv().catch(() => null),
  ])
  return (
    <NowSettingsForm
      settings={settings}
      goals={goals.map((g) => ({ id: g.id, title: g.title, status: g.status, showOnNow: g.showOnNow }))}
      year={year}
      cvLocation={cv?.profile?.location ?? ""}
      timezone={viewer.timezone}
      locale={viewer.locale}
    />
  )
}

function FormSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  )
}
