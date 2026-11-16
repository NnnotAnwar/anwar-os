import { cn } from "@/lib/utils"
import { kindLabels, statusLabels, type FeedbackKind, type FeedbackStatus } from "../schema"

// The type style sits outside cn(): tailwind-merge reads `text-caption` as a
// text colour and would drop it next to `text-foreground`.
const pill = "inline-flex h-5 items-center rounded-md px-1.5 whitespace-nowrap"

export function KindBadge({ kind }: { kind: FeedbackKind }) {
  return (
    <span
      className={`text-caption ${cn(pill, kind === "complaint" ? "bg-warning-surface text-warning-text" : "bg-track text-foreground")}`}
    >
      {kindLabels[kind]}
    </span>
  )
}

export function StatusBadge({ status }: { status: FeedbackStatus }) {
  return (
    <span
      className={`text-caption ${cn(
        pill,
        status === "new" && "bg-primary/12 text-text-accent",
        status === "in_progress" && "bg-warning-surface text-warning-text",
        status === "spam" && "bg-error-surface text-destructive",
        (status === "read" || status === "done") && "text-muted-foreground",
      )}`}
    >
      {statusLabels[status]}
    </span>
  )
}
