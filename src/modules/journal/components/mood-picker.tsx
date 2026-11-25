"use client"

import { useRef, type KeyboardEvent } from "react"
import { cn } from "@/lib/utils"
import { MOODS, type Mood } from "../schema"

/**
 * Five faces as a radio group: one tap picks (or, on the picked face, clears)
 * the mood. Arrow keys move between faces like native radios. 44 px targets.
 */
export function MoodPicker({
  value,
  onChange,
  label = "Mood",
  disabled,
  className,
}: {
  value: Mood | null
  onChange: (mood: Mood | null) => void
  label?: string
  disabled?: boolean
  className?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  // Tab lands on the picked face, or the first one.
  const focusIndex = value ? value - 1 : 0

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (step === undefined) return
    event.preventDefault()
    const next = (index + step + MOODS.length) % MOODS.length
    refs.current[next]?.focus()
    onChange(MOODS[next]!.value)
  }

  return (
    <div role="radiogroup" aria-label={label} className={cn("flex gap-1", className)}>
      {MOODS.map((mood, i) => {
        const checked = value === mood.value
        return (
          <button
            key={mood.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={mood.label}
            title={mood.label}
            tabIndex={i === focusIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(checked ? null : mood.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "grid size-11 place-items-center rounded-lg text-2xl leading-none outline-none transition-[background-color,box-shadow,filter,opacity] duration-150",
              "focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
              checked
                ? "bg-accent-500/15 ring-2 ring-accent-500 dark:bg-accent-400/20 dark:ring-accent-400"
                : value === null
                  ? "hover:bg-muted"
                  : "opacity-55 grayscale-[60%] hover:bg-muted hover:opacity-100 hover:grayscale-0",
            )}
          >
            <span aria-hidden key={checked ? "on" : "off"} className={cn(checked && "animate-pop")}>
              {mood.emoji}
            </span>
          </button>
        )
      })}
    </div>
  )
}
