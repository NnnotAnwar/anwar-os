import { describe, expect, it } from "vitest"
import { listCommand, rangeBetween, step } from "./keys"

describe("listCommand", () => {
  it("maps the vim-style movement keys", () => {
    expect(listCommand({ key: "j" })).toBe("next")
    expect(listCommand({ key: "k" })).toBe("prev")
    expect(listCommand({ key: "ArrowDown" })).toBe("next")
  })
  it("maps actions", () => {
    expect(listCommand({ key: "Enter" })).toBe("open")
    expect(listCommand({ key: "e" })).toBe("edit")
    expect(listCommand({ key: "n" })).toBe("new")
    expect(listCommand({ key: "/" })).toBe("filter")
    expect(listCommand({ key: "x" })).toBe("select")
    expect(listCommand({ key: "Delete" })).toBe("delete")
    expect(listCommand({ key: "Backspace" })).toBe("delete")
    expect(listCommand({ key: " " })).toBe("quickLook")
    expect(listCommand({ key: "Escape" })).toBe("escape")
  })
  it("leaves browser and app shortcuts alone", () => {
    expect(listCommand({ key: "k", metaKey: true })).toBeNull()
    expect(listCommand({ key: "j", altKey: true })).toBeNull()
    expect(listCommand({ key: "g" })).toBeNull()
    expect(listCommand({ key: "?" })).toBeNull()
  })
  it("knows the Finder-style modifiers", () => {
    expect(listCommand({ key: "a", metaKey: true })).toBe("selectAll")
    expect(listCommand({ key: "Backspace", metaKey: true })).toBe("delete")
  })
})

describe("step", () => {
  it("starts at the top", () => {
    expect(step(-1, 5, "next")).toBe(0)
    expect(step(-1, 5, "prev")).toBe(0)
  })
  it("clamps at both ends", () => {
    expect(step(4, 5, "next")).toBe(4)
    expect(step(0, 5, "prev")).toBe(0)
  })
  it("jumps to the ends", () => {
    expect(step(2, 5, "first")).toBe(0)
    expect(step(2, 5, "last")).toBe(4)
  })
  it("has nowhere to go in an empty list", () => {
    expect(step(0, 0, "next")).toBe(-1)
  })
})

describe("rangeBetween", () => {
  const ids = ["a", "b", "c", "d", "e"]
  it("selects downwards and upwards", () => {
    expect(rangeBetween(ids, "b", "d")).toEqual(["b", "c", "d"])
    expect(rangeBetween(ids, "d", "b")).toEqual(["b", "c", "d"])
  })
  it("falls back to the clicked row without an anchor", () => {
    expect(rangeBetween(ids, null, "c")).toEqual(["c"])
    expect(rangeBetween(ids, "zz", "c")).toEqual(["c"])
  })
  it("ignores unknown targets", () => {
    expect(rangeBetween(ids, "a", "zz")).toEqual([])
  })
})
