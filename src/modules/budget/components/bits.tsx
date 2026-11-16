"use client"

import { useState, type ReactNode } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { colorClass } from "../lib/colors"

// Small pieces shared by the budget screens. Native controls styled with the
// same tokens as shadcn's Input (bg-field / border-field-border).

export const selectClass =
  "h-9 w-full min-w-0 rounded-lg border border-field-border bg-field px-2.5 text-sm font-medium outline-none focus-visible:border-accent-500 focus-visible:ring-3 focus-visible:ring-accent-500/20 aria-invalid:border-destructive md:h-8 dark:[color-scheme:dark]"

export function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string
  htmlFor: string
  hint?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-small text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="text-caption text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function CategoryDot({ color, className }: { color: string | null; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", color ? colorClass(color) : "bg-track ring-1 ring-field-border", className)} />
}

export function FormError({ id, children }: { id?: string; children: ReactNode }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="text-caption text-destructive">
      {children}
    </p>
  )
}

/** Money in / money out: a two-option segmented control. */
export function DirectionToggle({ value, onChange, idPrefix }: { value: "out" | "in"; onChange: (v: "out" | "in") => void; idPrefix: string }) {
  return (
    <div role="radiogroup" aria-label="Direction" className="segmented w-full">
      {(["out", "in"] as const).map((d) => (
        <button
          key={d}
          id={`${idPrefix}-${d}`}
          type="button"
          role="radio"
          aria-checked={value === d}
          onClick={() => onChange(d)}
          className={cn(
            "text-small h-8 flex-1 rounded-lg px-3 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
            value === d && "segment-active text-foreground",
          )}
        >
          {d === "out" ? "Money out" : "Money in"}
        </button>
      ))}
    </div>
  )
}

/**
 * A dialog that is a bottom sheet on phones (slides up, grab handle, swipe down
 * to close) and a centred panel from 640 px — the ServiceSheet pattern.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "glass glass-menu sheet max-h-[calc(100svh-2rem)] gap-4 overflow-y-auto sm:max-w-lg",
          "max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[92svh] max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:pt-1 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]",
        )}
      >
        <SheetHandle onDismiss={() => onOpenChange(false)} />
        <DialogHeader>
          <DialogTitle className="text-card-title">{title}</DialogTitle>
          {description && <DialogDescription className="text-meta text-muted-foreground">{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

// Same gesture as ServiceSheet's handle in components/services/service-card.tsx.
function SheetHandle({ onDismiss }: { onDismiss: () => void }) {
  const [start, setStart] = useState<{ y: number; t: number } | null>(null)
  const sheetOf = (el: HTMLElement) => el.closest<HTMLElement>("[data-slot=dialog-content]")
  return (
    <div
      aria-hidden
      className="-mb-2 flex touch-none justify-center pt-1 pb-1 sm:hidden"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setStart({ y: e.clientY, t: e.timeStamp })
      }}
      onPointerMove={(e) => {
        if (!start) return
        const sheet = sheetOf(e.currentTarget)
        if (sheet) sheet.style.transform = `translateY(${Math.max(0, e.clientY - start.y)}px)`
      }}
      onPointerUp={(e) => {
        if (!start) return
        const dy = e.clientY - start.y
        const velocity = dy / Math.max(1, e.timeStamp - start.t)
        const sheet = sheetOf(e.currentTarget)
        setStart(null)
        if (dy > 80 || velocity > 0.6) onDismiss()
        else if (sheet) {
          sheet.style.transition = "transform 220ms var(--ease-out)"
          sheet.style.transform = ""
          setTimeout(() => (sheet.style.transition = ""), 240)
        }
      }}
    >
      <span className="h-1 w-10 rounded-full bg-field-border" />
    </div>
  )
}
