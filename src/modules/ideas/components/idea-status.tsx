import { cn } from "@/lib/utils"
import { ideaStatusLabels, type IdeaStatus } from "../schema"

const tone: Record<IdeaStatus, string> = {
  raw: "bg-muted text-muted-foreground",
  exploring: "bg-muted text-foreground",
  building: "bg-secondary text-secondary-foreground",
  shipped: "bg-primary text-primary-foreground",
  dropped: "bg-transparent text-muted-foreground line-through decoration-1",
}

/** The pipeline as one accent ramp: neutral while raw, tinted while building, filled once shipped. */
export function IdeaStatusPill({ status, className }: { status: IdeaStatus; className?: string }) {
  return (
    <span className={cn("text-micro inline-flex h-5 shrink-0 items-center rounded-md px-1.5", tone[status], className)}>
      {ideaStatusLabels[status]}
    </span>
  )
}
