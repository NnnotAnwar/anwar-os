import { AirplaneTilt, Car, FileText, FirstAid, IdCard, IdentificationBadge, type AppIcon } from "@/components/icons"
import { cn } from "@/lib/utils"
import type { DocumentStatus, StatusTone } from "../lib/status"
import type { DocumentKind } from "../schema"

// Small pieces shared by the list, the detail page and Today's widget.

const KIND_ICONS: Record<DocumentKind, AppIcon> = {
  passport: AirplaneTilt,
  residence_permit: IdCard,
  id_card: IdentificationBadge,
  driving_licence: Car,
  insurance: FirstAid,
  other: FileText,
}

export function KindIcon({ kind, tone, className }: { kind: DocumentKind; tone?: StatusTone; className?: string }) {
  const Icon = KIND_ICONS[kind]
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg",
        tone === "expired"
          ? "bg-error-surface text-destructive"
          : tone === "urgent" || tone === "soon"
            ? "bg-warning-surface text-warning-text"
            : "bg-secondary text-text-accent",
        className,
      )}
    >
      <Icon className="size-5" />
    </span>
  )
}

// The type style sits outside cn(): tailwind-merge reads `text-caption` as a
// text colour and would drop it next to the tone's colour.
const pill = "inline-flex h-6 shrink-0 items-center rounded-md px-2 whitespace-nowrap"

export function StatusChip({ status, className }: { status: Pick<DocumentStatus, "tone" | "label">; className?: string }) {
  return (
    <span
      className={`text-caption ${cn(
        pill,
        status.tone === "valid" && "bg-track text-muted-foreground",
        status.tone === "soon" && "bg-warning-surface text-warning-text",
        status.tone === "urgent" && "bg-warning-surface font-semibold text-warning-text",
        status.tone === "expired" && "bg-error-surface font-semibold text-destructive",
        className,
      )}`}
    >
      {status.label}
    </span>
  )
}
