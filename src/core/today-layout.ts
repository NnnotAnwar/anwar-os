// The owner's Today layout: which widgets show, in what order. Pure, so the
// server (rendering Today), the editor and the tests share it.
//
// Contract for modules: a widget is `${module.id}:${widget.id}` from the
// manifests' `widgets`. Nothing else is registered here, so a widget a module
// adds later just appears (at the end, after the saved ones); one that's gone
// is ignored and dropped on the next save.

export type TodayLayout = {
  /** Saved order of widget keys; may contain keys that no longer exist. */
  order: readonly string[]
  /** Saved hidden widget keys; may contain keys that no longer exist. */
  hidden: readonly string[]
}

export const EMPTY_LAYOUT: TodayLayout = { order: [], hidden: [] }

/**
 * Orders the available widgets (registry order = default) by the saved layout:
 * saved keys first in their saved order, then any new ones in registry order.
 */
export function arrangeWidgets(available: readonly string[], layout: TodayLayout) {
  const known = new Set(available)
  const saved = [...new Set(layout.order)].filter((key) => known.has(key))
  const placed = new Set(saved)
  const ordered = [...saved, ...available.filter((key) => !placed.has(key))]
  const hidden = new Set(layout.hidden.filter((key) => known.has(key)))
  return {
    ordered,
    visible: ordered.filter((key) => !hidden.has(key)),
    hidden: ordered.filter((key) => hidden.has(key)),
  }
}

/** What to save: only keys that exist now, each once. */
export function normalizeLayout(available: readonly string[], layout: TodayLayout): TodayLayout {
  const { ordered, hidden } = arrangeWidgets(available, layout)
  return { order: ordered, hidden }
}

/** Moves `key` by `delta` places (−1 up, +1 down); clamps at the ends. */
export function moveKey(order: readonly string[], key: string, delta: number): string[] {
  const from = order.indexOf(key)
  if (from === -1) return [...order]
  const to = Math.max(0, Math.min(order.length - 1, from + delta))
  return moveTo(order, from, to)
}

/** Moves the item at `from` to index `to`. */
export function moveTo(order: readonly string[], from: number, to: number): string[] {
  const next = [...order]
  if (from === to || from < 0 || from >= next.length) return next
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item!)
  return next
}

export function isDefaultLayout(available: readonly string[], layout: TodayLayout) {
  const { ordered, hidden } = arrangeWidgets(available, layout)
  return hidden.length === 0 && ordered.every((key, i) => key === available[i])
}
