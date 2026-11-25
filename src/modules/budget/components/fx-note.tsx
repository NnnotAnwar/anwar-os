import { cn } from "@/lib/utils"
import { ratesLabel, type FxNote } from "../fx/convert"

/**
 * The small line under converted totals: "≈ EUR, USD converted · Rates: ČNB,
 * 25 Nov", and which currencies couldn't be converted. Nothing when nothing
 * needed converting.
 */
export function FxNoteLine({
  note,
  today,
  locale,
  className,
  unavailableText = "not converted (no rate)",
}: {
  note: FxNote
  today: string
  locale: string
  className?: string
  unavailableText?: string
}) {
  const label = ratesLabel(note, today, locale)
  if (!label && !note.unavailable.length) return null
  return (
    <p className={cn("text-caption text-muted-foreground", className)}>
      {label && (
        <span title="Each amount converts at the Czech National Bank rate of its own day (the latest fixing on or before it).">
          ≈ {note.converted.join(", ")} converted · {label}
        </span>
      )}
      {label && note.unavailable.length > 0 && " · "}
      {note.unavailable.length > 0 && (
        <span>
          {note.unavailable.join(", ")} {unavailableText}
        </span>
      )}
    </p>
  )
}

/** "≈ " in front of a figure that includes converted amounts. */
export const approx = (note: FxNote) => (note.converted.length ? "≈ " : "")
