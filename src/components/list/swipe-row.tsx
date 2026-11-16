"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import type { AppIcon } from "@/components/icons"
import { cn } from "@/lib/utils"
import { isArmed, lockAxis, resist, restingOffset, settle, SWIPE, type Settle } from "./swipe"

export type RowAction = {
  id: string
  label: string
  icon: AppIcon
  /** Colour of the swipe button; the menu shows destructive ones in red. */
  tone?: "destructive" | "accent" | "neutral" | "warning"
  onSelect: () => void
  /** Keyboard shortcut shown in the menu, e.g. "P" or "⌫". */
  shortcut?: string
}

const toneClass: Record<NonNullable<RowAction["tone"]>, string> = {
  destructive: "bg-destructive text-white",
  accent: "bg-primary text-primary-foreground",
  neutral: "bg-ink-soft text-white",
  warning: "bg-amber-500 text-white",
}

// One open row at a time, like Mail: opening another closes this one.
let openRow: { owner: object; close: () => void } | null = null

/**
 * A list row you can swipe on touch screens. Swipe left for the trailing
 * actions (a long swipe runs the first one), right for the leading action.
 * Mouse and keyboard users get the same actions from the row menu and keys,
 * so this only listens to touch and pen.
 */
export function SwipeRow({
  leading,
  trailing = [],
  fullSwipe = true,
  disabled,
  className,
  children,
}: {
  leading?: RowAction
  /** trailing[0] sits at the edge and runs on a long swipe. */
  trailing?: RowAction[]
  fullSwipe?: boolean
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  const content = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const gesture = useRef<{
    id: number
    x: number
    y: number
    t: number
    lastX: number
    lastT: number
    base: number
    axis: "x" | "y" | null
    from: Settle
  } | null>(null)
  const offset = useRef(0)
  const state = useRef<Settle>("closed")
  const dragged = useRef(false)
  const owner = useRef({})
  const [shown, setShown] = useState<"none" | "leading" | "trailing">("none")
  const [armed, setArmed] = useState<"leading" | "trailing" | null>(null)
  const [animating, setAnimating] = useState(false)

  const trailingWidth = trailing.length * SWIPE.actionWidth
  const leadingWidth = leading ? SWIPE.actionWidth : 0

  const paint = useCallback((x: number, animate: boolean) => {
    offset.current = x
    const el = content.current
    if (!el) return
    setAnimating(animate)
    el.style.transform = x === 0 ? "" : `translate3d(${x}px,0,0)`
    setShown(x < 0 ? "trailing" : x > 0 ? "leading" : "none")
  }, [])

  const close = useCallback(() => {
    state.current = "closed"
    setArmed(null)
    paint(0, true)
    if (openRow?.owner === owner.current) openRow = null
  }, [paint])

  useEffect(() => () => {
    if (openRow?.owner === owner.current) openRow = null
  }, [close])

  function onPointerDown(e: React.PointerEvent) {
    if (disabled || e.pointerType === "mouse" || !e.isPrimary) return
    if (openRow && openRow.owner !== owner.current) openRow.close()
    gesture.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      lastX: e.clientX,
      lastT: e.timeStamp,
      base: offset.current,
      axis: null,
      from: state.current,
    }
    dragged.current = false
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (!g.axis) {
      g.axis = lockAxis(dx, dy)
      if (g.axis === "y") {
        gesture.current = null
        return
      }
      if (g.axis === "x") {
        dragged.current = true
        root.current?.setPointerCapture(e.pointerId)
      } else return
    }
    const width = root.current?.offsetWidth ?? 0
    const raw = g.base + dx
    const x = raw < 0 ? resist(raw, trailingWidth ? width : 0) : resist(raw, leadingWidth ? width : 0)
    paint(x, false)
    const nextArmed = isArmed(x, width, "trailing", fullSwipe && trailingWidth > 0)
      ? "trailing"
      : isArmed(x, width, "leading", fullSwipe && leadingWidth > 0)
        ? "leading"
        : null
    if (nextArmed !== armed) {
      setArmed(nextArmed)
      if (nextArmed) navigator.vibrate?.(8)
    }
    g.lastX = e.clientX
    g.lastT = e.timeStamp
  }

  function onPointerEnd(e: React.PointerEvent) {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    gesture.current = null
    if (g.axis !== "x") return
    const width = root.current?.offsetWidth ?? 0
    const dt = Math.max(1, e.timeStamp - g.lastT)
    const velocity = e.timeStamp - g.lastT < 80 ? (e.clientX - g.lastX) / dt : 0
    const next = settle({
      offset: offset.current,
      velocity,
      rowWidth: width,
      trailingWidth,
      leadingWidth,
      fullTrailing: fullSwipe,
      fullLeading: fullSwipe,
      from: g.from,
    })
    state.current = next
    setArmed(null)
    if (next === "full-trailing" || next === "full-leading") {
      const action = next === "full-trailing" ? trailing[0] : leading
      paint(restingOffset(next, trailingWidth, leadingWidth, width), true)
      // Let the row slide out, then act; the list removes or updates it.
      window.setTimeout(() => {
        action?.onSelect()
        state.current = "closed"
        paint(0, false)
      }, 180)
      return
    }
    paint(restingOffset(next, trailingWidth, leadingWidth, width), true)
    if (next === "closed") {
      if (openRow?.owner === owner.current) openRow = null
    } else openRow = { owner: owner.current, close }
  }

  function run(action: RowAction) {
    close()
    action.onSelect()
  }

  return (
    <div
      ref={root}
      className={cn("relative touch-pan-y overflow-hidden", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={(e) => {
        // A swipe is not a tap; a tap on an open row just closes it.
        if (dragged.current || state.current !== "closed") {
          e.preventDefault()
          e.stopPropagation()
          dragged.current = false
          if (state.current !== "closed") close()
        }
      }}
    >
      {leading && shown === "leading" && (
        <div className="absolute inset-y-0 left-0 flex w-full" aria-hidden>
          <SwipeButton action={leading} grow={armed === "leading"} onRun={run} />
        </div>
      )}
      {trailing.length > 0 && shown === "trailing" && (
        <div className="absolute inset-y-0 right-0 flex w-full justify-end" aria-hidden>
          {[...trailing].reverse().map((action, i, all) => (
            <SwipeButton
              key={action.id}
              action={action}
              grow={armed === "trailing" && i === all.length - 1}
              hide={armed === "trailing" && i !== all.length - 1}
              onRun={run}
            />
          ))}
        </div>
      )}
      <div
        ref={content}
        className={cn(
          "relative",
          // Opaque while moved, so the actions don't show through the glass.
          shown !== "none" && "bg-popover",
          animating && "transition-transform duration-(--duration-move) ease-(--ease-out) motion-reduce:transition-none",
        )}
        onTransitionEnd={() => setAnimating(false)}
      >
        {children}
      </div>
    </div>
  )
}

function SwipeButton({
  action,
  grow,
  hide,
  onRun,
}: {
  action: RowAction
  grow?: boolean
  hide?: boolean
  onRun: (action: RowAction) => void
}) {
  const Icon = action.icon
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={() => onRun(action)}
      className={cn(
        "text-caption flex shrink-0 flex-col items-center justify-center gap-1 font-medium transition-[width,flex-grow] duration-200 ease-(--ease-out)",
        toneClass[action.tone ?? "neutral"],
        grow ? "grow" : "w-[74px]",
        hide && "w-0 overflow-hidden",
      )}
    >
      <Icon className="size-5" />
      {action.label}
    </button>
  )
}
