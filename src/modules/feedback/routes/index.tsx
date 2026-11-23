import { Suspense } from "react"
import NextLink from "next/link"
import { ExternalLink, Inbox } from "@/components/icons"
import { PageHeader } from "@/components/shell/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { cn } from "@/lib/utils"
import { actions } from "../actions"
import { FeedbackList } from "../components/feedback-list"
import { inboxFilters, statusLabels, type FeedbackStatus, type InboxFilter } from "../schema"

const filterLabel = (f: InboxFilter) => (f === "inbox" ? "Inbox" : statusLabels[f])
const shown: InboxFilter[] = inboxFilters.filter((f) => f !== "read")

export default function FeedbackPage({ searchParams }: PageProps<"/app/feedback">) {
  return (
    <div className="grid w-full max-w-3xl gap-4">
      <PageHeader
        eyebrow="Inbox"
        title="Feedback"
        description="What visitors send through the public form. Opening a message marks it read."
        actions={
          <NextLink
            href="/feedback"
            target="_blank"
            // -my/py: a finger-sized hit area without moving the header.
            className="text-meta -my-3 inline-flex items-center gap-1 rounded py-3 text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Public form
            <ExternalLink className="size-3.5" />
          </NextLink>
        }
      />
      <Suspense fallback={<InboxSkeleton />}>
        <InboxBody searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function InboxBody({ searchParams }: Pick<PageProps<"/app/feedback">, "searchParams">) {
  const { status } = await searchParams
  const filter: InboxFilter = inboxFilters.includes(status as InboxFilter) ? (status as InboxFilter) : "inbox"
  const viewer = await requireViewer()
  const [items, counts] = await Promise.all([actions.list.handler({ filter, limit: 300 }), actions.counts.handler({})])
  const total = (Object.entries(counts) as [FeedbackStatus, number][])
    .filter(([s]) => s !== "spam")
    .reduce((sum, [, n]) => sum + n, 0)
  const countFor = (f: InboxFilter) => (f === "inbox" ? total : counts[f])
  const now = new Date()

  return (
    <div className="grid gap-3">
      <nav aria-label="Filter by status" className="segmented max-w-full self-start overflow-x-auto">
        {shown.map((f) => (
          <NextLink
            key={f}
            href={f === "inbox" ? "/app/feedback" : `/app/feedback?status=${f}`}
            aria-current={filter === f ? "page" : undefined}
            scroll={false}
            className={`text-small ${cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
              filter === f && "segment-active text-foreground",
            )}`}
          >
            {filterLabel(f)}
            {countFor(f) > 0 && (
              <span className={cn("tabular-nums", f === "new" ? "text-text-accent" : "opacity-60")}>{countFor(f)}</span>
            )}
          </NextLink>
        ))}
      </nav>

      {items.length === 0 ? (
        <Empty filter={filter} />
      ) : (
        <FeedbackList items={items} locale={viewer.locale} now={now} />
      )}
    </div>
  )
}

function Empty({ filter }: { filter: InboxFilter }) {
  const text: Record<InboxFilter, string> = {
    inbox: "No feedback yet. Share the public form and messages land here.",
    new: "All caught up — nothing new is waiting for you.",
    read: "Nothing marked read.",
    in_progress: "Nothing in progress.",
    done: "Nothing finished yet.",
    spam: "No spam. The spam check and rate limits are doing their job.",
  }
  return (
    <div className="glass grid justify-items-start gap-2 rounded-xl p-4">
      <Inbox className="size-5 text-text-accent" />
      <p className="text-meta text-muted-foreground">{text[filter]}</p>
    </div>
  )
}

function InboxSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      <Skeleton className="h-9 w-80 max-w-full" />
      <div className="glass grid gap-px rounded-xl">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="grid gap-2 px-4 py-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ))}
      </div>
    </div>
  )
}
