import { describe, expect, it } from "vitest"
import { dedupeKey, detectDelimiter, guessMapping, looksLikeHeader, mapRows, markDuplicates, parseCsv } from "./csv"

const bank = `﻿Datum;Částka;Měna;Poznámka
16.11.2026;-1 234,50;CZK;"Albert; Praha"
15.11.2026;45 000,00;CZK;Výplata
14.11.2026;-89,90;CZK;"Kafe ""U Tří"""
`

describe("parseCsv", () => {
  it("handles Czech bank exports: BOM, semicolons, quotes", () => {
    expect(detectDelimiter(bank)).toBe(";")
    const rows = parseCsv(bank)
    expect(rows).toHaveLength(4)
    expect(rows[1]).toEqual(["16.11.2026", "-1 234,50", "CZK", "Albert; Praha"])
    expect(rows[3]![3]).toBe('Kafe "U Tří"')
  })

  it("handles commas, CRLF, newlines in quotes and blank lines", () => {
    const rows = parseCsv('date,amount,note\r\n2026-11-16,"1,234.50","two\nlines"\r\n\r\n2026-11-15,-5,x')
    expect(rows).toEqual([
      ["date", "amount", "note"],
      ["2026-11-16", "1,234.50", "two\nlines"],
      ["2026-11-15", "-5", "x"],
    ])
  })

  it("detects tabs", () => {
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t")
  })
})

describe("mapping", () => {
  it("guesses columns from Czech headers", () => {
    const rows = parseCsv(bank)
    expect(looksLikeHeader(rows[0]!)).toBe(true)
    expect(looksLikeHeader(rows[1]!)).toBe(false)
    expect(guessMapping(rows[0]!, rows.slice(1))).toEqual({ date: 0, amount: 1, note: 3, category: null })
  })

  it("guesses columns from the data when there is no header", () => {
    const rows = parseCsv("Lunch;16.11.2026;-250\nBus;15.11.2026;-32")
    expect(guessMapping(null, rows)).toEqual({ date: 1, amount: 2, note: 0, category: null })
  })

  it("maps rows and reports bad ones by line", () => {
    const rows = parseCsv(bank).slice(1)
    rows.push(["31.2.2026", "-5", "CZK", "bad date"], ["16.11.2026", "abc", "CZK", "bad amount"])
    const { rows: out, errors } = mapRows(rows, { date: 0, amount: 1, note: 3, category: null })
    expect(out.map((r) => [r.occurredOn, r.amountMinor, r.note])).toEqual([
      ["2026-11-16", -123450, "Albert; Praha"],
      ["2026-11-15", 4500000, "Výplata"],
      ["2026-11-14", -8990, 'Kafe "U Tří"'],
    ])
    expect(errors.map((e) => e.line)).toEqual([4, 5])
  })

  it("flips signs for exports that list spending as positive", () => {
    const { rows } = mapRows([["16.11.2026", "250", "food"]], { date: 0, amount: 1, note: null, category: 2 }, { flipSign: true })
    expect(rows[0]).toMatchObject({ amountMinor: -25000, categoryName: "food", note: "" })
  })

  it("needs date and amount", () => {
    expect(mapRows([["x"]], { date: null, amount: 0, note: null, category: null }).errors).toHaveLength(1)
  })
})

describe("dedupe", () => {
  const row = (note: string, amountMinor = -25000, occurredOn = "2026-11-16") => ({ occurredOn, amountMinor, note })

  it("matches date + amount + note, ignoring case and spacing", () => {
    expect(dedupeKey(row("  Lunch   at Bistro "))).toBe(dedupeKey(row("lunch at bistro")))
    expect(markDuplicates([row("Lunch"), row("Lunch", -25001), row("Dinner")], [dedupeKey(row("lunch"))])).toEqual([
      true,
      false,
      false,
    ])
  })

  it("counts repeats: two coffees in the file, one already saved → one is new", () => {
    const existing = [dedupeKey(row("coffee", -6000))]
    expect(markDuplicates([row("coffee", -6000), row("coffee", -6000)], existing)).toEqual([true, false])
  })
})
