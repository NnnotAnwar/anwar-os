import { describe, expect, it } from "vitest"
import { parseTags, slugify } from "./tags"

describe("parseTags", () => {
  it("trims, drops empties and de-duplicates case-insensitively", () => {
    expect(parseTags(" React, next.js ,, react,  Type   Script ")).toEqual(["React", "next.js", "Type Script"])
  })

  it("caps the count and length", () => {
    expect(parseTags("a,b,c", { max: 2 })).toEqual(["a", "b"])
    expect(parseTags("abcdef", { maxLength: 3 })).toEqual(["abc"])
  })
})

describe("slugify", () => {
  it("turns titles into URL-safe slugs", () => {
    expect(slugify("Planuj Směny")).toBe("planuj-smeny")
    expect(slugify("  Hello, World!  ")).toBe("hello-world")
    expect(slugify("Қазақстан жобасы")).toBe("qazaqstan-zhobasy")
    expect(slugify("Žluťoučký kůň")).toBe("zlutoucky-kun")
  })

  it("never ends with a dash after truncating", () => {
    expect(slugify("abc def", 4)).toBe("abc")
  })

  it("returns an empty string when nothing is left", () => {
    expect(slugify("!!!")).toBe("")
  })
})
