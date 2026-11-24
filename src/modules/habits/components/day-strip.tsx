import { cn } from "@/lib/utils"
import type { DayMark } from "../schema"

/** The last 30 days as small squares: filled when done, faint when not scheduled. */
export function DayStrip({ days, className }: { days: DayMark[]; className?: string }) {
  const scheduled = days.filter((d) => d.scheduled).length
  const done = days.filter((d) => d.scheduled && d.done).length
  return (
    <span
      role="img"
      aria-label={`Done on ${done} of ${scheduled} scheduled days in the last ${days.length} days`}
      className={cn("grid grid-flow-col gap-[2px]", className)}
      style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
    >
      {days.map((d, i) => (
        <span
          key={d.day}
          title={d.day}
          className={cn(
            "h-2 rounded-[2px]",
            d.done ? "bg-primary" : d.scheduled ? "bg-track" : "bg-track/35",
            i === days.length - 1 && !d.done && "ring-1 ring-accent-500/60 ring-inset",
          )}
        />
      ))}
    </span>
  )
}
