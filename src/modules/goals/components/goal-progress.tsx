import { cn } from "@/lib/utils"
import { pace, paceLabels, percent, progressLabel, type Pace } from "../lib/progress"
import type { Goal } from "../schema"

const paceClass: Record<Exclude<Pace, null>, string> = {
  ahead: "text-text-accent",
  "on-track": "text-muted-foreground",
  behind: "text-warning-text",
}

/** The bar alone. A faint tick marks how far the year has gone (when given). */
export function ProgressBar({
  goal,
  elapsed,
  className,
}: {
  goal: Pick<Goal, "title" | "progress" | "status">
  elapsed?: number | null
  className?: string
}) {
  const pct = percent(goal.progress)
  return (
    <div
      role="progressbar"
      aria-label={`${goal.title} progress`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      aria-valuetext={pct === null ? "No measure yet" : `${pct}%`}
      className={cn("relative h-1.5 overflow-hidden rounded-full bg-track", className)}
    >
      {pct !== null && (
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-(--duration-move) ease-(--ease-out)",
            goal.status === "dropped" ? "bg-muted-foreground/40" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      )}
      {elapsed != null && goal.status === "active" && (
        <span aria-hidden className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${Math.round(elapsed * 100)}%` }} />
      )}
    </div>
  )
}

/** "12 of 20 books · 60% · On track" under the bar. */
export function ProgressLine({
  goal,
  elapsed,
  locale,
  className,
}: {
  goal: Pick<Goal, "progress" | "status">
  elapsed?: number | null
  locale: string
  className?: string
}) {
  const pct = percent(goal.progress)
  const p = pace(goal.progress, goal.status, elapsed ?? null)
  return (
    <p className={cn("text-caption flex flex-wrap gap-x-1.5 text-muted-foreground tabular-nums", className)}>
      <span>{progressLabel(goal.progress, locale)}</span>
      {pct !== null && goal.progress.kind !== "none" && <span aria-hidden>·</span>}
      {pct !== null && <span>{pct}%</span>}
      {p && (
        <>
          <span aria-hidden>·</span>
          <span className={paceClass[p]}>{paceLabels[p]}</span>
        </>
      )}
    </p>
  )
}
