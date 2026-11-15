/**
 * A small arithmetic evaluator for the basic calculator. It tokenizes and parses
 * by recursive descent; nothing is ever passed to `eval` or `Function`.
 *
 * Grammar (lowest to highest precedence):
 *   expr    := term (("+" | "-") term)*
 *   term    := unary (("*" | "/") unary)*
 *   unary   := ("+" | "-") unary | postfix
 *   postfix := primary "%"*
 *   primary := number | "(" expr ")"
 *
 * Percent: `x%` is x / 100, except as the right operand of + or −, where it is a
 * share of the left operand, like a pocket calculator: 200 + 10% = 220.
 * Accepted symbols: × · * for multiply, ÷ / for divide, − – - for minus.
 * Decimals use a dot; a comma is rejected rather than guessed.
 */

export const MAX_EXPRESSION_LENGTH = 500
const MAX_DEPTH = 100

type Token =
  | { type: "num"; value: number; pos: number }
  | { type: "op"; value: "+" | "-" | "*" | "/" | "%"; pos: number }
  | { type: "paren"; value: "(" | ")"; pos: number }

type Node =
  | { type: "num"; value: number }
  | { type: "neg"; operand: Node }
  | { type: "pct"; operand: Node }
  | { type: "bin"; op: "+" | "-" | "*" | "/"; left: Node; right: Node }

export type EvalResult = { ok: true; value: number } | { ok: false; error: string; position?: number }

class CalcError extends Error {
  constructor(
    message: string,
    readonly position?: number,
  ) {
    super(message)
  }
}

const OPERATOR_ALIASES: Record<string, "+" | "-" | "*" | "/" | "%"> = {
  "+": "+",
  "-": "-",
  "−": "-",
  "–": "-",
  "*": "*",
  "×": "*",
  "·": "*",
  "/": "/",
  "÷": "/",
  "%": "%",
}

const SYMBOL: Record<string, string> = { "+": "+", "-": "−", "*": "×", "/": "÷", "%": "%" }

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (/[0-9.]/.test(ch)) {
      const start = i
      while (i < source.length && /[0-9]/.test(source[i])) i++
      if (source[i] === ".") {
        i++
        while (i < source.length && /[0-9]/.test(source[i])) i++
      }
      const text = source.slice(start, i)
      if (text === ".") throw new CalcError("A dot needs digits next to it", start)
      if (source[i] === ".") throw new CalcError("A number can only have one decimal point", i)
      tokens.push({ type: "num", value: Number(text), pos: start })
      continue
    }
    if (ch === ",") throw new CalcError("Use a dot for decimals, like 3.5", i)
    if (ch === "(" || ch === ")") {
      tokens.push({ type: "paren", value: ch, pos: i })
      i++
      continue
    }
    const op = OPERATOR_ALIASES[ch]
    if (op) {
      tokens.push({ type: "op", value: op, pos: i })
      i++
      continue
    }
    throw new CalcError(`“${ch}” isn't something I can calculate`, i)
  }
  return tokens
}

class Parser {
  private index = 0
  private depth = 0

  constructor(
    private readonly tokens: Token[],
    private readonly length: number,
  ) {}

  parse(): Node {
    const node = this.expr()
    const next = this.peek()
    if (next) {
      if (next.type === "paren" && next.value === ")") throw new CalcError("There's a “)” without a matching “(”", next.pos)
      throw new CalcError("Missing an operator between numbers", next.pos)
    }
    return node
  }

  private peek(): Token | undefined {
    return this.tokens[this.index]
  }

  private isOp(...ops: string[]): boolean {
    const t = this.peek()
    return t?.type === "op" && ops.includes(t.value)
  }

  private enter() {
    if (++this.depth > MAX_DEPTH) throw new CalcError("Too many nested parentheses")
  }

  private expr(): Node {
    let left = this.term()
    while (this.isOp("+", "-")) {
      const op = (this.tokens[this.index++] as { value: "+" | "-" }).value
      left = { type: "bin", op, left, right: this.term() }
    }
    return left
  }

