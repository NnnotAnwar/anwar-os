import { describe, expect, it } from "vitest"
import { arrangeWidgets, EMPTY_LAYOUT, isDefaultLayout, moveKey, moveTo, normalizeLayout } from "./today-layout"

const registry = ["tasks:due", "calendar:today", "budget:month", "notes:recent"]

describe("arrangeWidgets", () => {
  it("is the registry order without a saved layout", () => {
    expect(arrangeWidgets(registry, EMPTY_LAYOUT)).toEqual({ ordered: registry, visible: registry, hidden: [] })
    expect(isDefaultLayout(registry, EMPTY_LAYOUT)).toBe(true)
  })

  it("puts saved keys first, appends new widgets, ignores unknown and duplicate ids", () => {
    const layout = { order: ["budget:month", "gone:widget", "tasks:due", "budget:month"], hidden: ["notes:recent", "gone:other"] }
    expect(arrangeWidgets(registry, layout)).toEqual({
      ordered: ["budget:month", "tasks:due", "calendar:today", "notes:recent"],
      visible: ["budget:month", "tasks:due", "calendar:today"],
      hidden: ["notes:recent"],
    })
    expect(normalizeLayout(registry, layout)).toEqual({
      order: ["budget:month", "tasks:due", "calendar:today", "notes:recent"],
      hidden: ["notes:recent"],
    })
    expect(isDefaultLayout(registry, layout)).toBe(false)
  })

  it("shows a module's new widget even when everything else was hidden", () => {
    const layout = { order: registry, hidden: registry }
    expect(arrangeWidgets([...registry, "habits:today"], layout).visible).toEqual(["habits:today"])
  })
})

describe("moving", () => {
  it("moves by one and clamps at the ends", () => {
    expect(moveKey(registry, "budget:month", -1)).toEqual(["tasks:due", "budget:month", "calendar:today", "notes:recent"])
    expect(moveKey(registry, "tasks:due", -1)).toEqual(registry)
    expect(moveKey(registry, "notes:recent", 1)).toEqual(registry)
    expect(moveKey(registry, "missing", 1)).toEqual(registry)
  })

  it("moves to an index", () => {
    expect(moveTo(registry, 0, 3)).toEqual(["calendar:today", "budget:month", "notes:recent", "tasks:due"])
    expect(moveTo(registry, 3, 0)).toEqual(["notes:recent", "tasks:due", "calendar:today", "budget:month"])
    expect(moveTo(registry, 9, 0)).toEqual(registry)
  })
})
