"use client"

import { useCallback, useMemo, useState, type ReactNode } from "react"
import { Check, X } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { rangeBetween } from "./keys"

export type Selection = {
  active: boolean
  ids: Set<string>
  count: number
  has: (id: string) => boolean
  toggle: (id: string) => void
  /** Shift-click: selects from the last toggled row to this one. */
  extend: (id: string) => void
  selectAll: () => void
  start: (id?: string) => void
  done: () => void
}

/**
 * Multi-select for a list (Apple's "Select" mode): rows become checkable, a
 * bar with bulk actions slides up. Ids that leave the list drop out on their own.
 */
export function useSelection(allIds: string[]): Selection {
  const [active, setActive] = useState(false)
  const [raw, setRaw] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)

  const ids = useMemo(() => new Set(allIds.filter((id) => raw.has(id))), [allIds, raw])

  const toggle = useCallback((id: string) => {
    setActive(true)
    setAnchor(id)
    setRaw((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const extend = useCallback(
    (id: string) => {
      setActive(true)
      setRaw((prev) => new Set([...prev, ...rangeBetween(allIds, anchor, id)]))
      setAnchor(id)
    },
    [allIds, anchor],
  )

  return {
    active,
    ids,
    count: ids.size,
    has: (id) => ids.has(id),
    toggle,
    extend,
    selectAll: () => {
      setActive(true)
      setRaw(new Set(allIds))
    },
    start: (id) => {
      setActive(true)
      setRaw(id ? new Set([id]) : new Set())
      setAnchor(id ?? null)
    },
    done: () => {
      setActive(false)
      setRaw(new Set())
      setAnchor(null)
    },
  }
}

/** The round check shown at the start of a row while selecting. */
export function SelectCheck({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150",
        checked ? "animate-pop border-primary bg-primary text-primary-foreground" : "border-field-border bg-field",
        className,
      )}
    >
      {checked && <Check className="size-3" />}
    </span>
  )
}

/** "Select" / "Done" in the list's toolbar, like Mail and Files. */
export function SelectButton({ selection, disabled }: { selection: Selection; disabled?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="lg"
      disabled={disabled}
      aria-pressed={selection.active}
      onClick={() => (selection.active ? selection.done() : selection.start())}
      className="text-text-accent"
    >
      {selection.active ? "Done" : "Select"}
    </Button>
  )
}

/**
 * Bulk actions for the selected rows, floating above the tab bar on phones and
 * at the bottom of the window on desktop.
 */
export function BulkBar({
  selection,
  noun,
  total,
  children,
}: {
  selection: Selection
  /** e.g. ["note", "notes"] */
  noun: [string, string]
  total: number
  children: ReactNode
}) {
  if (!selection.active) return null
  const { count } = selection
  return (
    <div
      role="toolbar"
      aria-label="Selected items"
      className="glass glass-menu fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-xl animate-in items-center gap-1 rounded-xl p-1.5 shadow-(--shadow-glass-lg) duration-200 fade-in-0 slide-in-from-bottom-2 md:bottom-6 md:left-[calc(16rem+1.5rem)] motion-reduce:animate-none"
    >
      <Button variant="ghost" size="icon-lg" aria-label="Stop selecting" onClick={selection.done}>
        <X />
      </Button>
      <p className="text-meta min-w-0 flex-1 truncate tabular-nums" aria-live="polite">
        {count === 0 ? "Select items" : `${count} ${count === 1 ? noun[0] : noun[1]}`}
      </p>
      {count < total && (
        <Button variant="ghost" size="lg" onClick={selection.selectAll} className="max-sm:hidden">
          Select all
        </Button>
      )}
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}
