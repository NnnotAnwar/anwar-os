import { Suspense, type ReactNode } from "react"
import NextLink from "next/link"
import { CalendarCheck, ChevronLeft, ChevronRight, FilePdf } from "@/components/icons"
import { EmptyState } from "@/components/list/shortcut-hint"
import { Page, Reveal, SkeletonExit } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { formatMonth, isMonth, monthOf, shiftMonth, todayIn } from "@/modules/budget/lib/dates"
import { formatMoney } from "@/modules/budget/lib/money"
import { cn } from "@/lib/utils"
import { formatDayShort } from "@/modules/journal/lib/format"
import { moodOf } from "@/modules/journal/schema"
import { actions } from "../actions"
import { SavePdfButton } from "../components/save-pdf-button"
import { percentChange } from "../lib/compare"
import type { MonthlyReport } from "../schema"

export default function ReviewPage({ searchParams }: PageProps<"/app/review">) {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-5xl gap-4">
        <Suspense
          fallback={
            <SkeletonExit>
              <ReportSkeleton />
            </SkeletonExit>
          }
        >
          <Reveal>
            <Report searchParams={searchParams} />
          </Reveal>
        </Suspense>
      </div>
    </Page>
  )
}

async function Report({ searchParams }: Pick<PageProps<"/app/review">, "searchParams">) {
  const viewer = await requireViewer()
  const current = monthOf(todayIn(viewer.timezone))
  const param = (await searchParams).month
  const month = typeof param === "string" && isMonth(param) ? param : current
  const report = await actions.monthly.handler({ month })
  const empty =
    (!report.spending || (report.spending.expenseMinor === 0 && report.spending.incomeMinor === 0 && report.spending.previousExpenseMinor === 0)) &&
    (!report.tasks || (report.tasks.done === 0 && report.tasks.added === 0)) &&
    Object.values(report.captured).every((v) => !v) &&
    (!report.site || (report.site.views === 0 && report.site.previousViews === 0)) &&
    !report.journal

  return (
    <div className="grid gap-4">
      <PageHeader
        eyebrow="Review"
        title="Monthly report"
        description={
          report.partial
            ? `${report.label} so far, against ${report.previousLabel}. The full report arrives in Telegram on the 1st.`
            : `${report.label} against ${report.previousLabel}.`
        }
        actions={
          <>
            <a
              href={`/app/review/pdf?month=${report.month}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-11 [&_svg]:size-4"
            >
              <FilePdf />
              PDF
            </a>
            <SavePdfButton month={report.month} />
          </>
        }
      />
      <MonthSwitcher month={report.month} current={current} />
      {empty ? (
        <EmptyState icon={CalendarCheck} title={`Nothing recorded in ${report.label}`}>
          Spending, finished tasks, notes and site views show up here as the month fills in.
        </EmptyState>
      ) : (
        <Sections report={report} />
      )}
    </div>
  )
}

function MonthSwitcher({ month, current }: { month: string; current: string }) {
  const href = (m: string) => (m === current ? "/app/review" : `/app/review?month=${m}`)
  const arrow =
    "flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-track hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:size-11 [&_svg]:size-4"
  const next = shiftMonth(month, 1)
  return (
    <nav aria-label="Month" className="flex items-center gap-1">
      <NextLink href={href(shiftMonth(month, -1))} scroll={false} className={arrow} aria-label="Previous month">
        <ChevronLeft />
      </NextLink>
      <p className="text-heading min-w-36 text-center tabular-nums" aria-live="polite">
        {formatMonth(month)}
      </p>
      {next <= current ? (
        <NextLink href={href(next)} scroll={false} className={arrow} aria-label="Next month">
          <ChevronRight />
        </NextLink>
      ) : (
        <span className={cn(arrow, "opacity-30")} aria-hidden>
          <ChevronRight />
        </span>
      )}
      {month !== current && (
        <NextLink
          href="/app/review"
          scroll={false}
          className="text-caption ml-1 flex min-h-9 items-center rounded px-1 text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-11"
        >
          This month
        </NextLink>
      )}
    </nav>
  )
}

function Change({ current, previous, invert = false }: { current: number; previous: number; invert?: boolean }) {
  const pct = percentChange(current, previous)
  if (pct === null) return null
  // For spending, up is not good news: muted when it grew.
  const good = invert ? pct <= 0 : pct >= 0
  return (
    <span className={cn("text-meta tabular-nums", good ? "text-text-accent" : "text-muted-foreground")}>
      {pct > 0 ? "+" : ""}
      {pct}%
    </span>
  )
}

function Sections({ report }: { report: MonthlyReport }) {
  const prev = report.previousLabel.split(" ")[0]!
  const s = report.spending
  return (
    <>
      {s && (
        <section
          className="glass grid gap-4 rounded-xl p-4 [--glass-shadow:var(--shadow-glass-lg)] md:p-6"
          aria-labelledby="money-heading"
        >
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div className="grid gap-0.5">
              <h2 id="money-heading" className="text-eyebrow text-text-accent">
                Spent {report.partial ? "so far" : `in ${report.label.split(" ")[0]}`}
              </h2>
              <p className="flex items-baseline gap-2">
                <span className="text-metric tabular-nums">{formatMoney(s.expenseMinor, s.currency)}</span>
                <Change current={s.expenseMinor} previous={s.previousExpenseMinor} invert />
              </p>
              <p className="text-caption text-muted-foreground tabular-nums">
                {prev}: {formatMoney(s.previousExpenseMinor, s.currency)}
              </p>
            </div>
            <Stat label="Income" value={formatMoney(s.incomeMinor, s.currency)} />
            <Stat label="Net" value={formatMoney(s.netMinor, s.currency, "en", { signed: true })} />
            <Stat label="Transactions" value={s.transactionCount.toLocaleString("en")} />
          </div>
          {s.categories.length > 0 && <CategoryList report={report} />}
          {s.changes.length > 0 && (
            <p className="text-meta text-muted-foreground">
              Biggest changes:{" "}
              {s.changes.map((c, i) => {
                const d = c.amountMinor - c.previousMinor
                return (
                  <span key={c.name}>
                    {i > 0 && " · "}
                    <span className="text-foreground">{c.name}</span>{" "}
                    <span className="tabular-nums">{formatMoney(d, s.currency, "en", { signed: true })}</span>
                  </span>
                )
              })}
            </p>
          )}
          {s.otherCurrencies.map((c) => (
            <p key={c.currency} className="text-caption text-muted-foreground tabular-nums">
              Also in {c.currency}: {formatMoney(c.expenseMinor, c.currency)} spent, {formatMoney(c.incomeMinor, c.currency)} received
            </p>
          ))}
        </section>
      )}

      <div className="grid items-start gap-4 md:grid-cols-2">
        {report.subscriptions && (
          <Card title="Subscriptions" href="/app/budget/subscriptions" link="Manage">
            {report.subscriptions.totals.length ? (
              <ul className="grid gap-2">
                {report.subscriptions.totals.map((t) => (
                  <li key={t.currency} className="text-body flex justify-between gap-3">
                    <span>
                      {t.count} active {t.count === 1 ? "subscription" : "subscriptions"}
                    </span>
                    <span className="tabular-nums">{formatMoney(t.monthlyMinor, t.currency)} a month</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-meta text-muted-foreground">No active subscriptions.</p>
            )}
          </Card>
        )}

        {(report.tasks || Object.values(report.captured).some((v) => v !== null)) && (
          <Card title="Work" href="/app/tasks" link="Tasks">
            <ul className="grid gap-2">
              {report.tasks && (
                <>
                  <Row label="Tasks done" value={report.tasks.done} extra={<Change current={report.tasks.done} previous={report.tasks.previousDone} />} />
                  <Row label="Tasks added" value={report.tasks.added} />
                </>
              )}
              {report.captured.notes !== null && <Row label="Notes" value={report.captured.notes} />}
              {report.captured.ideas !== null && <Row label="Ideas" value={report.captured.ideas} />}
              {report.captured.links !== null && <Row label="Links" value={report.captured.links} />}
              {report.captured.feedback !== null && <Row label="Feedback messages" value={report.captured.feedback} />}
            </ul>
          </Card>
        )}

        {report.site && (
          <Card title="Public site" href="/app/analytics" link="Analytics">
            <p className="flex items-baseline gap-2">
              <span className="text-heading tabular-nums">{report.site.views.toLocaleString("en")}</span>
              <span className="text-meta text-muted-foreground">{report.site.views === 1 ? "view" : "views"}</span>
              <Change current={report.site.views} previous={report.site.previousViews} />
            </p>
            {report.site.pages.length > 0 ? (
              <ul className="grid gap-1.5">
                {report.site.pages.map((p) => (
                  <li key={p.path} className="text-body flex justify-between gap-3">
                    <span className="truncate">{p.label}</span>
                    <span className="tabular-nums text-muted-foreground">{p.views.toLocaleString("en")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-meta text-muted-foreground">No views this month.</p>
            )}
          </Card>
        )}

        {report.journal && <JournalCard journal={report.journal} />}
      </div>
    </>
  )
}

function JournalCard({ journal }: { journal: NonNullable<MonthlyReport["journal"]> }) {
  const average = moodOf(journal.averageMood === null ? null : Math.round(journal.averageMood))
  const day = (label: string, d: NonNullable<typeof journal.best>) => {
    const mood = moodOf(d.mood)
    return (
      <li className="grid gap-0.5">
        <span className="text-caption text-muted-foreground">
          {label} · {formatDayShort(d.day)}
        </span>
        <span className="text-body flex min-w-0 items-baseline gap-2">
          <span aria-hidden>{mood?.emoji}</span>
          <span className="sr-only">{mood?.label}</span>
          <span className={cn("line-clamp-2 break-words", !d.text && "text-muted-foreground italic")}>{d.text || "No line"}</span>
        </span>
      </li>
    )
  }
  return (
    <Card title="Journal" href="/app/journal" link="Open">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-heading tabular-nums">{journal.written}</span>
        <span className="text-meta text-muted-foreground">{journal.written === 1 ? "day written" : "days written"}</span>
        {journal.averageMood !== null && (
          <span className="text-meta text-muted-foreground tabular-nums">
            · average {average?.emoji} {journal.averageMood.toFixed(1)}
          </span>
        )}
      </p>
      {(journal.best || journal.worst) && (
        <ul className="grid gap-2">
          {journal.best && day("Best day", journal.best)}
          {journal.worst && day("Hardest day", journal.worst)}
        </ul>
      )}
    </Card>
  )
}

function CategoryList({ report }: { report: MonthlyReport }) {
  const s = report.spending!
  const top = Math.max(...s.categories.map((c) => c.amountMinor), 1)
  return (
    <div className="grid gap-2">
      <div className="text-caption flex justify-between text-muted-foreground">
        <span>Category</span>
        <span>
          {report.label.split(" ")[0]} · <span className="opacity-80">{report.previousLabel.split(" ")[0]}</span>
        </span>
      </div>
      <ul className="grid gap-2.5" aria-label="Spending by category">
        {s.categories.map((c) => (
          <li key={c.name} className="grid gap-1">
            <div className="text-body flex justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2 shrink-0 rounded-full" style={{ background: c.color ?? "var(--color-accent-400)" }} aria-hidden />
                <span className="truncate">{c.name}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                {formatMoney(c.amountMinor, s.currency)}{" "}
                <span className="text-meta text-muted-foreground">· {formatMoney(c.previousMinor, s.currency)}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
              <div className="h-full rounded-full bg-accent-500/80" style={{ width: `${Math.round((c.amountMinor / top) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Row({ label, value, extra }: { label: string; value: number; extra?: ReactNode }) {
  return (
    <li className="text-body flex items-baseline justify-between gap-3">
      <span>{label}</span>
      <span className="flex items-baseline gap-2">
        {extra}
        <span className="tabular-nums">{value.toLocaleString("en")}</span>
      </span>
    </li>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className="text-body-strong tabular-nums">{value}</p>
    </div>
  )
}

function Card({ title, href, link, children }: { title: string; href: `/app/${string}`; link: string; children: ReactNode }) {
  return (
    <section className="glass grid gap-3 rounded-xl p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-card-title">{title}</h2>
        <NextLink
          href={href}
          className="text-meta flex min-h-9 items-center rounded px-1 text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-11"
        >
          {link}
        </NextLink>
      </div>
      {children}
    </section>
  )
}

function ReportSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <Skeleton className="h-16 w-72" />
      <Skeleton className="h-9 w-56" />
      <div className="glass grid gap-4 rounded-xl p-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    </div>
  )
}
