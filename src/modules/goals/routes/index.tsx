import { Suspense } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight } from "@/components/icons"
import { NAV_TAB, Page, Reveal, SkeletonExit } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { calendarDate } from "@/lib/time"
import { cn } from "@/lib/utils"
import { actions } from "../actions"
import { GoalsList, QuickAddGoal } from "../components/goals-list"
import { yearElapsed } from "../lib/progress"
import { goalStatuses, goalStatusLabels, type GoalStatus } from "../schema"

export default function GoalsPage({ searchParams }: PageProps<"/app/goals">) {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-4xl gap-4">
        <Suspense
          fallback={
            <SkeletonExit>
              <GoalsSkeleton />
            </SkeletonExit>
          }
        >
          <Reveal>
            <Goals searchParams={searchParams} />
          </Reveal>
        </Suspense>
      </div>
    </Page>
  )
}

function parseYear(value: unknown, fallback: number) {
  const n = typeof value === "string" ? Number(value) : NaN
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : fallback
}

function parseStatus(value: unknown): GoalStatus | null {
  return typeof value === "string" && (goalStatuses as readonly string[]).includes(value) ? (value as GoalStatus) : null
}

function href(year: number, current: number, status: GoalStatus | null) {
  const p = new URLSearchParams()
  if (year !== current) p.set("year", String(year))
  if (status) p.set("status", status)
  const qs = p.toString()
  return (qs ? `/app/goals?${qs}` : "/app/goals") as `/app/goals${string}`
}

async function Goals({ searchParams }: Pick<PageProps<"/app/goals">, "searchParams">) {
  const [viewer, params] = await Promise.all([requireViewer(), searchParams])
  const today = calendarDate(new Date(), viewer.timezone)
  const year = parseYear(params.year, today.year)
  const status = parseStatus(params.status)
  const [goals, years] = await Promise.all([
    actions.list.handler({ year, status: status ? [status] : undefined, limit: 100 }),
    actions.years.handler({}),
  ])
  const total = years.find((y) => y.year === year)?.count ?? 0
  const elapsed = year === today.year ? yearElapsed(today) : null
  const known = new Set([...years.map((y) => y.year), today.year])
  const firstYear = Math.min(...known)
  const lastYear = Math.max(...known, today.year + 1)

  const description =
    year === today.year
      ? "Three to five goals for the year. Give one a number to count, or link tasks and projects and it fills as they get done."
      : year > today.year
        ? "Plan ahead: goals for next year, ready when it starts."
        : `How ${year} went.`

  return (
    <div className="grid gap-4">
      <PageHeader
        eyebrow="This year, on purpose"
        title="Goals"
        meta={total > 0 ? `${total} in ${year}` : undefined}
        description={description}
      />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <nav aria-label="Year" className="flex items-center gap-1">
          <YearLink year={year - 1} disabled={year - 1 < Math.min(firstYear, today.year - 1)} current={today.year} status={status} label="Previous year">
            <ChevronLeft />
          </YearLink>
          <span className="text-heading min-w-16 text-center font-display tabular-nums" aria-current="page">
            {year}
          </span>
          <YearLink year={year + 1} disabled={year + 1 > lastYear} current={today.year} status={status} label="Next year">
            <ChevronRight />
          </YearLink>
          {year !== today.year && (
            <Link
              href={href(today.year, today.year, status)}
              transitionTypes={NAV_TAB}
              className="text-caption ml-1 rounded px-2 py-3 text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Back to {today.year}
            </Link>
          )}
        </nav>
        {total > 0 && (
          <div className="segmented max-sm:w-full sm:ml-auto" role="group" aria-label="Show">
            {([null, ...goalStatuses] as const).map((s) => (
              <Link
                key={s ?? "all"}
                href={href(year, today.year, s)}
                aria-current={status === s ? "page" : undefined}
                className={cn(
                  "text-small flex h-9 items-center justify-center rounded-lg px-2.5 text-muted-foreground max-sm:flex-1 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8",
                  status === s && "segment-active text-foreground",
                )}
              >
                {s ? goalStatusLabels[s] : "All"}
              </Link>
            ))}
          </div>
        )}
      </div>

      {year >= today.year && status !== "done" && status !== "dropped" && <QuickAddGoal year={year} />}

      {goals.length > 0 ? (
        <GoalsList key={`${year}-${status ?? "all"}`} goals={goals} elapsed={elapsed} locale={viewer.locale} />
      ) : (
        <Empty year={year} thisYear={today.year} filtered={status !== null && total > 0} />
      )}
    </div>
  )
}

function YearLink({
  year,
  current,
  status,
  disabled,
  label,
  children,
}: {
  year: number
  current: number
  status: GoalStatus | null
  disabled: boolean
  label: string
  children: React.ReactNode
}) {
  const className =
    "flex size-11 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-track hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:size-9 [&_svg]:size-4"
  if (disabled) {
    return (
      <span aria-disabled className={cn(className, "pointer-events-none opacity-40")} aria-label={label}>
        {children}
      </span>
    )
  }
  return (
    <Link href={href(year, current, status)} transitionTypes={NAV_TAB} aria-label={`${label}, ${year}`} className={className}>
      {children}
    </Link>
  )
}

function Empty({ year, thisYear, filtered }: { year: number; thisYear: number; filtered: boolean }) {
  return (
    <section className="glass grid justify-items-start gap-2 rounded-xl p-6">
      <h2 className="text-card-title">{filtered ? "Nothing here" : `No goals for ${year}`}</h2>
      <p className="text-meta max-w-prose text-muted-foreground">
        {filtered
          ? "No goals with this status yet."
          : year < thisYear
            ? "This year had no goals written down."
            : "Add one above. Good goals are few and concrete: “Read 20 books”, “Ship Shiftella 2.0”, “Run a half marathon”."}
      </p>
    </section>
  )
}

function GoalsSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <Skeleton className="h-16 w-64" />
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-16 rounded-xl" />
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    </div>
  )
}
