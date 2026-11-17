import { describe, expect, it } from "vitest"
import type { Idea } from "../schema"
import { columns, moveIdea, neighbourStatus, nextStage, startsDrag } from "./board"

const idea = (id: string, status: Idea["status"], updatedAt: string): Idea => ({
  id,
  title: id,
  body: "",
  status,
  tags: [],
  isPublic: false,
  createdAt: updatedAt,
  updatedAt,
})

const ideas = [
  idea("a", "raw", "2026-11-01T10:00:00Z"),
  idea("b", "raw", "2026-11-03T10:00:00Z"),
  idea("c", "building", "2026-11-02T10:00:00Z"),
]

describe("columns", () => {
  it("has every status, newest first", () => {
    const c = columns(ideas)
    expect(Object.keys(c)).toEqual(["raw", "exploring", "building", "shipped", "dropped"])
    expect(c.raw.map((i) => i.id)).toEqual(["b", "a"])
    expect(c.exploring).toEqual([])
  })
})

describe("moveIdea", () => {
  it("moves to the top of the target column", () => {
    const moved = moveIdea(ideas, "a", "building", "2026-11-05T00:00:00Z")
    expect(columns(moved).building.map((i) => i.id)).toEqual(["a", "c"])
    expect(columns(moved).raw.map((i) => i.id)).toEqual(["b"])
  })
  it("is a no-op when dropped where it was", () => {
    const same = moveIdea(ideas, "a", "raw", "2026-11-05T00:00:00Z")
    expect(same.find((i) => i.id === "a")!.updatedAt).toBe("2026-11-01T10:00:00Z")
  })
})

describe("neighbourStatus and nextStage", () => {
  it("clamps at the board edges", () => {
    expect(neighbourStatus("raw", -1)).toBe("raw")
    expect(neighbourStatus("raw", 1)).toBe("exploring")
    expect(neighbourStatus("dropped", 1)).toBe("dropped")
  })
  it("walks the pipeline and stops at shipped", () => {
    expect(nextStage("raw")).toBe("exploring")
    expect(nextStage("building")).toBe("shipped")
    expect(nextStage("shipped")).toBeNull()
    expect(nextStage("dropped")).toBeNull()
  })
})

describe("startsDrag", () => {
  it("lets a mouse click through until it moves", () => {
    expect(startsDrag("mouse", 2, 1, 0)).toBe("wait")
    expect(startsDrag("mouse", 5, 0, 0)).toBe("drag")
  })
  it("treats an early touch move as a scroll", () => {
    expect(startsDrag("touch", 0, 20, 100)).toBe("cancel")
    expect(startsDrag("touch", 2, 2, 100)).toBe("wait")
  })
  it("picks up after a hold", () => {
    expect(startsDrag("touch", 3, 3, 300)).toBe("drag")
  })
})
