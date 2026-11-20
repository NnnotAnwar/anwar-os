"use client"

import { useEffect, useState } from "react"
import { ChevronDown } from "@/components/icons"
import type { OutlineItem } from "@/lib/markdown"
import { cn } from "@/lib/utils"

/**
 * "On this page" for long case studies. From 1024px it sits in the sticky
 * aside and follows the reading position; on phones it's a collapsed row above
 * the text that closes again after a jump.
 */
export function CaseStudyToc({ items, variant }: { items: OutlineItem[]; variant: "aside" | "inline" }) {
  const active = useActiveHeading(items, variant === "aside")

  const list = (onPick?: () => void) => (
    <ol className="grid gap-0.5">
      {items.map((item) => {
        const current = item.id === active
        return (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={onPick}
              aria-current={current ? "location" : undefined}
              className={cn(
                "text-meta relative flex min-h-9 items-center rounded-lg py-1.5 pr-2 text-muted-foreground outline-none transition-colors hover:bg-track hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-lg:min-h-11",
                item.level === 2 ? "pl-3" : "pl-6",
                current && "font-semibold text-foreground",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-transparent transition-colors",
                  current && "bg-primary",
                )}
              />
              {item.text}
            </a>
          </li>
        )
      })}
    </ol>
  )

  if (variant === "aside") {
    return (
      <nav aria-labelledby="toc-heading" className="grid gap-2">
        <h2 id="toc-heading" className="text-eyebrow text-text-accent">
          On this page
        </h2>
        {list()}
      </nav>
    )
  }

  return (
    <details className="glass group rounded-xl lg:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-xl px-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <span className="text-eyebrow text-text-accent">On this page</span>
        <span className="text-caption text-muted-foreground tabular-nums">
          {items.filter((i) => i.level === 2).length} sections
        </span>
        <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <nav aria-label="On this page" className="px-2 pb-2">
        {list(() => {
          // Close after a jump so the text, not the list, is what's on screen.
          document.querySelector<HTMLDetailsElement>("details[open]")?.removeAttribute("open")
        })}
      </nav>
    </details>
  )
}

/** The heading whose section is being read: the last one that has passed the top third of the viewport. */
function useActiveHeading(items: OutlineItem[], enabled: boolean) {
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    const headings = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => Boolean(el))
    if (headings.length === 0) return
    const update = () => {
      const line = window.innerHeight * 0.3
      let current: string | null = null
      for (const h of headings) if (h.getBoundingClientRect().top <= line) current = h.id
      setActive(current ?? headings[0]!.id)
    }
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("scroll", onScroll)
    }
  }, [items, enabled])
  return active
}
