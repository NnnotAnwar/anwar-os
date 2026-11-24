// The palette and the phone search sheet are mounted once in the shell; any
// button can open them through these events instead of sharing React context
// across Suspense boundaries.
export const OPEN_PALETTE_EVENT = "anwar:open-palette"
export const OPEN_SEARCH_EVENT = "anwar:open-search"

// Both stream in behind Suspense, after the header's buttons work. A tap that
// arrives before its listener is kept and delivered when the listener mounts,
// instead of being lost on a slow phone.
const listening = new Set<string>()
const pending = new Set<string>()

function request(event: string) {
  if (listening.has(event)) window.dispatchEvent(new Event(event))
  else pending.add(event)
}

/** Subscribes `handler` to `event`, and runs it once if a request came in before. */
export function listenFor(event: string, handler: () => void) {
  window.addEventListener(event, handler)
  listening.add(event)
  if (pending.delete(event)) queueMicrotask(handler)
  return () => {
    window.removeEventListener(event, handler)
    listening.delete(event)
  }
}

export function openCommandPalette() {
  request(OPEN_PALETTE_EVENT)
}

/** Phones: the full-screen search sheet. */
export function openSearchSheet() {
  request(OPEN_SEARCH_EVENT)
}
