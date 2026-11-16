"use client"

import { useSyncExternalStore } from "react"

// Items waiting for their Undo toast to expire, shared across pages: delete a
// note from its editor, land on the list, and it is already gone there too.

let snapshot: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const EMPTY: ReadonlySet<string> = new Set()

export const pendingRemovals = {
  add(id: string) {
    snapshot = new Set(snapshot).add(id)
    emit()
  },
  remove(id: string) {
    if (!snapshot.has(id)) return
    const next = new Set(snapshot)
    next.delete(id)
    snapshot = next
    emit()
  },
}

export function usePendingRemovals(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => snapshot,
    () => EMPTY,
  )
}
