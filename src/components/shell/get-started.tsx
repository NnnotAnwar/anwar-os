"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { CheckCircle, ChevronRightIcon, X } from "@/components/icons"
import { dismissHint } from "@/core/services-actions"
import type { SetupStep } from "@/core/onboarding"
import { cn } from "@/lib/utils"

/**
 * First-run checklist on Today. Steps tick themselves off from real data; the
 * next open step is highlighted so it's obvious where to tap.
 */
export function GetStarted({ steps }: { steps: SetupStep[] }) {
  const [hidden, setHidden] = useState(false)
  const [pending, startTransition] = useTransition()
  const done = steps.filter((s) => s.done).length
  const next = steps.find((s) => !s.done)
  if (hidden || !next) return null

  const progress = done / steps.length
  const r = 15
  const c = 2 * Math.PI * r

  return (
    <section aria-labelledby="get-started" className="glass grid gap-3 rounded-xl p-4">
      <header className="flex items-center gap-3">
        <svg viewBox="0 0 36 36" className="size-9 shrink-0 -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r={r} fill="none" className="stroke-track" strokeWidth="4" />
          <circle
            cx="18"
            cy="18"
            r={r}
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            className="stroke-accent-500 transition-[stroke-dashoffset] duration-500"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - progress)}
          />
        </svg>
        <div className="grid flex-1 gap-0.5">
          <h2 id="get-started" className="text-card-title">
            Get started
          </h2>
          <p className="text-caption text-muted-foreground tabular-nums">
            {done} of {steps.length} done
          </p>
        </div>
        <button
          type="button"
          aria-label="Hide the checklist"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setHidden(true)
              await dismissHint("get-started")
            })
          }
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4"
        >
          <X />
        </button>
      </header>
      <ol className="grid gap-0.5">
        {steps.map((s) => {
          const isNext = s.id === next.id
          return (
            <li key={s.id}>
              <Link
                href={s.href}
                aria-disabled={s.done}
                className={cn(
                  "press flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50",
                  isNext && "bg-secondary hover:bg-secondary",
                  s.done && "pointer-events-none",
                )}
              >
                {s.done ? (
                  <CheckCircle className="size-5 shrink-0 text-accent-500" aria-label="Done" />
                ) : (
                  <span
                    className={cn(
                      "size-5 shrink-0 rounded-full border-2",
                      isNext ? "border-accent-500" : "border-field-border",
                    )}
                    aria-hidden
                  />
                )}
                <span className="grid min-w-0 flex-1">
                  <span className={cn("text-body truncate", s.done && "text-muted-foreground line-through")}>
                    {s.label}
                  </span>
                  {isNext && <span className="text-caption text-muted-foreground">{s.hint}</span>}
                </span>
                {!s.done && <ChevronRightIcon className="size-4 text-muted-foreground" />}
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
