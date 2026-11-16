import { Suspense } from "react"
import Link from "next/link"
import { ArrowUpRight, Kanban, ListBullets } from "@/components/icons"
import { Page, Reveal, SkeletonExit } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { cn } from "@/lib/utils"
import { actions } from "../actions"
import { QuickAdd } from "../components/idea-board"
import { IdeaBoard, IdeaRows, IdeasEmpty } from "../components/ideas-view"
import { ideaStatuses, ideaStatusLabels, type IdeaStatus } from "../schema"

export default function IdeasPage({ searchParams }: PageProps<"/app/ideas">) {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-6xl gap-4">
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
        <div className="w-full max-w-3xl">
          <QuickAdd />
        </div>
        <Suspense
          fallback={
            <SkeletonExit>
              <BoardSkeleton />
            </SkeletonExit>
          }
        >
          <Reveal>
            <Ideas searchParams={searchParams} />
          </Reveal>
        </Suspense>
      </div>
    </Page>
  )
}

function parseStatus(value: unknown): IdeaStatus | null {
  return typeof value === "string" && (ideaStatuses as readonly string[]).includes(value) ? (value as IdeaStatus) : null
}

function href(view: "list" | "board", status: IdeaStatus | null) {
  const p = new URLSearchParams()
  if (view === "board") p.set("view", "board")
  else if (status) p.set("status", status)
  const qs = p.toString()
  return qs ? `/app/ideas?${qs}` : "/app/ideas"
}

async function Ideas({ searchParams }: Pick<PageProps<"/app/ideas">, "searchParams">) {
  const params = await searchParams
  const view = params.view === "board" ? "board" : "list"
  const status = view === "list" ? parseStatus(params.status) : null
  const viewer = await requireViewer()
  const [ideas, counts] = await Promise.all([
    actions.list.handler({ status: status ? [status] : undefined, limit: 500 }),
    actions.counts.handler({}),
  ])
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  if (total === 0) return <IdeasEmpty />

  const filters: { label: string; value: IdeaStatus | null; count: number }[] = [
    { label: "All", value: null, count: total },
    ...ideaStatuses.map((s) => ({ label: ideaStatusLabels[s], value: s, count: counts[s] ?? 0 })),
  ]

  const toggle = (
    <nav aria-label="View" className="segmented shrink-0">
      {(
        [
          ["list", "List", ListBullets],
          ["board", "Board", Kanban],
        ] as const
      ).map(([v, label, Icon]) => (
        <Link
          key={v}
          href={href(v, status)}
          scroll={false}
          aria-current={view === v ? "page" : undefined}
          className={cn(
            "text-small flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-8",
            view === v && "segment-active text-foreground",
          )}
        >
          <Icon className="size-3.5" />
          {label}
        </Link>
      ))}
    </nav>
  )

  if (view === "board") {
    return (
      <div className="grid min-w-0 gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-meta text-muted-foreground tabular-nums">
            {total} {total === 1 ? "idea" : "ideas"}
          </p>
          {toggle}
        </div>
        <IdeaBoard ideas={ideas} />
      </div>
    )
  }

  return (
    <div className="grid w-full min-w-0 max-w-3xl gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <nav aria-label="Filter by status" className="-mx-1 min-w-0 flex-1 overflow-x-auto px-1 pb-1">
          <ul className="segmented">
            {filters.map((f) => {
              const active = f.value === status
              return (
                <li key={f.label}>
                  <Link
                    href={href("list", f.value)}
                    aria-current={active ? "page" : undefined}
                    scroll={false}
                    className={cn(
                      "text-small flex h-7 items-center gap-1.5 rounded-lg px-2.5 whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-8",
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
        <div className="pb-1">{toggle}</div>
      </div>
      <IdeaRows key={status ?? "all"} ideas={ideas} locale={viewer.locale} now={new Date().toISOString()} />
    </div>
  )
}

function BoardSkeleton() {
  return (
    <div className="grid w-full max-w-3xl gap-3" aria-hidden>
      <div className="flex gap-2">
        <Skeleton className="h-9 flex-1 rounded-lg" />
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>
      <div className="glass grid divide-y divide-hairline overflow-hidden rounded-xl">
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
