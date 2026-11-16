import { Suspense } from "react"
import Link from "next/link"
import { ArrowUpRight } from "@/components/icons"
import { PageHeader } from "@/components/shell/page-header"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { cn } from "@/lib/utils"
import { actions } from "../actions"
import { IdeaList, QuickAdd } from "../components/idea-board"
import { ideaStatuses, ideaStatusLabels, type IdeaStatus } from "../schema"

export default function IdeasPage({ searchParams }: PageProps<"/app/ideas">) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <PageHeader
        eyebrow="Backlog"
        title="Ideas"
        description="Capture fast, sort later. Raw → exploring → building → shipped, or dropped. Public ones show on /ideas."
        actions={
          <Link href="/ideas" target="_blank" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Public page
            <ArrowUpRight />
          </Link>
        }
      />
      <QuickAdd />
      <Suspense fallback={<BoardSkeleton />}>
        <Board searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

function parseStatus(value: unknown): IdeaStatus | null {
  return typeof value === "string" && (ideaStatuses as readonly string[]).includes(value) ? (value as IdeaStatus) : null
}

async function Board({ searchParams }: Pick<PageProps<"/app/ideas">, "searchParams">) {
  const status = parseStatus((await searchParams).status)
  const viewer = await requireViewer()
  const [ideas, counts] = await Promise.all([
    actions.list.handler({ status: status ? [status] : undefined, limit: 500 }),
    actions.counts.handler({}),
  ])
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  if (total === 0) {
    return (
      <div className="glass grid gap-1 rounded-xl p-6">
        <p className="text-card-title">Your idea backlog starts here</p>
        <p className="text-meta max-w-prose text-muted-foreground">
          Type an idea above and press Enter. Open it later to add notes, tags, a status — and publish the ones you
          want visitors to see.
        </p>
      </div>
    )
  }

  const filters: { label: string; value: IdeaStatus | null; count: number }[] = [
    { label: "All", value: null, count: total },
    ...ideaStatuses.map((s) => ({ label: ideaStatusLabels[s], value: s, count: counts[s] ?? 0 })),
  ]

  return (
    <div className="grid gap-3">
      <nav aria-label="Filter by status" className="-mx-1 overflow-x-auto px-1 pb-1">
        <ul className="segmented">
          {filters.map((f) => {
            const active = f.value === status
            return (
              <li key={f.label}>
                <Link
                  href={f.value ? `/app/ideas?status=${f.value}` : "/app/ideas"}
                  aria-current={active ? "page" : undefined}
                  scroll={false}
                  className={cn(
                    "text-small flex h-7 items-center gap-1.5 rounded-lg px-2.5 whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                    active && "segment-active text-foreground",
                  )}
                >
                  {f.label}
                  <span className="text-caption tabular-nums opacity-70">{f.count}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <IdeaList key={status ?? "all"} ideas={ideas} locale={viewer.locale} now={new Date().toISOString()} />
    </div>
  )
}

function BoardSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      <Skeleton className="h-9 w-96 max-w-full rounded-lg" />
      <div className="glass grid gap-px overflow-hidden rounded-xl">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="grid gap-2 px-4 py-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        ))}
      </div>
    </div>
  )
}
