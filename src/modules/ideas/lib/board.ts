// The ideas board: one column per status. Pure helpers, tested.
import { ideaStatuses, type Idea, type IdeaStatus } from "../schema"

/** Ideas grouped by status, every column present, newest first inside each. */
export function columns(ideas: Idea[]): Record<IdeaStatus, Idea[]> {
  const out = Object.fromEntries(ideaStatuses.map((s) => [s, [] as Idea[]])) as Record<IdeaStatus, Idea[]>
  for (const idea of ideas) out[idea.status].push(idea)
  for (const s of ideaStatuses) out[s].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return out
}

/**
 * Moves an idea to another column. It lands on top (it was just touched), and
 * nothing changes when it is dropped back where it came from.
 */
export function moveIdea(ideas: Idea[], id: string, status: IdeaStatus, now = new Date().toISOString()): Idea[] {
  return ideas.map((idea) => (idea.id === id && idea.status !== status ? { ...idea, status, updatedAt: now } : idea))
}

/** The column to the left (-1) or right (+1), clamped at the ends. */
export function neighbourStatus(status: IdeaStatus, dir: -1 | 1): IdeaStatus {
  const i = ideaStatuses.indexOf(status)
  return ideaStatuses[Math.min(ideaStatuses.length - 1, Math.max(0, i + dir))]!
}

/** The next stage in the pipeline (raw → exploring → building → shipped); null at the end. */
export function nextStage(status: IdeaStatus): IdeaStatus | null {
  const pipeline: IdeaStatus[] = ["raw", "exploring", "building", "shipped"]
  const i = pipeline.indexOf(status)
  return i >= 0 && i < pipeline.length - 1 ? pipeline[i + 1]! : null
}

/** Long-press before a touch drag starts, and how far a finger may wander meanwhile. */
export const TOUCH_HOLD_MS = 280
export const TOUCH_SLOP_PX = 8
/** A mouse drag starts after this much movement, so clicks still open the card. */
export const MOUSE_SLOP_PX = 4

/** Whether a pointer that went down at (x0, y0) has turned into a drag. */
export function startsDrag(
  pointer: "mouse" | "touch" | "pen",
  dx: number,
  dy: number,
  heldMs: number,
): "drag" | "wait" | "cancel" {
  const dist = Math.hypot(dx, dy)
  if (pointer === "mouse") return dist >= MOUSE_SLOP_PX ? "drag" : "wait"
  // Touch: moving before the hold is a scroll; holding still picks the card up.
  if (heldMs < TOUCH_HOLD_MS) return dist > TOUCH_SLOP_PX ? "cancel" : "wait"
  return "drag"
}
