"use client"

import { useEffect, useRef, useState, useTransition, type KeyboardEvent, type PointerEvent } from "react"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, GripVertical, Pencil, RotateCcw } from "@/components/icons"
import { Sheet } from "@/components/sheet"
import { Button } from "@/components/ui/button"
import { resetTodayLayout, saveTodayLayout } from "@/core/preferences-actions"
import { moveTo, type TodayLayout } from "@/core/today-layout"
import { cn } from "@/lib/utils"

export type EditableWidget = { key: string; title: string; moduleName: string; hidden: boolean }

/**
 * "Edit Today": reorder the widgets (drag the handle, arrow buttons, or arrow
 * keys on the handle) and switch each on or off. One list for phone and
 * desktop; hidden widgets keep their place for when they come back. Saved for
 * the user (core_preferences), with Undo.
 */
export function EditToday({ items, defaultOrder }: { items: EditableWidget[]; defaultOrder: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-caption -my-3 flex items-center gap-1 rounded py-3 text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5"
      >
        <Pencil />
        Edit Today
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Edit Today"
        description="Drag a widget by its handle or use the arrows to move it. Switch off what you don't need."
      >
        {/* Mounted per opening: always starts from what's saved. */}
        {open && <Editor items={items} defaultOrder={defaultOrder} onDone={() => setOpen(false)} />}
      </Sheet>
    </>
  )
}

