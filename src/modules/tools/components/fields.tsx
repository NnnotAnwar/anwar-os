"use client"

import { useId, type ReactNode } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * A labelled text field for numbers. It stays a text input with a decimal
 * keypad so "3,5" works as well as "3.5"; parsing happens in the calculator.
 */
export function NumberField({
  label,
  value,
  onChange,
  unit,
  hint,
  error,
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  unit?: string
  hint?: ReactNode
  error?: string
  className?: string
}) {
  const id = useId()
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ") || undefined
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn("h-10 font-mono tabular md:text-sm", unit && "pr-12")}
        />
        {unit && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-xs text-muted-foreground"
          >
            {unit}
          </span>
        )}
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

export type Choice<T extends string> = { value: T; label: string; hint?: string }

/**
 * Native radio buttons styled as a segmented control (or a stacked list with
 * hints). Arrow keys move between options, as with any radio group.
 */
export function ChoiceGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
  layout = "row",
}: {
  legend: string
  value: T
  options: readonly Choice<T>[]
  onChange: (value: T) => void
  layout?: "row" | "list"
}) {
  const name = useId()
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div
        className={cn(
          layout === "row" ? "grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted p-1" : "grid gap-1.5",
        )}
      >
        {options.map((option) => (
          <label key={option.value} className="relative block cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "block rounded-md text-sm transition-colors peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
                layout === "row"
                  ? "px-2 py-1.5 text-center text-muted-foreground peer-checked:bg-card peer-checked:font-medium peer-checked:text-foreground peer-checked:shadow-sm hover:text-foreground"
                  : "border px-3 py-2 peer-checked:border-sky peer-checked:bg-accent hover:bg-muted/60",
              )}
            >
              <span className={cn(layout === "list" && "font-medium")}>{option.label}</span>
              {option.hint && layout === "list" && (
                <span className="block text-xs text-muted-foreground">{option.hint}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Small uppercase mono caption used above result groups. */
export function SectionLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
      {children}
    </h2>
  )
}

/** A label/value row in a result list. Values are mono with tabular figures. */
export function ResultRow({ label, value, unit, hint }: { label: ReactNode; value: ReactNode; unit?: string; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-muted-foreground">
        {label}
        {hint && <span className="block text-xs">{hint}</span>}
      </dt>
      <dd className="text-right font-mono text-sm tabular">
        {value}
        {unit && <span className="ml-1 text-xs text-muted-foreground">{unit}</span>}
      </dd>
    </div>
  )
}

/**
 * The panel that holds a calculator's results. Only the headline figure inside
 * should be a live region, so screen readers aren't flooded on every keystroke.
 */
export function ResultPanel({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <section aria-label={label} className={cn("grid content-start gap-6 rounded-xl border bg-card p-4 sm:p-6", className)}>
      {children}
    </section>
  )
}
