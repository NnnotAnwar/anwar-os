"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Flame } from "@/components/icons"
import { cn } from "@/lib/utils"
import { toggleHabit } from "../server-actions"

/**
 * The round check for a habit: fills with the accent and pops when done. 44px
 * to the thumb on phones, the circle itself stays 24px.
 */
export function HabitCheck({
  checked,
  onToggle,
  label,
  disabled,
  className,
}: {
  checked: boolean
  onToggle: () => void
  label: string
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={cn(
        "group/check -m-2 flex size-11 shrink-0 items-center justify-center rounded-full outline-none disabled:opacity-60",
        "focus-visible:[&>span]:ring-3 focus-visible:[&>span]:ring-ring/50",
        className,
      )}
    >
      <span
        key={checked ? "on" : "off"}
        className={cn(
          "flex size-6 items-center justify-center rounded-full border-[1.5px] transition-colors duration-150",
          checked
            ? "animate-pop border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/45 group-hover/check:border-accent-500 group-hover/check:bg-accent-500/10",
        )}
      >
        <svg viewBox="0 0 16 16" aria-hidden className={cn("size-3.5", !checked && "opacity-0 group-hover/check:opacity-40")}>
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  )
}

/** "🔥 5": the current streak, muted at zero. */
export function StreakBadge({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn("text-caption inline-flex shrink-0 items-center gap-0.5 tabular-nums", value > 0 ? "text-text-accent" : "text-muted-foreground", className)}
      aria-label={`${value} day streak`}
      title={`${value} day streak`}
    >
      <Flame className="size-3.5" />
      {value}
    </span>
  )
}

type Override = { done: boolean; current: number }

/**
 * Optimistic check-offs: the tick shows at once, the streak follows the
 * server's answer, and a failed write puts it back with the reason.
 */
export function useHabitToggle() {
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [, start] = useTransition()

  function key(id: string, date?: string) {
    return date ? `${id}:${date}` : id
  }

  function stateOf<T extends { id: string; done: boolean; current: number }>(habit: T, date?: string): Override {
    return overrides[key(habit.id, date)] ?? { done: habit.done, current: habit.current }
  }

  function toggle(habit: { id: string; name: string; done: boolean; current: number }, date?: string) {
    const k = key(habit.id, date)
    const before = overrides[k] ?? { done: habit.done, current: habit.current }
    const done = !before.done
    setOverrides((prev) => ({ ...prev, [k]: { done, current: Math.max(0, before.current + (done ? 1 : -1)) } }))
    start(async () => {
      const result = await toggleHabit({ id: habit.id, date })
      if (!result.ok) {
        setOverrides((prev) => ({ ...prev, [k]: before }))
        toast.error(result.error)
        return
      }
      setOverrides((prev) => ({ ...prev, [k]: { done: result.value.done, current: result.value.current } }))
    })
  }

  return { stateOf, toggle }
}
