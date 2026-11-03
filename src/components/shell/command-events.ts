// The palette is mounted once in the shell; any button can open it through this
// event instead of sharing React context across Suspense boundaries.
export const OPEN_PALETTE_EVENT = "anwar:open-palette"

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))
}
