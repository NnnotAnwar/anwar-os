"use client"

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import { CalendarDays, Check, GripVertical, Repeat, TextAlignLeft } from "@/components/icons"
import { cn } from "@/lib/utils"
import { dueLabel, repeatLabel } from "../lib/format"
import type { Task } from "../schema"
import { PriorityMark, TaskCheckbox } from "./task-checkbox"

export type RowState = "idle" | "checked" | "leaving"

const SWIPE_COMMIT = 84

export type TaskRowProps = {
  task: Task
  state: RowState
  today: string
  locale: string
  listName: string | null
  showDue: boolean
  focused: boolean
  editing: boolean
  onFocusRow: () => void
  onToggle: () => void
  onOpen: () => void
  onSchedule: () => void
  onStartRename: () => void
  /** The new title, or null when the rename was cancelled or unchanged. */
  onRename: (title: string | null) => void
  /** Lists view: the grip that starts a drag. */
  grip?: { onPointerDown: (e: ReactPointerEvent) => void; dragging: boolean }
  style?: CSSProperties
}

/**
 * One task. Tap opens the details; the checkbox completes it. On phones,
 * swipe right to complete and left to schedule. Keyboard handling lives in
 * the list (it knows the neighbours); the row only renders focus.
 */
export function TaskRow(props: TaskRowProps) {
  const { task, state, today, locale, showDue, listName, focused, editing, grip } = props
  const rowRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const swipe = useRef<{ x: number; y: number; id: number; axis: "x" | "y" | null; dx: number } | null>(null)
  const [reveal, setReveal] = useState<"complete" | "schedule" | null>(null)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (focused && !editing && document.activeElement !== rowRef.current && !rowRef.current?.contains(document.activeElement)) {
      rowRef.current?.focus({ preventScroll: false })
    }
  }, [focused, editing])

  const checked = state !== "idle" || task.doneAt !== null
  const due = task.dueDate && showDue ? dueLabel(task.dueDate, today, locale) : null
  const repeat = task.rrule ? repeatLabel(task.rrule, locale) : null

  function onPointerDown(e: ReactPointerEvent) {
    if (e.pointerType === "mouse" || editing) return
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId, axis: null, dx: 0 }
  }

  function onPointerMove(e: ReactPointerEvent) {
    const s = swipe.current
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (!s.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y"
      if (s.axis === "x") rowRef.current?.setPointerCapture(e.pointerId)
    }
    if (s.axis !== "x") return
    // Resist past the commit point so it feels like a detent.
    const limit = SWIPE_COMMIT * 1.6
    const eased = Math.sign(dx) * Math.min(Math.abs(dx), limit + (Math.abs(dx) - limit) * 0.2)
    s.dx = eased
    if (contentRef.current) {
      contentRef.current.style.transition = "none"
      contentRef.current.style.transform = `translateX(${eased}px)`
    }
    setReveal(dx > 0 ? "complete" : "schedule")
    const isArmed = Math.abs(dx) >= SWIPE_COMMIT
    if (isArmed !== armed) {
      setArmed(isArmed)
      if (isArmed) navigator.vibrate?.(8)
    }
  }

  function onPointerEnd() {
    const s = swipe.current
    swipe.current = null
    if (!s || s.axis !== "x") return
    const el = contentRef.current
    if (el) {
      el.style.transition = "transform 260ms var(--ease-out)"
      el.style.transform = ""
    }
    setArmed(false)
    setTimeout(() => setReveal(null), 260)
    if (s.dx >= SWIPE_COMMIT) props.onToggle()
    else if (s.dx <= -SWIPE_COMMIT) props.onSchedule()
  }

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
        state === "leaving" ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
      )}
      style={props.style}
    >
      <div className="relative min-h-0 overflow-hidden">
        {reveal && (
          <div
            aria-hidden
            className={cn(
              "absolute inset-0 flex items-center px-5 text-sm font-semibold transition-colors",
              reveal === "complete" ? "justify-start" : "justify-end",
              armed ? "bg-primary text-primary-foreground" : "bg-accent-500/15 text-text-accent",
            )}
          >
            {reveal === "complete" ? (
              <span className="flex items-center gap-1.5">
                <Check className="size-4" /> {task.doneAt ? "Restore" : "Complete"}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                Schedule <CalendarDays className="size-4" />
              </span>
            )}
          </div>
        )}
        <div
          ref={rowRef}
          role="listitem"
          tabIndex={focused ? 0 : -1}
          data-task-row={task.id}
          aria-label={task.title}
          onFocus={(e) => {
            if (e.target === e.currentTarget) props.onFocusRow()
          }}
          onClick={() => {
            if (!editing) props.onOpen()
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          className={cn(
            "relative cursor-default touch-pan-y outline-none select-none",
            "focus-visible:[&>div]:bg-accent-500/10 focus-visible:[&>div]:ring-2 focus-visible:[&>div]:ring-accent-500/40 focus-visible:[&>div]:ring-inset",
            grip?.dragging && "z-10",
          )}
        >
          <div
            ref={contentRef}
            className={cn(
              "flex min-h-12 items-start gap-3 bg-[var(--row-bg,transparent)] px-3 py-2.5 transition-colors hover:bg-white/45 dark:hover:bg-white/5",
              grip?.dragging && "glass glass-menu rounded-lg shadow-lg",
            )}
          >
            <TaskCheckbox
              checked={checked}
              onToggle={props.onToggle}
              priority={task.priority}
              label={checked ? `Mark “${task.title}” as not done` : `Complete “${task.title}”`}
              className="mt-px"
            />
            <div className="grid min-w-0 flex-1 gap-0.5 pt-px">
              {editing ? (
                <RenameField title={task.title} onDone={props.onRename} />
              ) : (
                <p
                  className={cn(
                    "text-body flex min-w-0 items-baseline gap-1.5 transition-colors duration-200",
                    checked && "text-muted-foreground line-through decoration-muted-foreground/50",
                  )}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    props.onStartRename()
                  }}
                >
                  <PriorityMark priority={task.priority} />
                  <span className="min-w-0 break-words">{task.title}</span>
                </p>
              )}
              <Meta
                due={due}
                time={task.dueTime}
                listName={listName}
                repeat={repeat}
                hasNotes={task.notes.trim().length > 0}
              />
            </div>
            {grip && (
              <button
                type="button"
                aria-label={`Drag to reorder “${task.title}”. With the row focused, Alt and the arrow keys move it.`}
                tabIndex={-1}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  grip.onPointerDown(e)
                }}
                onClick={(e) => e.stopPropagation()}
                className="-my-1 -mr-1 flex size-10 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground/60 hover:bg-track hover:text-foreground active:cursor-grabbing md:size-8"
              >
                <GripVertical className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Meta({
  due,
  time,
  listName,
  repeat,
  hasNotes,
}: {
  due: { text: string; tone: string } | null
  time: string | null
  listName: string | null
  repeat: string | null
  hasNotes: boolean
}) {
  const parts: React.ReactNode[] = []
  if (due) {
    parts.push(
      <span key="due" className={cn(due.tone === "overdue" && "font-semibold text-warning-text", due.tone === "today" && "text-text-accent")}>
        {due.text}
        {time && ` ${time}`}
      </span>,
    )
  } else if (time) {
    parts.push(
      <span key="time" className="tabular-nums">
        {time}
      </span>,
    )
  }
  if (listName) parts.push(<span key="list">{listName}</span>)
  if (repeat)
    parts.push(
      <span key="repeat" className="inline-flex items-center gap-1" title={repeat}>
        <Repeat className="size-3" aria-hidden />
        <span className="sr-only md:not-sr-only">{repeat}</span>
      </span>,
    )
  if (hasNotes)
    parts.push(
      <span key="notes" title="Has notes">
        <TextAlignLeft className="size-3" aria-label="Has notes" />
      </span>,
    )
  if (!parts.length) return null
  return (
    <p className="text-caption flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-muted-foreground tabular-nums">
      {parts.flatMap((p, i) => (i === 0 ? [p] : [<span key={`dot-${i}`} aria-hidden>·</span>, p]))}
    </p>
  )
}

function RenameField({ title, onDone }: { title: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(title)
  const done = useRef(false)
  function finish(next: string | null) {
    if (done.current) return
    done.current = true
    onDone(next)
  }
  return (
    <input
      autoFocus
      value={value}
      maxLength={300}
      aria-label="Task title"
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          finish(value.trim() && value.trim() !== title ? value.trim() : null)
        } else if (e.key === "Escape") {
          e.preventDefault()
          finish(null)
        }
        e.stopPropagation()
      }}
      onBlur={() => finish(value.trim() && value.trim() !== title ? value.trim() : null)}
      className="text-body -mx-1 -my-0.5 rounded-md border border-accent-500 bg-field px-1 py-0.5 outline-none ring-3 ring-accent-500/20"
    />
  )
}
