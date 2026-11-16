// Swipe-to-act maths (Apple Mail style), kept pure so the thresholds are tested.
// Offsets are in px: negative = the row moved left (trailing actions showing),
// positive = moved right (the leading action showing). Velocity is px/ms.

export const SWIPE = {
  /** Movement before the gesture commits to an axis. */
  lock: 10,
  /** Width of one revealed action button. */
  actionWidth: 74,
  /** Past this share of the row width, letting go runs the edge action. */
  fullRatio: 0.55,
  /** A flick at least this fast opens or closes regardless of distance. */
  flick: 0.45,
} as const

export type Axis = "x" | "y"

/** Which way the finger is going, once it has moved far enough to tell. */
export function lockAxis(dx: number, dy: number, lock: number = SWIPE.lock): Axis | null {
  if (Math.abs(dx) < lock && Math.abs(dy) < lock) return null
  // Horizontal wins only when clearly horizontal, so vertical scrolling stays easy.
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y"
}

/**
 * Rubber band past the end: the row keeps following the finger, ever slower,
 * like iOS. `limit` is where resistance starts (0 = no movement allowed).
 */
export function resist(offset: number, limit: number): number {
  const sign = Math.sign(offset)
  const abs = Math.abs(offset)
  if (limit <= 0) return sign * Math.min(abs, 24) * 0.35
  if (abs <= limit) return offset
  const over = abs - limit
  return sign * (limit + over * (1 / (1 + over / 120)))
}

export type Settle = "closed" | "open-trailing" | "open-leading" | "full-trailing" | "full-leading"

/** Whether letting go right now would run the edge action. */
export function isArmed(offset: number, rowWidth: number, side: "leading" | "trailing", enabled: boolean) {
  if (!enabled || rowWidth <= 0) return false
  const limit = rowWidth * SWIPE.fullRatio
  return side === "trailing" ? offset <= -limit : offset >= limit
}

/** Where the row comes to rest when the finger lifts. */
export function settle(input: {
  offset: number
  velocity: number
  rowWidth: number
  trailingWidth: number
  leadingWidth: number
  fullTrailing: boolean
  fullLeading: boolean
  /** Where the row was resting when this drag began. */
  from: Settle
}): Settle {
  const { offset, velocity, rowWidth, trailingWidth, leadingWidth, fullTrailing, fullLeading, from } = input

  if (isArmed(offset, rowWidth, "trailing", fullTrailing && trailingWidth > 0)) return "full-trailing"
  if (isArmed(offset, rowWidth, "leading", fullLeading && leadingWidth > 0)) return "full-leading"

  // A flick decides on its own: towards the actions opens, away closes.
  if (Math.abs(velocity) >= SWIPE.flick) {
    if (velocity < 0) {
      if (from === "open-leading" || offset > 0) return "closed"
      return trailingWidth > 0 ? "open-trailing" : "closed"
    }
    if (from === "open-trailing" || offset < 0) return "closed"
    return leadingWidth > 0 ? "open-leading" : "closed"
  }

  if (offset < 0 && trailingWidth > 0 && -offset >= trailingWidth / 2) return "open-trailing"
  if (offset > 0 && leadingWidth > 0 && offset >= leadingWidth / 2) return "open-leading"
  return "closed"
}

/** The resting offset for a state. */
export function restingOffset(state: Settle, trailingWidth: number, leadingWidth: number, rowWidth: number) {
  switch (state) {
    case "open-trailing":
      return -trailingWidth
    case "open-leading":
      return leadingWidth
    case "full-trailing":
      return -rowWidth
    case "full-leading":
      return rowWidth
    case "closed":
      return 0
  }
}
