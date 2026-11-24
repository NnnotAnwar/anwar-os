import NextLink from "next/link"
import { cn } from "@/lib/utils"
import { actions } from "../actions"

/** Feedback (anonymous notes) and Contact (named messages) share one inbox; each tab shows its new count. */
export async function FeedbackTabs({ current }: { current: "feedback" | "contact" }) {
  const [feedback, contact] = await Promise.all([actions.counts.handler({}), actions.contactCounts.handler({})])
  const tabs = [
    { id: "feedback", label: "Feedback", href: "/app/feedback", count: feedback.new },
    { id: "contact", label: "Contact", href: "/app/feedback/contact", count: contact.new },
  ] as const
  return (
    <nav aria-label="Inbox" className="segmented self-start">
      {tabs.map((t) => (
        <NextLink
          key={t.id}
          href={t.href}
          aria-current={current === t.id ? "page" : undefined}
          className={`text-small ${cn(
            "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3.5 whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
            current === t.id && "segment-active text-foreground",
          )}`}
        >
          {t.label}
          {t.count > 0 && (
            <span className="text-text-accent tabular-nums">
              {t.count}
              <span className="sr-only"> new</span>
            </span>
          )}
        </NextLink>
      ))}
    </nav>
  )
}
