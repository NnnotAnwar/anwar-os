"use client"

import type { ReactNode } from "react"
import { Sheet as SharedSheet } from "@/components/sheet"
import { cn } from "@/lib/utils"
import { colorClass } from "../lib/colors"

// Small pieces shared by the budget screens. Native controls styled with the
// same tokens as shadcn's Input (bg-field / border-field-border).

export const selectClass =
  "h-9 w-full min-w-0 rounded-lg border border-field-border bg-field px-2.5 text-base font-medium outline-none md:text-sm focus-visible:border-accent-500 focus-visible:ring-3 focus-visible:ring-accent-500/20 aria-invalid:border-destructive md:h-8 dark:[color-scheme:dark]"

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
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-full", color ? colorClass(color) : "bg-track ring-1 ring-field-border", className)}
    />
  )
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
export function DirectionToggle({
  value,
  onChange,
  idPrefix,
}: {
  value: "out" | "in"
  onChange: (v: "out" | "in") => void
  idPrefix: string
}) {
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
            "text-small h-9 flex-1 rounded-lg px-3 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
            value === d && "segment-active text-foreground",
          )}
        >
          {d === "out" ? "Money out" : "Money in"}
        </button>
      ))}
    </div>
  )
}

/** The shared bottom sheet (components/sheet.tsx) with a padded body for forms. */
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
    <SharedSheet open={open} onOpenChange={onOpenChange} title={title} description={description} className="sm:max-w-lg">
      <div className="p-4">{children}</div>
    </SharedSheet>
  )
}

/** A thin progress bar with its value written beside it by the caller. */
export function Bar({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-full bg-track">
      <span className={cn("block h-full rounded-full bg-accent-500", className)} style={{ width: `${pct}%` }} />
    </span>
  )
}
