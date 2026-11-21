import { cn } from "@/lib/utils"
import { statusDot, statusLabels, type Status } from "../lib/status"

/** The coloured dot; the word beside it (or the sr-only label) carries the meaning. */
export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2.5 shrink-0", className)}>
      <span aria-hidden className={cn("size-2.5 rounded-full", statusDot[status])} />
      <span className="sr-only">{statusLabels[status]}</span>
    </span>
  )
}
