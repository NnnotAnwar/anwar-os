"use client"

import { useRef, useState } from "react"
import { Delete } from "@/components/icons"
import { cn } from "@/lib/utils"
import { evaluate } from "../lib/expression"
import { formatPrecise } from "../lib/format"
import { SectionLabel } from "./fields"

type Entry = { id: number; expression: string; value: number }

type Key = { label: string; insert?: string; action?: "clear" | "equals"; aria?: string; tone?: "op" | "accent" }

const KEYS: Key[] = [
  { label: "C", action: "clear", aria: "Clear" },
  { label: "(", insert: "(" },
  { label: ")", insert: ")" },
  { label: "÷", insert: " ÷ ", aria: "Divide", tone: "op" },
  { label: "7", insert: "7" },
  { label: "8", insert: "8" },
  { label: "9", insert: "9" },
  { label: "×", insert: " × ", aria: "Multiply", tone: "op" },
  { label: "4", insert: "4" },
  { label: "5", insert: "5" },
  { label: "6", insert: "6" },
  { label: "−", insert: " − ", aria: "Minus", tone: "op" },
  { label: "1", insert: "1" },
  { label: "2", insert: "2" },
  { label: "3", insert: "3" },
  { label: "+", insert: " + ", aria: "Plus", tone: "op" },
  { label: "%", insert: "%", aria: "Percent" },
  { label: "0", insert: "0" },
  { label: ".", insert: ".", aria: "Decimal point" },
  { label: "=", action: "equals", aria: "Equals", tone: "accent" },
]

/** Plain digits that can be fed back into the evaluator (it has no exponent syntax). */
function reusable(value: number): string | undefined {
  const text = String(value)
  return /e/i.test(text) ? undefined : text
}

export function BasicCalculator() {
  const [expression, setExpression] = useState("")
  const [error, setError] = useState<string>()
  const [history, setHistory] = useState<Entry[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(0)

  const preview = expression.trim() ? evaluate(expression) : undefined

  function update(next: string) {
    setExpression(next)
    setError(undefined)
  }

  function insert(text: string) {
    const input = inputRef.current
    const start = input?.selectionStart ?? expression.length
    const end = input?.selectionEnd ?? expression.length
    update(expression.slice(0, start) + text + expression.slice(end))
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(start + text.length, start + text.length)
    })
  }

  function backspace() {
    const input = inputRef.current
    const start = input?.selectionStart ?? expression.length
    const end = input?.selectionEnd ?? expression.length
    const from = start === end ? Math.max(0, start - 1) : start
    update(expression.slice(0, from) + expression.slice(end))
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(from, from)
    })
  }

  function equals() {
    const res = evaluate(expression)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setHistory((h) => [{ id: nextId.current++, expression: expression.trim(), value: res.value }, ...h].slice(0, 8))
    update(reusable(res.value) ?? expression)
  }

  function clear() {
    update("")
    inputRef.current?.focus()
  }

  function press(key: Key) {
    if (key.action === "clear") clear()
    else if (key.action === "equals") equals()
    else if (key.insert) insert(key.insert)
  }

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] md:items-start">
      <div className="grid gap-4 glass rounded-xl p-4">
        <form
          className="grid gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            equals()
          }}
        >
          <label htmlFor="calc-expression" className="sr-only">
            Expression
          </label>
          <div className="relative">
            <input
              id="calc-expression"
              ref={inputRef}
              value={expression}
              onChange={(e) => update(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault()
                  clear()
                }
              }}
              placeholder="12 × (3 + 4)"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              // Phones use the on-screen pad below; a system keyboard would cover it.
              inputMode="none"
              aria-invalid={error ? true : undefined}
              aria-describedby="calc-output calc-help"
              className="h-14 w-full rounded-lg border border-input bg-background pr-11 pl-3 text-right font-mono text-2xl tabular outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
            />
            <button
              type="button"
              onClick={backspace}
              aria-label="Delete last character"
              className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Delete className="size-4" aria-hidden />
            </button>
          </div>
          <output
            id="calc-output"
            htmlFor="calc-expression"
            aria-live="polite"
            className={cn(
              "min-h-6 truncate text-right font-mono text-sm tabular",
              error ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {error ?? (preview?.ok ? `= ${formatPrecise(preview.value, 12)}` : " ")}
          </output>
        </form>

        {/* Every key has a typed equivalent, so the pad stays out of the tab order. */}
        <div role="group" aria-label="Keypad" className="grid grid-cols-4 gap-2">
          {KEYS.map((key) => (
            <button
              key={key.label}
              type="button"
              tabIndex={-1}
              aria-label={key.aria}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => press(key)}
              className={cn(
                "h-12 rounded-lg font-mono text-lg transition-colors outline-none select-none active:translate-y-px",
                key.tone === "accent"
                  ? "bg-primary text-primary-foreground hover:bg-primary/85"
                  : key.tone === "op"
                    ? "bg-accent text-text-accent hover:bg-accent/70"
                    : "bg-muted hover:bg-muted/70",
              )}
            >
              {key.label}
            </button>
          ))}
        </div>
        <p id="calc-help" className="text-xs text-muted-foreground">
          Type or tap. Enter calculates, Esc clears. 200 + 10% gives 220.
        </p>
      </div>

      <section className="grid content-start gap-3" aria-labelledby="calc-history">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel id="calc-history">History</SectionLabel>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setHistory([])}
              className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Clear history
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Results you calculate show up here. Select one to use it again.</p>
        ) : (
          <ul className="grid gap-px overflow-hidden rounded-xl border bg-border">
            {history.map((entry) => {
              const text = reusable(entry.value)
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={!text}
                    onClick={() => text && insert(text)}
                    className="grid w-full gap-0.5 bg-card px-4 py-2.5 text-right font-mono tabular outline-none hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:cursor-default"
                  >
                    <span className="truncate text-xs text-muted-foreground">{entry.expression}</span>
                    <span className="truncate text-base">= {formatPrecise(entry.value, 12)}</span>
                    <span className="sr-only">Insert this result</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
