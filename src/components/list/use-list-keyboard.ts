"use client"

import { useEffect, useRef, type RefObject } from "react"
import { isTypingTarget, listCommand, step, type ListCommand } from "./keys"
import type { Selection } from "./selection"

export type ListHandlers = Partial<
  Record<Exclude<ListCommand, "next" | "prev" | "first" | "last" | "filter" | "escape">, (id: string | null) => void>
>

/**
 * Keys for a list page. Rows are elements with `data-row-id`; the cursor is
 * simply the focused row, so the focus ring shows where you are and Enter on a
 * focused link opens it natively. J/K move, / focuses the filter, X selects,
 * Esc leaves selection; the rest is up to the page (open, edit, delete…).
 *
 * Never fires while typing, and leaves the shell's `g` + letter jumps alone.
 */
export function useListKeyboard({
  container,
  filter,
  selection,
  handlers,
  enabled = true,
}: {
  container: RefObject<HTMLElement | null>
  filter?: RefObject<HTMLInputElement | null>
  selection?: Selection
  handlers: ListHandlers
  enabled?: boolean
}) {
  const latest = useRef({ handlers, selection, filter })
  useEffect(() => {
    latest.current = { handlers, selection, filter }
  })

  useEffect(() => {
    if (!enabled) return
    let afterG = 0

    function rows() {
      return Array.from(container.current?.querySelectorAll<HTMLElement>("[data-row-id]") ?? [])
    }
    function focusRow(row: HTMLElement | undefined) {
      if (!row) return
      const target = row.querySelector<HTMLElement>("[data-row-primary]") ?? row
      target.focus({ preventScroll: true })
      target.scrollIntoView({ block: "nearest" })
    }

    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      // The shell's "g then a letter" jump: the letter after g is not ours.
      if (e.key === "g" && !e.metaKey && !e.ctrlKey) {
        afterG = e.timeStamp
        return
      }
      if (afterG && e.timeStamp - afterG < 1200) {
        afterG = 0
        return
      }
      if (document.querySelector("[role=dialog], [role=menu]")) return

      const command = listCommand(e)
      if (!command) return
      const { handlers, selection, filter } = latest.current
      const typing = isTypingTarget(e.target)

      if (typing) {
        // From the filter, ↓ / Esc hand over to the list.
        if (e.target === filter?.current && command === "next" && e.key === "ArrowDown") {
          e.preventDefault()
          focusRow(rows()[0])
        } else if (filter?.current && e.target === filter.current && command === "escape" && !filter.current.value) {
          filter.current.blur()
        }
        return
      }

      const list = rows()
      const current = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-row-id]") ?? null
      const index = current ? list.indexOf(current) : -1
      const id = current?.dataset.rowId ?? null

      switch (command) {
        case "next":
        case "prev":
        case "first":
        case "last": {
          // Arrows only drive the list once it has focus; elsewhere they scroll.
          if (e.key.startsWith("Arrow") && index < 0) return
          e.preventDefault()
          focusRow(list[step(index, list.length, command)])
          return
        }
        case "filter":
          if (!filter?.current) return
          e.preventDefault()
          // Stop the shell's "/" (global search): on a list page it filters the list.
          e.stopPropagation()
          filter.current.focus()
          filter.current.select()
          return
        case "escape":
          if (selection?.active) {
            e.preventDefault()
            selection.done()
          }
          return
        case "select":
          if (!selection || !id) return
          e.preventDefault()
          selection.toggle(id)
          return
        case "selectAll":
          if (!selection) return
          e.preventDefault()
          selection.selectAll()
          return
        case "open":
          // Enter on a focused link already opens it.
          if (e.key === "Enter" && document.activeElement?.matches("a, button")) return
          if (!id || !handlers.open) return
          e.preventDefault()
          handlers.open(id)
          return
        default: {
          const handler = handlers[command]
          if (!handler) return
          if (command !== "new" && !id && !(command === "delete" && selection?.count)) return
          e.preventDefault()
          handler(id)
        }
      }
    }

    // Capture, so "/" reaches the list before the shell's global search.
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [container, enabled])
}
