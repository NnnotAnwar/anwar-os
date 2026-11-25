import Link from "next/link"
import { cache, type ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "@/components/icons"
import { Page } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { actions } from "../actions"
import { BudgetNav } from "../components/budget-nav"
import { formatMonth, isMonth, shiftMonth } from "../lib/dates"

/** Every budget screen: header, section nav, content. */
export function BudgetPage({
  title,
  description,
  actions: headerActions,
  children,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-4">
        <PageHeader eyebrow="Budget" title={title} description={description} actions={headerActions} />
        <BudgetNav />
        {children}
      </div>
    </Page>
  )
}

/** First visit: default categories and an account. Once per request; a no-op afterwards. */
export const ensureSetup = cache(() => actions.ensureSetup.handler({}))

export const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined)

export function monthParam(value: string | string[] | undefined, fallback: string) {
  const m = one(value)
  return isMonth(m) ? m : fallback
}

/** ‹ November 2026 › as links that keep the other query params. */
export function MonthSwitcher({
  month,
  current,
  locale,
  basePath,
  params = {},
}: {
  month: string
  current: string
  locale: string
  basePath: string
  params?: Record<string, string | undefined>
}) {
  const href = (m: string) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v)
    if (m !== current) q.set("month", m)
    const s = q.toString()
    return s ? `${basePath}?${s}` : basePath
  }
  const linkClass =
    "flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-track hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4"
  return (
    <div className="flex items-center gap-1">
      <Link href={href(shiftMonth(month, -1))} scroll={false} className={linkClass} aria-label="Previous month">
        <ChevronLeft />
      </Link>
      <p className="text-heading min-w-32 text-center tabular-nums" aria-live="polite">
        {formatMonth(month, locale)}
      </p>
      <Link href={href(shiftMonth(month, 1))} scroll={false} className={linkClass} aria-label="Next month">
        <ChevronRight />
      </Link>
      {month !== current && (
        <Link href={href(current)} scroll={false} className="text-caption ml-1 rounded px-1 text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
          This month
        </Link>
      )}
    </div>
  )
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="glass grid gap-px overflow-hidden rounded-xl" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-3 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  )
}
