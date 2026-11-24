import NextLink from "next/link"
import type { ViewerContext } from "@/core/module"
import { formatRelative } from "@/lib/time"
import { actions } from "../actions"
import { KindBadge } from "../components/badges"
import { preview } from "../schema"

const rowClass =
  "flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 -mx-2 outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"

export async function NewFeedback({ ctx }: { ctx: ViewerContext }) {
  const [counts, items, contact] = await Promise.all([
    actions.counts.handler({}),
    actions.list.handler({ filter: "new", limit: 3 }),
    actions.contactCounts.handler({}),
  ])
  const contactLine =
    contact.new > 0 ? (
      <NextLink
        href="/app/feedback/contact?status=new"
        className="text-meta self-start rounded text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {contact.new === 1 ? "1 contact message" : `${contact.new} contact messages`} waiting for a reply
      </NextLink>
    ) : null
  if (counts.new === 0) {
    return contactLine ? (
      <div className="grid gap-1">
        {contactLine}
        <p className="text-caption text-muted-foreground">No new feedback.</p>
      </div>
    ) : (
      <p className="text-meta text-muted-foreground">All caught up — nothing new is waiting for you.</p>
    )
  }
  const now = new Date()
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
      {contactLine}
      <NextLink
        href="/app/feedback?status=new"
        className="flex items-baseline gap-1.5 self-start rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="text-metric text-text-accent">{counts.new}</span>
        <span className="text-meta text-muted-foreground">{counts.new === 1 ? "new message" : "new messages"}</span>
      </NextLink>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <NextLink href={`/app/feedback/${item.id}`} className={rowClass}>
              <KindBadge kind={item.kind} />
              <span className="text-body min-w-0 flex-1 truncate">{preview(item.message, 90)}</span>
              <time dateTime={item.created_at} className="text-caption shrink-0 text-muted-foreground tabular-nums">
                {formatRelative(new Date(item.created_at), now, ctx.locale)}
              </time>
            </NextLink>
          </li>
        ))}
      </ul>
    </div>
  )
}
