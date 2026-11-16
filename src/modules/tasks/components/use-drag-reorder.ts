"use client"

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"

type Drag = { id: string; from: number; to: number; dy: number; height: number }

/**
 * Drag a row by its grip to reorder a list. Rows are measured once when the
 * drag starts; the others slide out of the way while the dragged one follows
 * the pointer. Dropping calls `onDrop` with the new order of ids.
 */
export function useDragReorder(ids: string[], onDrop: (ids: string[]) => void) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  function start(id: string, e: ReactPointerEvent) {
    if (e.button !== 0) return
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const rects = ids.map((rowId) => {
      const el = container.querySelector<HTMLElement>(`[data-task-row="${CSS.escape(rowId)}"]`)
      return el?.getBoundingClientRect() ?? null
    })
    const from = ids.indexOf(id)
    const self = rects[from]
    if (from < 0 || !self) return
    const centers = rects.map((r) => (r ? r.top + r.height / 2 : 0))
    const startY = e.clientY
    let current: Drag = { id, from, to: from, dy: 0, height: self.height }
    setDrag(current)

    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY
      const center = centers[from]! + dy
      let to = 0
      centers.forEach((c, i) => {
        if (i !== from && c < center) to++
      })
      current = { ...current, dy, to }
      setDrag(current)
      // Keep the pointer's row in view on long lists.
      if (ev.clientY < 80) window.scrollBy(0, -8)
      else if (ev.clientY > window.innerHeight - 80) window.scrollBy(0, 8)
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      setDrag(null)
      if (current.to !== current.from) {
        const next = [...ids]
        next.splice(current.to, 0, ...next.splice(current.from, 1))
        onDrop(next)
      }
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  function styleFor(id: string): CSSProperties | undefined {
    if (!drag) return undefined
    if (id === drag.id) return { transform: `translateY(${drag.dy}px)`, position: "relative", zIndex: 10 }
    const i = ids.indexOf(id)
    let shift = 0
    if (drag.from < drag.to && i > drag.from && i <= drag.to) shift = -drag.height
    if (drag.from > drag.to && i >= drag.to && i < drag.from) shift = drag.height
    return { transform: `translateY(${shift}px)`, transition: "transform 180ms var(--ease-out)" }
  }

  return { containerRef, start, styleFor, draggingId: drag?.id ?? null }
}
