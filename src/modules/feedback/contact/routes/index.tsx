import { Suspense } from "react"
import NextLink from "next/link"
import { Envelope, ExternalLink } from "@/components/icons"
import { PageHeader } from "@/components/shell/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { cn } from "@/lib/utils"
import { actions } from "../../actions"
import { FeedbackTabs } from "../../components/feedback-tabs"
import { ContactList } from "../components/contact-list"
import { contactStatusLabels, type ContactFilter, type ContactStatus } from "../schema"
import { Page } from "@/components/motion"

const filters: ContactFilter[] = ["open", "new", "replied", "archived"]
const filterLabel = (f: ContactFilter) => (f === "open" ? "Open" : contactStatusLabels[f])

export default function ContactInboxPage({ searchParams }: PageProps<"/app/feedback/contact">) {
  return (
    <Page>
      <div className="grid w-full max-w-3xl gap-4">
        <PageHeader
          eyebrow="Inbox"
          title="Contact"
          description="Job offers and projects from the public contact form. Answer by email; archived messages are deleted after 12 months."
          actions={
            <NextLink
              href="/contact"
              target="_blank"
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
    </Page>
  )
}

async function InboxBody({ searchParams }: Pick<PageProps<"/app/feedback/contact">, "searchParams">) {
  const { status } = await searchParams
  const filter: ContactFilter = filters.includes(status as ContactFilter) ? (status as ContactFilter) : "open"
  const viewer = await requireViewer()
  const [items, counts] = await Promise.all([
    actions.contactList.handler({ filter, limit: 300 }),
    actions.contactCounts.handler({}),
  ])
  const countFor = (f: ContactFilter) => (f === "open" ? counts.new + counts.replied : counts[f as ContactStatus])
  const now = new Date()

  return (
    <div className="grid gap-3">
      <FeedbackTabs current="contact" />
      <nav aria-label="Filter by status" className="segmented max-w-full self-start overflow-x-auto">
        {filters.map((f) => (
          <NextLink
            key={f}
            href={f === "open" ? "/app/feedback/contact" : `/app/feedback/contact?status=${f}`}
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
        <ContactList items={items} locale={viewer.locale} now={now} />
      )}
    </div>
  )
}

function Empty({ filter }: { filter: ContactFilter }) {
  const text: Record<ContactFilter, string> = {
    open: "No messages yet. Share anwar-os.com/contact — job offers and projects land here.",
    new: "All answered — nothing is waiting for a reply.",
    replied: "Nothing marked replied.",
    archived: "Nothing archived.",
  }
  return (
    <div className="glass grid justify-items-start gap-2 rounded-xl p-4">
      <Envelope className="size-5 text-text-accent" />
      <p className="text-meta text-muted-foreground">{text[filter]}</p>
    </div>
  )
}

function InboxSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-9 w-72 max-w-full" />
      <div className="glass grid gap-px rounded-xl">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="grid gap-2 px-4 py-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ))}
      </div>
    </div>
  )
}