function Editor({ items, defaultOrder, onDone }: { items: EditableWidget[]; defaultOrder: string[]; onDone: () => void }) {
  const byKey = new Map(items.map((w) => [w.key, w]))
  const [order, setOrder] = useState(() => items.map((w) => w.key))
  const [hidden, setHidden] = useState(() => new Set(items.filter((w) => w.hidden).map((w) => w.key)))
  const [announcement, setAnnouncement] = useState("")
  const [dragging, setDragging] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // The latest order for event handlers (a drag moves several times between renders).
  const orderRef = useRef(order)
  const listRef = useRef<HTMLOListElement>(null)
  // A moved row's DOM node is re-inserted, which drops focus: put it back on
  // the control that moved it (or the handle, once that arrow hits the end).
  const [refocus, setRefocus] = useState<{ key: string; control: "handle" | "up" | "down" } | null>(null)
  useEffect(() => {
    if (!refocus || !listRef.current) return
    const row = listRef.current.querySelector(`[data-row="${CSS.escape(refocus.key)}"]`)
    const wanted = row?.querySelector<HTMLButtonElement>(`[data-control="${refocus.control}"]`)
    const target = wanted && !wanted.disabled ? wanted : row?.querySelector<HTMLButtonElement>('[data-control="handle"]')
    target?.focus()
  }, [refocus, order])

  const changed =
    order.some((key, i) => key !== items[i]?.key) || items.some((w) => w.hidden !== hidden.has(w.key))
  const isDefault = hidden.size === 0 && order.every((key, i) => key === defaultOrder[i])

  function title(key: string) {
    return byKey.get(key)?.title ?? key
  }

  function move(key: string, to: number, announce = true) {
    const current = orderRef.current
    const from = current.indexOf(key)
    const target = Math.max(0, Math.min(current.length - 1, to))
    if (from === -1 || from === target) return
    const next = moveTo(current, from, target)
    orderRef.current = next
    setOrder(next)
    if (announce) setAnnouncement(`${title(key)}: position ${target + 1} of ${next.length}`)
  }

  function toggle(key: string, show: boolean) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (show) next.delete(key)
      else next.add(key)
      return next
    })
    setAnnouncement(`${title(key)} ${show ? "shown" : "hidden"}`)
  }

  function onHandleKey(e: KeyboardEvent, key: string) {
    const at = orderRef.current.indexOf(key)
    const to = { ArrowUp: at - 1, ArrowDown: at + 1, Home: 0, End: orderRef.current.length - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    move(key, to)
    setRefocus({ key, control: "handle" })
  }

  // Pointer drag (mouse and touch): the row follows the finger in whole slots,
  // swapping with a neighbour once the pointer passes that neighbour's middle.
  // Moves are tracked on the window: re-ordering moves the row's DOM node, which
  // would release a pointer capture on the handle.
  const endDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => endDrag.current?.(), [])

  function onPointerDown(e: PointerEvent<HTMLButtonElement>, key: string) {
    if (e.button !== 0) return
    e.preventDefault()
    endDrag.current?.()
    setDragging(key)
    const onMove = (event: globalThis.PointerEvent) => dragTo(key, event.clientY)
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onEnd)
      window.removeEventListener("pointercancel", onEnd)
      endDrag.current = null
      setDragging(null)
      setAnnouncement(`${title(key)}: position ${orderRef.current.indexOf(key) + 1} of ${orderRef.current.length}`)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onEnd)
    window.addEventListener("pointercancel", onEnd)
    endDrag.current = onEnd
  }

  function dragTo(key: string, y: number) {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"]`)
    if (!row?.parentElement) return
    const at = orderRef.current.indexOf(key)
    // Wait for the list to catch up with the last move before judging the next one.
    if ([...row.parentElement.children].indexOf(row) !== at) return
    const middle = (el: Element | null) => {
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return rect.top + rect.height / 2
    }
    const below = middle(row.nextElementSibling)
    const above = middle(row.previousElementSibling)
    if (below !== null && y > below) move(key, at + 1, false)
    else if (above !== null && y < above) move(key, at - 1, false)
  }

  function reset() {
    const next = defaultOrder.filter((key) => byKey.has(key))
    orderRef.current = next
    setOrder(next)
    setHidden(new Set())
    setAnnouncement("Back to the default order, everything shown")
  }

  function save() {
    const layout: TodayLayout = { order, hidden: order.filter((key) => hidden.has(key)) }
    startTransition(async () => {
      try {
        const { previous } = isDefault ? await resetTodayLayout() : await saveTodayLayout(layout)
        onDone()
        toast.success("Today updated", {
          action: {
            label: "Undo",
            onClick: () => {
              saveTodayLayout(previous).catch(() => toast.error("Couldn't undo. Edit Today again."))
            },
          },
        })
      } catch {
        toast.error("Couldn't save. Try again.")
      }
    })
  }

  const shown = order.length - hidden.size

  return (
    <div className="grid gap-3 px-4 pt-3 pb-4">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <p id="edit-today-keys" className="sr-only">
        Use the arrow keys on a handle to move a widget, Home and End to send it to the top or bottom.
      </p>
      <ol ref={listRef} aria-label="Today widgets" className="grid gap-1.5">
        {order.map((key, index) => {
          const w = byKey.get(key)!
          const visible = !hidden.has(key)
          return (
            <li
              key={key}
              data-row={key}
              className={cn(
                "flex items-center gap-1 rounded-lg border border-field-border bg-field py-1 pr-2 pl-1 transition-[opacity,box-shadow]",
                !visible && "opacity-60",
                dragging === key && "relative z-10 shadow-lg ring-2 ring-accent-500/40",
              )}
            >
              <button
                type="button"
                aria-label={`Move ${w.title}`}
                aria-describedby="edit-today-keys"
                data-control="handle"
                onKeyDown={(e) => onHandleKey(e, key)}
                onPointerDown={(e) => onPointerDown(e, key)}
                className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing md:size-9 [&_svg]:size-4"
              >
                <GripVertical />
              </button>
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-body-strong">{w.title}</span>
                <span className="truncate text-caption text-muted-foreground">
                  {w.moduleName}
                  {!visible && " · hidden"}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 md:size-8"
                aria-label={`Move ${w.title} up`}
                data-control="up"
                disabled={index === 0}
                onClick={() => {
                  move(key, index - 1)
                  setRefocus({ key, control: "up" })
                }}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 md:size-8"
                aria-label={`Move ${w.title} down`}
                data-control="down"
                disabled={index === order.length - 1}
                onClick={() => {
                  move(key, index + 1)
                  setRefocus({ key, control: "down" })
                }}
              >
                <ArrowDown />
              </Button>
              <label className="relative ml-1 inline-flex min-h-11 shrink-0 cursor-pointer items-center md:min-h-8">
                <input
                  type="checkbox"
                  role="switch"
                  checked={visible}
                  onChange={(e) => toggle(key, e.target.checked)}
                  aria-label={`Show ${w.title}`}
                  className="peer h-5 w-9 cursor-pointer appearance-none rounded-full bg-muted-foreground/30 transition-colors outline-none checked:bg-primary focus-visible:ring-3 focus-visible:ring-accent-500/40"
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4"
                />
              </label>
            </li>
          )
        })}
      </ol>
      <p className="text-caption text-muted-foreground">
        {shown === order.length ? "All widgets shown." : `${shown} of ${order.length} shown.`} New widgets from your
        services appear at the end.
      </p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="button" variant="ghost" className="h-11 md:h-9" onClick={reset} disabled={isDefault || pending}>
          <RotateCcw />
          Reset to default
        </Button>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" className="h-11 md:h-9" onClick={save} disabled={!changed || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  )
}
