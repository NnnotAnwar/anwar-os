import { describe, expect, it } from "vitest"
import type { AttachedFile } from "../schema"
import { attach, cardSides, markSide, sideIds } from "./sides"

const file = (id: string, mime = "image/jpeg"): AttachedFile => ({ id, name: `${id}.jpg`, size: 1, mime })

describe("card sides", () => {
  it("gives the first photo the front and the next the back", () => {
    let files = attach([], file("a"))
    files = attach(files, file("b"))
    files = attach(files, file("c"))
    expect(files.map((f) => f.side)).toEqual(["front", "back", null])
    expect(sideIds(files)).toEqual({ frontFileId: "a", backFileId: "b" })
  })

  it("never puts a PDF or an SVG on the card", () => {
    let files = attach([], file("pdf", "application/pdf"))
    files = attach(files, file("svg", "image/svg+xml"))
    files = attach(files, file("photo"))
    expect(files.map((f) => f.side)).toEqual([null, null, "front"])
  })

  it("attaches a file once", () => {
    const files = attach(attach([], file("a")), file("a"))
    expect(files).toHaveLength(1)
  })

  it("moves a side to another photo and swaps cleanly", () => {
    let files = attach(attach(attach([], file("a")), file("b")), file("c"))
    files = markSide(files, "c", "front")
    expect(sideIds(files)).toEqual({ frontFileId: "c", backFileId: "b" })
    files = markSide(files, "b", "front")
    expect(sideIds(files)).toEqual({ frontFileId: "b", backFileId: null })
    files = markSide(files, "b", null)
    expect(cardSides(files)).toEqual({ front: null, back: null })
  })
})
