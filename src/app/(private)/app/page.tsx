import { Suspense } from "react"
import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { YearRuler } from "@/components/year-ruler"
import { requireViewer } from "@/core/auth"
import { modulesFor, type ViewerContext, type WidgetDef } from "@/core/module"
import { calendarDate } from "@/lib/time"
import { modules } from "@/modules/_registry"

export default function TodayPage() {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-12">
      <Suspense fallback={<HeaderSkeleton />}>
        <TodayHeader />
      </Suspense>
      <Suspense fallback={<WidgetsSkeleton />}>
        <Widgets />
      </Suspense>
    </div>
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
    <header className="grid gap-8">
      <div className="grid gap-3">
        <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
          {weekday}
          {city && <> · {city}</>}
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-tight md:text-6xl">{date}</h1>
        <p className="text-lg text-muted-foreground">
          {greeting(hour)}
          {name && `, ${name}`}.
        </p>
      </div>
      <YearRuler today={today} locale={locale} />
    </header>
  )
}

async function Widgets() {
  const viewer = await requireViewer()
  const ctx = { timezone: viewer.timezone, locale: viewer.locale }
  const widgets = modulesFor(modules, viewer.role).flatMap((m) =>
    (m.widgets ?? []).map((w) => ({ ...w, key: `${m.id}:${w.id}`, href: m.nav[0].href, moduleName: m.name })),
  )

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {widgets.map((w) => (
        <section key={w.key} aria-labelledby={`${w.key}-title`} className="grid content-start gap-3 rounded-xl border bg-card p-5">
          <header className="flex items-center justify-between gap-2">
            <h2 id={`${w.key}-title`} className="text-sm font-medium">
              {w.title}
            </h2>
            <Link
              href={w.href}
              className="flex items-center gap-0.5 rounded font-mono text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {w.moduleName}
              <ArrowUpRight className="size-3" aria-hidden />
            </Link>
          </header>
          <Suspense fallback={<RowsSkeleton />}>
            <WidgetBody load={w.load} ctx={ctx} />
          </Suspense>
        </section>
      ))}
    </div>
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
        <div key={i} className="grid gap-3 rounded-xl border bg-card p-5">
          <Skeleton className="h-4 w-28" />
          <RowsSkeleton />
        </div>
      ))}
    </div>
  )
}
