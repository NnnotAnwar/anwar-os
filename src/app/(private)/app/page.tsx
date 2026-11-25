import { Suspense } from "react"
import { Page } from "@/components/motion"
import Link from "next/link"
import { ArrowUpRight } from "@/components/icons"
import { Skeleton } from "@/components/ui/skeleton"
import { YearRuler } from "@/components/year-ruler"
import { ServiceGrid } from "@/components/services/service-grid"
import { GetStarted } from "@/components/shell/get-started"
import { InstallHint } from "@/components/pwa/install-hint"
import { getSetup } from "@/core/onboarding"
import { requireViewer } from "@/core/auth"
import type { ViewerContext, WidgetDef } from "@/core/module"
import { getTodayLayout } from "@/core/preferences"
import { arrangeWidgets } from "@/core/today-layout"
import { todayWidgets } from "@/core/today-widgets"
import { EditToday } from "@/components/today/edit-today"
import { calendarDate } from "@/lib/time"
import { TodayGoals } from "@/modules/goals/components/today-goals"

export default function TodayPage() {
  return (
    <Page>
      <div className="grid w-full gap-3 md:gap-4">
        <Suspense fallback={<HeaderSkeleton />}>
          <TodayHeader />
        </Suspense>
        <InstallHint />
        <Suspense fallback={null}>
          <Setup />
        </Suspense>
        <section aria-labelledby="my-services" className="grid gap-2.5">
          <div className="flex items-center justify-between">
            <h2 id="my-services" className="text-eyebrow text-text-accent">
              My services
            </h2>
            <Link
              href="/app/services"
              className="text-caption -my-3 rounded py-3 text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              All services
            </Link>
          </div>
          <Suspense fallback={<Skeleton className="h-24 rounded-xl" />}>
            <ServiceGrid which="pinned" variant="tile" />
          </Suspense>
        </section>
        <Suspense fallback={<WidgetsSkeleton />}>
          <Widgets />
        </Suspense>
      </div>
    </Page>
  )
}

function greeting(hour: number) {
  if (hour < 5) return "Late night"
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

async function TodayHeader() {
  const viewer = await requireViewer()
  const now = new Date()
  const { timezone: timeZone, locale } = viewer
  const today = calendarDate(now, timeZone)
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now))
  const weekday = new Intl.DateTimeFormat(locale, { timeZone, weekday: "long" }).format(now)
  const date = new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "long" }).format(now)
  const city = timeZone.split("/").at(-1)?.replaceAll("_", " ")
  const name = viewer.displayName ?? viewer.email?.split("@")[0]

  return (
    <header className="glass grid gap-6 rounded-xl p-4 [--glass-shadow:var(--shadow-glass-lg)] md:p-6">
      <div className="grid gap-2">
        <p className="text-eyebrow text-text-accent">
          {weekday}
          {city && <> · {city}</>}
        </p>
        <h1 className="text-greeting">
          {greeting(hour)}
          {name && `, ${name}`}
        </h1>
        <p className="text-meta text-muted-foreground">{date}</p>
      </div>
      <YearRuler today={today} locale={locale} />
      <Suspense fallback={null}>
        <TodayGoals today={today} />
      </Suspense>
    </header>
  )
}

/**
 * Module widgets in the owner's order (Edit Today). Any widget a module's
 * manifest declares shows up here; src/core/today-layout.ts decides how a saved
 * layout meets new and removed widgets. Hidden widgets aren't loaded at all.
 */
async function Widgets() {
  const viewer = await requireViewer()
  const ctx = { timezone: viewer.timezone, locale: viewer.locale }
  const all = todayWidgets(viewer.role)
  if (all.length === 0) return null
  const byKey = new Map(all.map((w) => [w.key, w]))
  const defaultOrder = all.map((w) => w.key)
  const { ordered, visible, hidden } = arrangeWidgets(defaultOrder, await getTodayLayout())
  const editable = ordered.map((key) => {
    const w = byKey.get(key)!
    return { key, title: w.title, moduleName: w.moduleName, hidden: hidden.includes(key) }
  })

  return (
    <section aria-labelledby="widgets-heading" className="grid gap-2.5">
      <div className="flex items-center justify-between">
        <h2 id="widgets-heading" className="text-eyebrow text-text-accent">
          At a glance
        </h2>
        <EditToday items={editable} defaultOrder={defaultOrder} />
      </div>
      {visible.length === 0 ? (
        <p className="glass rounded-xl p-4 text-meta text-muted-foreground">
          Every widget is hidden. Edit Today to bring some back.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 md:gap-4">
          {visible.map((key) => {
            const w = byKey.get(key)!
            return (
              <section
                key={w.key}
                aria-labelledby={`${w.key}-title`}
                data-widget={w.key}
                // A widget with nothing to show renders `data-widget-empty` and its tile hides.
                className="glass grid content-start gap-3 rounded-xl p-4 has-[[data-widget-empty]]:hidden"
              >
                <header className="flex items-center justify-between gap-2">
                  <h2 id={`${w.key}-title`} className="text-card-title">
                    {w.title}
                  </h2>
                  <Link
                    href={w.href}
                    className="text-caption -my-3 flex items-center gap-0.5 rounded py-3 text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {w.moduleName}
                    <ArrowUpRight className="size-3" aria-hidden />
                  </Link>
                </header>
                <Suspense fallback={<RowsSkeleton />}>
                  <WidgetBody load={w.load} ctx={ctx} />
                </Suspense>
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}

async function WidgetBody({
  load,
  ctx,
}: {
  load: WidgetDef["load"]
  ctx: ViewerContext
}) {
  const Widget = await load()
  return <Widget ctx={ctx} />
}

function HeaderSkeleton() {
  return (
    <div className="grid gap-8" aria-hidden>
      <div className="grid gap-3">
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="h-12 w-64 md:h-16" />
        <Skeleton className="h-5 w-48" />
      </div>
      <Skeleton className="h-20 w-full" />
    </div>
  )
}

function RowsSkeleton() {
  return (
    <div className="grid gap-2.5" aria-hidden>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  )
}

function WidgetsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="grid gap-3 glass rounded-xl p-5">
          <Skeleton className="h-4 w-28" />
          <RowsSkeleton />
        </div>
      ))}
    </div>
  )
}

async function Setup() {
  const { steps, dismissed } = await getSetup()
  if (dismissed || steps.every((s) => s.done)) return null
  return <GetStarted steps={steps} />
}
