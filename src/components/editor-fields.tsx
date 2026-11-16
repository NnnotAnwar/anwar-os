"use client"

import { useId, type ReactNode } from "react"
import type { AutosaveStatus } from "@/lib/use-autosave"
import { cn } from "@/lib/utils"

// Small form pieces shared by the cv, projects and ideas editors. Native
// controls styled with semantic tokens only, so a re-theme carries over.

export const fieldClass =
  "h-9 w-full min-w-0 rounded-lg border border-field-border bg-field px-3 py-1.5 text-sm font-medium outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-accent-500 focus-visible:ring-3 focus-visible:ring-accent-500/20 aria-invalid:border-destructive md:h-8"

export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <label htmlFor={id} className="text-small text-muted-foreground">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-caption text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** A checkbox drawn as a switch. Keyboard and screen readers get a real checkbox. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start gap-3">
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={description ? `${id}-d` : undefined}
          className="peer h-5 w-9 cursor-pointer appearance-none rounded-full bg-muted-foreground/30 transition-colors outline-none checked:bg-primary focus-visible:ring-3 focus-visible:ring-accent-500/40 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4"
        />
      </span>
      <span className="grid gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-body">
          {label}
        </label>
        {description && (
          <span id={`${id}-d`} className="text-caption text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </div>
  )
}

export function SaveStatus({
  status,
  idleText = "Saves as you type",
  locale = "en",
  timezone,
  className,
}: {
  status: AutosaveStatus
  idleText?: string
  locale?: string
  timezone?: string
  className?: string
}) {
  const text = (() => {
    switch (status.kind) {
      case "idle":
        return idleText
      case "dirty":
        return "Unsaved changes"
      case "saving":
        return "Saving…"
      case "saved":
        return `Saved ${new Intl.DateTimeFormat(locale, {
          timeZone: timezone,
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(status.at))}`
      case "error":
        return status.message
    }
  })()
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "text-caption truncate text-muted-foreground tabular-nums",
        status.kind === "error" && "text-destructive",
        className,
      )}
    >
      {text}
    </p>
  )
}