  private term(): Node {
    let left = this.unary()
    while (this.isOp("*", "/")) {
      const op = (this.tokens[this.index++] as { value: "*" | "/" }).value
      left = { type: "bin", op, left, right: this.unary() }
    }
    return left
  }

  private unary(): Node {
    if (this.isOp("+", "-")) {
      const op = this.tokens[this.index++].value
      this.enter()
      const operand = this.unary()
      this.depth--
      return op === "-" ? { type: "neg", operand } : operand
    }
    return this.postfix()
  }

  private postfix(): Node {
    let node = this.primary()
    while (this.isOp("%")) {
      this.index++
      node = { type: "pct", operand: node }
    }
    return node
  }

  private primary(): Node {
    const t = this.peek()
    if (!t) {
      const prev = this.tokens[this.index - 1]
      if (prev?.type === "op") throw new CalcError(`Add a number after “${SYMBOL[prev.value]}”`, this.length)
      if (prev?.type === "paren" && prev.value === "(") throw new CalcError("Add something inside the parentheses", this.length)
      throw new CalcError("Enter an expression")
    }
    if (t.type === "num") {
      this.index++
      return { type: "num", value: t.value }
    }
    if (t.type === "paren" && t.value === "(") {
      this.index++
      this.enter()
      if (this.peek()?.type === "paren" && this.peek()?.value === ")") {
        throw new CalcError("Add something inside the parentheses", this.peek()!.pos)
      }
      const inner = this.expr()
      this.depth--
      const close = this.peek()
      if (!close || close.type !== "paren" || close.value !== ")") {
        if (close) throw new CalcError("Missing an operator between numbers", close.pos)
        throw new CalcError("Missing a closing “)”", this.length)
      }
      this.index++
      return inner
    }
    if (t.type === "paren") throw new CalcError("There's a “)” without a matching “(”", t.pos)
    throw new CalcError(`Add a number before “${SYMBOL[t.value]}”`, t.pos)
  }
}

/** For `a ± b%` (and `a ± −b%`): the signed percentage b, or undefined if the operand isn't one. */
function percentOperand(node: Node): number | undefined {
  if (node.type === "pct") return evaluateNode(node.operand)
  if (node.type === "neg") {
    const inner = percentOperand(node.operand)
    return inner === undefined ? undefined : -inner
  }
  return undefined
}

function evaluateNode(node: Node): number {
  switch (node.type) {
    case "num":
      return node.value
    case "neg":
      return -evaluateNode(node.operand)
    case "pct":
      return evaluateNode(node.operand) / 100
    case "bin": {
      const left = evaluateNode(node.left)
      const percent = node.op === "+" || node.op === "-" ? percentOperand(node.right) : undefined
      if (percent !== undefined) {
        const share = (left * percent) / 100
        return node.op === "+" ? left + share : left - share
      }
      const right = evaluateNode(node.right)
      switch (node.op) {
        case "+":
          return left + right
        case "-":
          return left - right
        case "*":
          return left * right
        case "/":
          if (right === 0) throw new CalcError("Can't divide by zero")
          return left / right
      }
    }
  }
}

/**
 * Trims binary floating-point noise (0.1 + 0.2 → 0.3) by keeping 15 significant
 * digits, which is as many as a double reliably carries.
 */
export function roundResult(value: number): number {
  if (value === 0) return 0 // also folds −0 into 0
  if (!Number.isFinite(value)) return value
  return Number(value.toPrecision(15))
}

export function evaluate(source: string): EvalResult {
  try {
    if (source.length > MAX_EXPRESSION_LENGTH) {
      throw new CalcError(`Keep it under ${MAX_EXPRESSION_LENGTH} characters`)
    }
    const tokens = tokenize(source)
    if (tokens.length === 0) throw new CalcError("Enter an expression")
    const value = evaluateNode(new Parser(tokens, source.length).parse())
    if (!Number.isFinite(value)) throw new CalcError("The result is too large to show")
    return { ok: true, value: roundResult(value) }
  } catch (error) {
    if (error instanceof CalcError) return { ok: false, error: error.message, position: error.position }
    throw error
  }
}
