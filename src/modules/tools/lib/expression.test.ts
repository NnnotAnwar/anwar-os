import { describe, expect, it } from "vitest"
import { evaluate, MAX_EXPRESSION_LENGTH, roundResult } from "./expression"

function value(source: string) {
  const res = evaluate(source)
  if (!res.ok) throw new Error(`${source}: ${res.error}`)
  return res.value
}

function error(source: string) {
  const res = evaluate(source)
  if (res.ok) throw new Error(`${source}: expected an error, got ${res.value}`)
  return res
}

describe("evaluate: arithmetic", () => {
  it.each([
    ["1 + 2", 3],
    ["7 - 10", -3],
    ["6 * 7", 42],
    ["10 / 4", 2.5],
    ["42", 42],
    ["  3  ", 3],
  ])("%s = %d", (src, expected) => {
    expect(value(src)).toBe(expected)
  })

  it("respects operator precedence and left associativity", () => {
    expect(value("2 + 3 * 4")).toBe(14)
    expect(value("10 - 4 - 3")).toBe(3)
    expect(value("100 / 10 / 5")).toBe(2)
    expect(value("2 * 3 + 4 * 5")).toBe(26)
    expect(value("8 / 2 * 4")).toBe(16)
  })

  it("handles parentheses, nested too", () => {
    expect(value("(2 + 3) * 4")).toBe(20)
    expect(value("((1 + 2) * (3 + 4)) / 7")).toBe(3)
    expect(value("-(2 + 3)")).toBe(-5)
  })

  it("parses decimals, including a leading or trailing dot", () => {
    expect(value("1.5 * 2")).toBe(3)
    expect(value(".5 + .25")).toBe(0.75)
    expect(value("3. + 1")).toBe(4)
  })

  it("supports unary minus and plus", () => {
    expect(value("-5")).toBe(-5)
    expect(value("-5 + 3")).toBe(-2)
    expect(value("2 * -3")).toBe(-6)
    expect(value("2 - -3")).toBe(5)
    expect(value("--4")).toBe(4)
    expect(value("+7")).toBe(7)
  })

  it("accepts calculator symbols", () => {
    expect(value("6 × 7")).toBe(42)
    expect(value("9 ÷ 3")).toBe(3)
    expect(value("5 − 8")).toBe(-3)
    expect(value("5 – 8")).toBe(-3)
    expect(value("2 · 4")).toBe(8)
  })

  it("trims floating-point noise", () => {
    expect(value("0.1 + 0.2")).toBe(0.3)
    expect(value("1.1 * 3")).toBe(3.3)
    expect(value("1 / 3")).toBeCloseTo(1 / 3, 14)
  })

  it("returns 0, not −0", () => {
    expect(Object.is(value("-0"), 0)).toBe(true)
    expect(Object.is(value("0 * -1"), 0)).toBe(true)
  })
})

describe("evaluate: percent", () => {
  it("divides by 100 on its own or with × and ÷", () => {
    expect(value("50%")).toBe(0.5)
    expect(value("200 * 10%")).toBe(20)
    expect(value("30 / 50%")).toBe(60)
    expect(value("-10%")).toBe(-0.1)
  })

  it("takes a share of the left operand with + and −", () => {
    expect(value("200 + 10%")).toBe(220)
    expect(value("200 - 10%")).toBe(180)
    expect(value("200 + -10%")).toBe(180)
    expect(value("50 + 50 + 10%")).toBe(110)
  })

  it("applies to parenthesized groups", () => {
    expect(value("(150 + 50)%")).toBe(2)
    expect(value("100 + (10%)")).toBe(110)
  })

  it("can repeat", () => {
    expect(value("50%%")).toBe(0.005)
  })
})

describe("evaluate: errors", () => {
  it("refuses to divide by zero", () => {
    expect(error("1 / 0").error).toBe("Can't divide by zero")
    expect(error("5 / (2 - 2)").error).toBe("Can't divide by zero")
    expect(error("0 / 0").error).toBe("Can't divide by zero")
  })

  it("asks for input when empty", () => {
    expect(error("").error).toBe("Enter an expression")
    expect(error("   ").error).toBe("Enter an expression")
  })

  it("points at a dangling operator", () => {
    expect(error("2 +")).toEqual({ ok: false, error: "Add a number after “+”", position: 3 })
    expect(error("2 *").error).toBe("Add a number after “×”")
    expect(error("* 2")).toEqual({ ok: false, error: "Add a number before “×”", position: 0 })
    expect(error("2 + * 3").error).toBe("Add a number before “×”")
  })

  it("catches unbalanced parentheses", () => {
    expect(error("(1 + 2").error).toBe("Missing a closing “)”")
    expect(error("1 + 2)")).toEqual({ ok: false, error: "There's a “)” without a matching “(”", position: 5 })
    expect(error(")").error).toBe("There's a “)” without a matching “(”")
    expect(error("()").error).toBe("Add something inside the parentheses")
    expect(error("(").error).toBe("Add something inside the parentheses")
  })

  it("requires explicit operators", () => {
    expect(error("2 3").error).toBe("Missing an operator between numbers")
    expect(error("2(3)").error).toBe("Missing an operator between numbers")
    expect(error("(2)3").error).toBe("Missing an operator between numbers")
    expect(error("(2 3)").error).toBe("Missing an operator between numbers")
  })

  it("rejects malformed numbers", () => {
    expect(error("1.2.3").error).toBe("A number can only have one decimal point")
    expect(error(". + 1").error).toBe("A dot needs digits next to it")
    expect(error("3,5").error).toBe("Use a dot for decimals, like 3.5")
  })

  it("rejects anything that isn't arithmetic", () => {
    expect(error("2 + x")).toEqual({ ok: false, error: "“x” isn't something I can calculate", position: 4 })
    expect(error("alert(1)").ok).toBe(false)
    expect(error("2 ** 3").ok).toBe(false)
    expect(error("Math.PI").ok).toBe(false)
  })

  it("reports overflow instead of Infinity", () => {
    expect(error(`1${"0".repeat(200)} * 1${"0".repeat(200)}`).error).toBe("The result is too large to show")
  })

  it("limits length and nesting", () => {
    expect(error("1+".repeat(MAX_EXPRESSION_LENGTH)).error).toMatch(/under/)
    expect(error(`${"(".repeat(150)}1${")".repeat(150)}`).error).toBe("Too many nested parentheses")
    expect(error(`${"-".repeat(150)}1`).error).toBe("Too many nested parentheses")
    expect(value(`${"(".repeat(50)}1${")".repeat(50)}`)).toBe(1)
  })
})

describe("roundResult", () => {
  it("keeps 15 significant digits", () => {
    expect(roundResult(0.30000000000000004)).toBe(0.3)
    expect(roundResult(123456789012345)).toBe(123456789012345)
    expect(roundResult(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
  })
})
