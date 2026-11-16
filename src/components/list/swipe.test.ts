import { describe, expect, it } from "vitest"
import { isArmed, lockAxis, resist, restingOffset, settle, SWIPE } from "./swipe"

const base = {
  velocity: 0,
  rowWidth: 360,
  trailingWidth: 2 * SWIPE.actionWidth,
  leadingWidth: SWIPE.actionWidth,
  fullTrailing: true,
  fullLeading: true,
  from: "closed" as const,
}

describe("lockAxis", () => {
  it("waits until the finger has moved", () => {
    expect(lockAxis(4, 3)).toBeNull()
  })
  it("locks horizontally only when clearly horizontal", () => {
    expect(lockAxis(-20, 4)).toBe("x")
    expect(lockAxis(12, 11)).toBe("y")
    expect(lockAxis(2, 30)).toBe("y")
  })
})

describe("resist", () => {
  it("follows the finger up to the limit", () => {
    expect(resist(-100, 148)).toBe(-100)
  })
  it("slows down past the limit but keeps moving", () => {
    const a = resist(-200, 148)
    const b = resist(-300, 148)
    expect(a).toBeLessThan(-148)
    expect(a).toBeGreaterThan(-200)
    expect(b).toBeLessThan(a)
  })
  it("barely moves a side with no actions", () => {
    expect(Math.abs(resist(80, 0))).toBeLessThan(10)
  })
})

describe("settle", () => {
  it("snaps back from a short drag", () => {
    expect(settle({ ...base, offset: -30 })).toBe("closed")
    expect(settle({ ...base, offset: 20 })).toBe("closed")
  })
  it("opens the trailing actions past half their width", () => {
    expect(settle({ ...base, offset: -80 })).toBe("open-trailing")
  })
  it("opens the leading action past half its width", () => {
    expect(settle({ ...base, offset: 40 })).toBe("open-leading")
  })
  it("runs the edge action on a long swipe", () => {
    expect(settle({ ...base, offset: -230 })).toBe("full-trailing")
    expect(settle({ ...base, offset: 230 })).toBe("full-leading")
  })
  it("never runs a full swipe when the edge action does not allow it", () => {
    expect(settle({ ...base, offset: -300, fullTrailing: false })).toBe("open-trailing")
  })
  it("treats a quick flick as intent", () => {
    expect(settle({ ...base, offset: -15, velocity: -0.8 })).toBe("open-trailing")
    expect(settle({ ...base, offset: -120, velocity: 0.8, from: "open-trailing" })).toBe("closed")
  })
  it("closes when there is nothing on that side", () => {
    expect(settle({ ...base, offset: 60, leadingWidth: 0 })).toBe("closed")
  })
})

describe("isArmed and restingOffset", () => {
  it("arms at the full-swipe ratio", () => {
    expect(isArmed(-360 * SWIPE.fullRatio, 360, "trailing", true)).toBe(true)
    expect(isArmed(-100, 360, "trailing", true)).toBe(false)
    expect(isArmed(-300, 360, "trailing", false)).toBe(false)
  })
  it("rests where the actions are fully visible", () => {
    expect(restingOffset("open-trailing", 148, 74, 360)).toBe(-148)
    expect(restingOffset("open-leading", 148, 74, 360)).toBe(74)
    expect(restingOffset("closed", 148, 74, 360)).toBe(0)
  })
})
