import NextLink from "next/link"
import { formatRelative } from "@/lib/time"
import { cn } from "@/lib/utils"
import { preview, type FeedbackItem } from "../schema"
import { KindBadge, StatusBadge } from "./badges"

/** Inbox rows: unread ones carry an accent dot and a stronger weight. */
export function FeedbackList({ items, locale, now }: { items: FeedbackItem[]; locale: string; now: Date }) {
  return (
    <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl">
      {items.map((item) => {
        const unread = item.status === "new"
        return (
          <li key={item.id}>
            <NextLink
              href={`/app/feedback/${item.id}`}
              className="flex gap-3 px-3 py-3 outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-4"
            >
              <span
                aria-hidden
                className={cn("mt-1.5 size-2 shrink-0 rounded-full", unread ? "bg-primary" : "bg-transparent")}
              />
              <span className="grid min-w-0 flex-1 gap-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <KindBadge kind={item.kind} />
                  {!unread && <StatusBadge status={item.status} />}
                  {unread && <span className="sr-only">Unread.</span>}
                  <span className="text-caption truncate text-muted-foreground">
                    {item.name || "Anonymous"}
                    {item.contact && ` · ${item.contact}`}
                  </span>
                </span>
                <span className={cn("line-clamp-2 text-sm", unread ? "font-semibold" : "font-medium text-foreground/85")}>
                  {preview(item.message, 240)}
                </span>
              </span>
              <time dateTime={item.created_at} className="text-caption shrink-0 text-muted-foreground tabular-nums">
                {formatRelative(new Date(item.created_at), now, locale)}
              </time>
            </NextLink>
          </li>
        )
      })}
    </ul>
  )
}
