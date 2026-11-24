import { Suspense } from "react"
import NextLink from "next/link"
import { ChartBar, ExternalLink } from "@/components/icons"
import { EmptyState } from "@/components/list/shortcut-hint"
import { Page, Reveal, SkeletonExit } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { actions } from "../actions"
import { DailyBars, formatDay, RankedList } from "../components/charts"
import { change, deviceLabels, pageLabel, parseRange, RANGES, type RangeDays, type SiteStats } from "../schema"

export default function AnalyticsPage({ searchParams }: PageProps<"/app/analytics">) {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-5xl gap-4">
        <PageHeader
          eyebrow="Your site"
          title="Analytics"
          description="Page views of the public site, counted on this server without cookies or personal data. Visitors with Do Not Track are skipped, and so are you while signed in."
          actions={
            <NextLink
              href="/"
              target="_blank"
              className="text-meta inline-flex items-center gap-1 rounded text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Public site
              <ExternalLink className="size-3.5" />
            </NextLink>
          }
        />
        <Suspense
          fallback={
            <SkeletonExit>
              <DashboardSkeleton />
            </SkeletonExit>
          }
        >
          <Reveal>
            <Dashboard searchParams={searchParams} />
          </Reveal>
        </Suspense>
      </div>
    </Page>
  )
}

function RangePicker({ days }: { days: RangeDays }) {
  return (
    <nav aria-label="Period" className="segmented self-start">
      {RANGES.map((d) => (
        <NextLink
          key={d}
          href={`/app/analytics?range=${d}`}
          aria-current={days === d ? "page" : undefined}
          scroll={false}
          className={cn(
            "text-small flex min-h-9 items-center rounded-lg px-3 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-11",
            days === d && "segment-active text-foreground",
          )}
        >
          {d} days
        </NextLink>
      ))}
    </nav>
  )
}

async function Dashboard({ searchParams }: Pick<PageProps<"/app/analytics">, "searchParams">) {
  const days = parseRange((await searchParams).range)
  const stats = await actions.stats.handler({ days })

  return (
    <div className="grid gap-4">
      <RangePicker days={days} />
      {stats.total === 0 && stats.previousTotal === 0 ? (
        <EmptyState icon={ChartBar} title={`No views in the last ${days} days`}>
          Views of your public pages appear here a moment after someone opens them. Your own visits while signed in
          aren&apos;t counted.
        </EmptyState>
      ) : (
        <Overview stats={stats} />
      )}
    </div>
  )
}

function Overview({ stats }: { stats: SiteStats }) {
  const delta = change(stats.total, stats.previousTotal)
  const busiest = stats.daily.reduce((best, d) => (d.views > best.views ? d : best), stats.daily[0]!)
  const perDay = stats.total / stats.days
  const deviceTotal = stats.devices.reduce((sum, d) => sum + d.views, 0)

  return (
    <>
      <section className="glass grid gap-4 rounded-xl p-4 [--glass-shadow:var(--shadow-glass-lg)] md:p-6" aria-labelledby="views-heading">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div className="grid gap-0.5">
            <h2 id="views-heading" className="text-eyebrow text-text-accent">
              Views, last {stats.days} days
            </h2>
            <p className="flex items-baseline gap-2">
              <span className="text-metric tabular-nums">{stats.total.toLocaleString("en")}</span>
              {delta !== null && (
                <span className={cn("text-meta tabular-nums", delta >= 0 ? "text-text-accent" : "text-muted-foreground")}>
                  {delta > 0 ? "+" : ""}
                  {delta}% vs the {stats.days} days before
                </span>
              )}
            </p>
          </div>
          <Stat
            label="Per day"
            value={perDay === 0 ? "0" : perDay < 0.1 ? "<0.1" : perDay < 10 ? perDay.toFixed(1) : Math.round(perDay).toLocaleString("en")}
          />
          {busiest && busiest.views > 0 && (
            <Stat
              label="Busiest day"
              value={`${formatDay(busiest.day)} · ${busiest.views.toLocaleString("en")} ${busiest.views === 1 ? "view" : "views"}`}
            />
          )}
        </div>
        <DailyBars daily={stats.daily} />
      </section>

      <div className="grid items-start gap-4 md:grid-cols-2">
        <Card title="Top pages">
          <RankedList
            rows={stats.pages.map((p) => ({ key: p.key, label: pageLabel(p.key), views: p.views, href: p.key }))}
            empty="No pages viewed in this period."
          />
        </Card>
        <Card title="Where visitors came from" hint={`${stats.direct.toLocaleString("en")} direct or unknown`}>
          <RankedList
            rows={stats.referrers.map((r) => ({ key: r.key, label: r.key, views: r.views }))}
            empty="No other sites linked here yet; every visit was direct."
          />
        </Card>
        <Card title="Devices">
          <ul className="grid gap-2">
            {stats.devices.map((d) => {
              const share = deviceTotal ? Math.round((d.views / deviceTotal) * 100) : 0
              return (
                <li key={d.device} className="grid gap-1">
                  <div className="text-body flex justify-between">
                    <span>{deviceLabels[d.device]}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {share}% · {d.views.toLocaleString("en")}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-track" aria-hidden>
                    <div className="h-full rounded-full bg-accent-500/80" style={{ width: `${share}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
        {stats.countries.length > 0 && (
          <Card title="Countries">
            <RankedList
              rows={stats.countries.map((c) => ({ key: c.key, label: countryName(c.key), views: c.views }))}
              empty=""
            />
          </Card>
        )}
      </div>
      <p className="text-caption text-muted-foreground">
        Days are in UTC. Stored per day: page, referring site, device class and country (when the server knows it) — never
        an IP address, a browser string or a cookie.
      </p>
    </>
  )
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" })
function countryName(code: string) {
  try {
    return regionNames.of(code) ?? code
  } catch {
    return code
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className="text-body-strong tabular-nums">{value}</p>
    </div>
  )
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="glass grid gap-3 rounded-xl p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-card-title">{title}</h2>
        {hint && <p className="text-caption text-muted-foreground tabular-nums">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <Skeleton className="h-9 w-56" />
      <div className="glass grid gap-4 rounded-xl p-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  )
}
