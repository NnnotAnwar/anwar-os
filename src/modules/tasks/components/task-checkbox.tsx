"use client"

import { cn } from "@/lib/utils"
import type { TaskPriority } from "../schema"

/**
 * The round checkbox (Things / Reminders). Ticking fills it with the accent and
 * pops the check in (`animate-pop`); the row decides what happens next. The
 * button is 44px on phones for the thumb, the circle stays 20px.
 */
export function TaskCheckbox({
  checked,
  onToggle,
  label,
  priority = "none",
  className,
}: {
  checked: boolean
  onToggle: () => void
  label: string
  priority?: TaskPriority
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "group/check -m-2.5 flex size-11 shrink-0 items-center justify-center rounded-full outline-none md:-m-1.5 md:size-8",
        "focus-visible:[&>span]:ring-3 focus-visible:[&>span]:ring-ring/50",
        className,
      )}
    >
      <span
        key={checked ? "on" : "off"}
        className={cn(
          "flex size-5 items-center justify-center rounded-full border-[1.5px] transition-colors duration-150",
          checked
            ? "animate-pop border-primary bg-primary text-primary-foreground"
            : priority === "high"
              ? "border-accent-500 group-hover/check:bg-accent-500/10"
              : "border-muted-foreground/45 group-hover/check:border-accent-500 group-hover/check:bg-accent-500/10",
        )}
      >
        <svg viewBox="0 0 16 16" aria-hidden className={cn("size-3", !checked && "opacity-0 group-hover/check:opacity-40")}>
          <path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  )
}

/** "!!" / "!" before a title: a subtle accent mark, never a traffic light. */
export function PriorityMark({ priority }: { priority: TaskPriority }) {
  if (priority === "none") return null
  return (
    <span
      className={cn("text-body-strong shrink-0 tabular-nums", priority === "high" ? "text-text-accent" : "text-muted-foreground")}
      aria-label={priority === "high" ? "High priority" : "Low priority"}
      title={priority === "high" ? "High priority" : "Low priority"}
    >
      {priority === "high" ? "!!" : "!"}
    </span>
  )
}
