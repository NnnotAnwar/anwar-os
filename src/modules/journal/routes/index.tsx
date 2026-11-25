import { Suspense } from "react"
import NextLink from "next/link"
import { ChevronLeft, ChevronRight, Search } from "@/components/icons"
import { Page, Reveal, SkeletonExit } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { actions, viewerToday } from "../actions"
import { DaySheet } from "../components/day-sheet"
import { EntryEditor } from "../components/entry-editor"
import { EntryList } from "../components/entry-list"
import { MoodHeatmap } from "../components/mood-heatmap"
import { PromptSettings } from "../components/prompt-settings"
import { heatMap } from "../lib/days"
import { formatDayLong, formatDayShort } from "../lib/format"
import { moodOf } from "../schema"

const PAGE = 30
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined)
const isDay = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))

export default function JournalPage({ searchParams }: PageProps<"/app/journal">) {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <PageHeader eyebrow="Reflect" title="Journal" description="One line a day and how it felt. Write it here, on Today, or when osbot asks in the evening." />
        <Suspense
          fallback={
            <SkeletonExit>
              <JournalSkeleton />
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

/** /app/journal with the given params; empty ones dropped. */
function href(params: Record<string, string | undefined>, hash = "") {
  const query = new URLSearchParams(Object.entries(params).filter((p): p is [string, string] => !!p[1])).toString()
  return `/app/journal${query ? `?${query}` : ""}${hash}`
}

async function Body({ searchParams }: Pick<PageProps<"/app/journal">, "searchParams">) {
  const params = await searchParams
  const today = await viewerToday()
  const thisYear = Number(today.slice(0, 4))
  const day = isDay(one(params.day)) ? one(params.day)! : undefined
  const yearParam = Number(one(params.year))
  const year = Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= thisYear ? yearParam : day ? Number(day.slice(0, 4)) : thisYear
  const q = one(params.q)?.trim().slice(0, 100) || undefined
  const before = isDay(one(params.before)) ? one(params.before) : undefined

  const [todayEntry, yearData, entries, settings, dayEntry] = await Promise.all([
    actions.get.handler({ day: today }),
    actions.year.handler({ year }),
    actions.list.handler({ query: q, before, limit: PAGE }),
    actions.settings.handler({}),
    day ? actions.get.handler({ day }) : null,
  ])

  const keep = { year: year === thisYear ? undefined : String(year), q, before }
  const dayHref = href({ ...keep, day: "__DAY__" })
  const rated = yearData.days.filter((d) => d.mood !== null)
  const average = rated.length ? Math.round((rated.reduce((s, d) => s + d.mood!, 0) / rated.length) * 10) / 10 : null
  const averageFace = moodOf(average === null ? null : Math.round(average))

  return (
    <div className="grid gap-4">
      <section className="glass grid gap-3 rounded-xl p-4 [--glass-shadow:var(--shadow-glass-lg)] md:p-5" aria-labelledby="today-heading">
        <div className="grid gap-0.5">
          <h2 id="today-heading" className="text-card-title">
            How was today?
          </h2>
          <p className="text-meta text-muted-foreground">{formatDayLong(today)}</p>
        </div>
        <EntryEditor key={today} day={today} entry={todayEntry} dayLabel="today" />
      </section>

      <section className="glass grid gap-3 rounded-xl p-4 md:p-5" aria-labelledby="year-heading">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <YearSwitcher year={year} thisYear={thisYear} keep={{ q }} />
          <p className="text-meta text-muted-foreground tabular-nums" id="year-heading">
            {yearData.days.length === 0
              ? `Nothing written in ${year}`
              : `${yearData.days.length} ${yearData.days.length === 1 ? "day" : "days"} written${average !== null ? ` · average ${averageFace?.emoji ?? ""} ${average.toFixed(1)}` : ""}`}
          </p>
        </div>
        <MoodHeatmap map={heatMap(year, yearData.days, today)} today={today} selected={day ?? null} dayHref={dayHref} />
      </section>

      <section id="entries" className="glass grid scroll-mt-20 gap-3 rounded-xl p-4 md:p-5" aria-labelledby="entries-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="entries-heading" className="text-card-title">
            Entries
          </h2>
          <form action="/app/journal" role="search" className="flex w-full items-center gap-2 sm:w-auto">
            {keep.year && <input type="hidden" name="year" value={keep.year} />}
            <label className="relative w-full sm:w-64">
              <span className="sr-only">Search the journal</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" name="q" defaultValue={q} placeholder="Search lines" className="h-11 pl-9 md:h-9" enterKeyHint="search" />
            </label>
          </form>
        </div>
        {q && (
          <p className="text-meta text-muted-foreground">
            {entries.length ? `Lines with “${q}”` : `No lines with “${q}”.`}{" "}
            <NextLink href={href({ year: keep.year }, "#entries")} className="text-text-accent underline-offset-4 hover:underline">
              Show all
            </NextLink>
          </p>
        )}
        {!q && entries.length === 0 && !before && (
          <p className="text-meta text-muted-foreground">Nothing written yet. Start with today above; past days open from the year.</p>
        )}
        <EntryList entries={entries} year={thisYear} dayHref={dayHref} />
        {(entries.length === PAGE || before) && (
          <div className="flex gap-4">
            {before && (
              <NextLink href={href({ year: keep.year, q }, "#entries")} className="text-meta text-text-accent underline-offset-4 hover:underline">
                Newest
              </NextLink>
            )}
            {entries.length === PAGE && (
              <NextLink
                href={href({ year: keep.year, q, before: entries.at(-1)!.day }, "#entries")}
                className="text-meta text-text-accent underline-offset-4 hover:underline"
              >
                Older entries
              </NextLink>
            )}
          </div>
        )}
      </section>

      <PromptSettings settings={settings} />

      {day && (
        <DaySheet
          key={day}
          day={day}
          label={formatDayShort(day, thisYear)}
          entry={dayEntry}
          future={day > today}
          closeHref={href(keep)}
        />
      )}
    </div>
  )
}

function YearSwitcher({ year, thisYear, keep }: { year: number; thisYear: number; keep: { q?: string } }) {
  const arrow =
    "flex size-11 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-track hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:size-9 [&_svg]:size-4"
  const to = (y: number) => href({ year: y === thisYear ? undefined : String(y), q: keep.q })
  return (
    <nav aria-label="Year" className="-ml-2 flex items-center">
      <NextLink href={to(year - 1)} scroll={false} className={arrow} aria-label={`${year - 1}`}>
        <ChevronLeft />
      </NextLink>
      <p className="text-heading min-w-14 text-center tabular-nums" aria-live="polite">
        {year}
      </p>
      {year < thisYear ? (
        <NextLink href={to(year + 1)} scroll={false} className={arrow} aria-label={`${year + 1}`}>
          <ChevronRight />
        </NextLink>
      ) : (
        <span className={cn(arrow, "opacity-30")} aria-hidden>
          <ChevronRight />
        </span>
      )}
    </nav>
  )
}

function JournalSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <div className="glass grid gap-3 rounded-xl p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-11 w-64" />
        <Skeleton className="h-9 w-full" />
      </div>
      <div className="glass grid gap-3 rounded-xl p-5">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-28 w-full" />
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  )
}
