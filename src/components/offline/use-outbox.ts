"use client"

import { useSyncExternalStore } from "react"
import { getOutboxState, getServerOutboxState, itemsFor, subscribeOutbox, type OutboxState } from "@/lib/offline/client"
import type { OutboxItem, OutboxKind } from "@/lib/offline/outbox"

/** The outbox as React state (src/lib/offline/client.ts). */
export function useOutbox(): OutboxState {
  return useSyncExternalStore(subscribeOutbox, getOutboxState, getServerOutboxState)
}

/** The signed-in user's items, optionally of some kinds only. */
export function useOutboxItems(kinds?: readonly OutboxKind[]): OutboxItem[] {
  const state = useOutbox()
  const mine = itemsFor(state)
  return kinds ? mine.filter((item) => kinds.includes(item.kind)) : mine
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange)
  window.addEventListener("offline", onChange)
  return () => {
    window.removeEventListener("online", onChange)
    window.removeEventListener("offline", onChange)
  }
}

/** navigator.onLine as state (true on the server and during hydration). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
}
