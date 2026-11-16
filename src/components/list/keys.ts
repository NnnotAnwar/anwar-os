// Keyboard map for list pages (Gmail / Linear style). Pure, so it is tested.

export type ListCommand =
  | "next"
  | "prev"
  | "first"
  | "last"
  | "open"
  | "edit"
  | "new"
  | "filter"
  | "select"
  | "selectAll"
  | "delete"
  | "pin"
  | "quickLook"
  | "escape"

export type KeyLike = {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

/** Which command a key press means on a list page, or null to let it through. */
export function listCommand(e: KeyLike): ListCommand | null {
  if (e.altKey) return null
  if (e.metaKey || e.ctrlKey) {
    // ⌘A selects every row; ⌘⌫ deletes like Finder.
    if (e.key.toLowerCase() === "a") return "selectAll"
    if (e.key === "Backspace" || e.key === "Delete") return "delete"
    return null
  }
  switch (e.key) {
    case "j":
    case "ArrowDown":
      return "next"
    case "k":
    case "ArrowUp":
      return "prev"
    case "Home":
      return "first"
    case "End":
      return "last"
    case "Enter":
    case "o":
      return "open"
    case "e":
      return "edit"
    case "n":
    case "c":
      return "new"
    case "/":
      return "filter"
    case "x":
      return "select"
    case "Delete":
    case "Backspace":
    case "#":
      return "delete"
    case "p":
      return "pin"
    case " ":
      return "quickLook"
    case "Escape":
      return "escape"
    default:
      return null
  }
}

/** Moves the cursor, clamped to the list; -1 means "nothing active yet". */
export function step(active: number, count: number, command: "next" | "prev" | "first" | "last"): number {
  if (count === 0) return -1
  switch (command) {
    case "first":
      return 0
    case "last":
      return count - 1
    case "next":
      return active < 0 ? 0 : Math.min(count - 1, active + 1)
    case "prev":
      return active < 0 ? 0 : Math.max(0, active - 1)
  }
}

/** True when the key press happens in a field, where single letters are text. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
}

/** Shift-click selection: everything between the anchor and the clicked row. */
export function rangeBetween(ids: string[], anchor: string | null, target: string): string[] {
  const to = ids.indexOf(target)
  const from = anchor === null ? -1 : ids.indexOf(anchor)
  if (to < 0) return []
  if (from < 0) return [target]
  const [a, b] = from < to ? [from, to] : [to, from]
  return ids.slice(a, b + 1)
}
