import { cn } from "@/lib/utils"
import { statusLabels, type ProjectStatus } from "../schema"

/** Live is the accent (success); every other state stays neutral. The word carries the meaning. */
export function StatusPill({ status, className }: { status: ProjectStatus; className?: string }) {
  return (
    <span
      className={cn(
        "text-micro inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5",
        status === "live" ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {status === "live" && <span aria-hidden className="size-1.5 rounded-full bg-primary" />}
      {statusLabels[status]}
    </span>
  )
}
