import NextLink from "next/link"
import { formatRelative } from "@/lib/time"
import { cn } from "@/lib/utils"
import { preview } from "../../schema"
import type { ContactMessage } from "../schema"
import { ContactStatusBadge, TopicBadge } from "./badges"

/** Contact rows: messages still waiting for a reply carry an accent dot and a stronger weight. */
export function ContactList({ items, locale, now }: { items: ContactMessage[]; locale: string; now: Date }) {
  return (
    <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl">
      {items.map((m) => {
        const waiting = m.status === "new"
        return (
          <li key={m.id}>
            <NextLink
              href={`/app/feedback/contact/${m.id}`}
              className="flex gap-3 px-3 py-3 outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-4"
            >
              <span
                aria-hidden
                className={cn("mt-1.5 size-2 shrink-0 rounded-full", waiting ? "bg-primary" : "bg-transparent")}
              />
              <span className="grid min-w-0 flex-1 gap-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <TopicBadge topic={m.topic} />
                  {!waiting && <ContactStatusBadge status={m.status} />}
                  {waiting && <span className="sr-only">Waiting for a reply.</span>}
                  <span className={cn("text-meta truncate", waiting ? "font-semibold" : "font-medium")}>
                    {m.name}
                    {m.company && <span className="font-normal text-muted-foreground"> · {m.company}</span>}
                  </span>
                </span>
                <span className="line-clamp-2 text-sm text-foreground/85">{preview(m.message, 240)}</span>
              </span>
              <time dateTime={m.created_at} className="text-caption shrink-0 text-muted-foreground tabular-nums">
                {formatRelative(new Date(m.created_at), now, locale)}
              </time>
            </NextLink>
          </li>
        )
      })}
    </ul>
  )
}
