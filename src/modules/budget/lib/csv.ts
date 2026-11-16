// CSV import: parse, map columns, validate, and mark duplicates. Pure, so the
// preview in the browser and the server agree on every row.

import { parseAmount } from "./money"
import { parseDate } from "./dates"

export const MAX_IMPORT_ROWS = 2000

const DELIMITERS = [";", ",", "\t", "|"] as const
export type Delimiter = (typeof DELIMITERS)[number]

/** The delimiter used most in the first non-empty line, outside quotes. Ties prefer ";" (Czech banks). */
export function detectDelimiter(text: string): Delimiter {
  const line = text.replace(/^﻿/, "").split(/\r?\n/).find((l) => l.trim()) ?? ""
  const counts = new Map<Delimiter, number>(DELIMITERS.map((d) => [d, 0]))
  let quoted = false
  for (const ch of line) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && counts.has(ch as Delimiter)) counts.set(ch as Delimiter, counts.get(ch as Delimiter)! + 1)
  }
  let best: Delimiter = ";"
  for (const d of DELIMITERS) if (counts.get(d)! > counts.get(best)!) best = d
  return best
}

/**
 * RFC 4180 parsing: quoted fields, "" escapes, delimiters and newlines inside
 * quotes, CRLF, a UTF-8 BOM. Blank lines are skipped; cells are trimmed.
 */
export function parseCsv(input: string, delimiter: Delimiter = detectDelimiter(input)): string[][] {
  const text = input.replace(/^﻿/, "")
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false

  const endCell = () => {
    row.push(cell.trim())
    cell = ""
  }
  const endRow = () => {
    endCell()
    if (row.some((c) => c !== "")) rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"' && cell.trim() === "") {
      cell = ""
      quoted = true
    } else if (ch === delimiter) {
      endCell()
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      endRow()
    } else cell += ch
  }
  if (cell !== "" || row.length > 0) endRow()
  return rows
}

export type ImportField = "date" | "amount" | "note" | "category"
export type ColumnMapping = Record<ImportField, number | null>

const HINTS: Record<ImportField, RegExp> = {
  date: /date|datum|дата|zaúčtov|zauctov|splatnost|valuta|day/i,
  amount: /amount|částka|castka|objem|сумма|suma|value|hodnota/i,
  category: /categ|kategor|категор/i,
  note: /note|desc|popis|pozn[aá]mk|zpr[aá]v|message|memo|payee|merchant|counterparty|protistran|obchodn|назначение|описание|комментар|text/i,
}

/** Best guess at which column holds what, from header names and then from the data. */
export function guessMapping(header: string[] | null, sample: string[][]): ColumnMapping {
  const mapping: ColumnMapping = { date: null, amount: null, note: null, category: null }
  const taken = new Set<number>()
  if (header) {
    for (const field of ["date", "amount", "category", "note"] as ImportField[]) {
      const index = header.findIndex((h, i) => !taken.has(i) && HINTS[field].test(h))
      if (index >= 0) {
        mapping[field] = index
        taken.add(index)
      }
    }
  }
  const width = Math.max(0, ...sample.map((r) => r.length))
  const share = (i: number, test: (v: string) => boolean) => {
    const values = sample.map((r) => r[i] ?? "").filter(Boolean)
    return values.length ? values.filter(test).length / values.length : 0
  }
  for (let i = 0; i < width && mapping.date === null; i++) {
    if (!taken.has(i) && share(i, (v) => parseDate(v) !== null) >= 0.8) {
      mapping.date = i
      taken.add(i)
    }
  }
  for (let i = 0; i < width && mapping.amount === null; i++) {
    if (!taken.has(i) && share(i, (v) => parseAmount(v) !== null) >= 0.8) {
      mapping.amount = i
      taken.add(i)
    }
  }
  for (let i = 0; i < width && mapping.note === null; i++) {
    if (!taken.has(i) && share(i, (v) => parseAmount(v) === null && parseDate(v) === null) >= 0.5) {
      mapping.note = i
      taken.add(i)
    }
  }
  return mapping
}

/** A header row has no dates and no amounts in it. */
export function looksLikeHeader(row: string[]) {
  return row.length > 0 && row.every((c) => parseDate(c) === null && (c === "" || parseAmount(c) === null))
}

export type ImportRow = {
  /** 1-based line in the pasted data (after the header), for messages. */
  line: number
  occurredOn: string
  /** Signed minor units; negative = money out. */
  amountMinor: number
  note: string
  categoryName: string | null
}

export type RowError = { line: number; message: string }

/**
 * Turns parsed cells into import rows. `flipSign` is for exports that list
 * spending as positive numbers (e.g. the expense bot): every amount is negated.
 */
export function mapRows(
  rows: string[][],
  mapping: ColumnMapping,
  { flipSign = false }: { flipSign?: boolean } = {},
): { rows: ImportRow[]; errors: RowError[] } {
  const out: ImportRow[] = []
  const errors: RowError[] = []
  if (mapping.date === null || mapping.amount === null) {
    return { rows: out, errors: [{ line: 0, message: "Choose the date and amount columns." }] }
  }
  rows.forEach((cells, i) => {
    const line = i + 1
    const rawDate = cells[mapping.date!] ?? ""
    const rawAmount = cells[mapping.amount!] ?? ""
    const occurredOn = parseDate(rawDate)
    if (!occurredOn) {
      errors.push({ line, message: `“${rawDate || "(empty)"}” isn't a date.` })
      return
    }
    const parsed = parseAmount(rawAmount)
    if (!parsed || parsed.minor === 0) {
      errors.push({ line, message: `“${rawAmount || "(empty)"}” isn't an amount.` })
      return
    }
    const signed = (parsed.sign === "-" ? -1 : 1) * parsed.minor
    const note = mapping.note === null ? "" : (cells[mapping.note] ?? "").replace(/\s+/g, " ").trim().slice(0, 500)
    const category = mapping.category === null ? "" : (cells[mapping.category] ?? "").trim().slice(0, 60)
    out.push({
      line,
      occurredOn,
      amountMinor: flipSign ? -signed : signed,
      note,
      categoryName: category || null,
    })
  })
  return { rows: out, errors }
}

/** Notes compare case- and space-insensitively. */
export function normalizeNote(note: string) {
  return note.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim()
}

export function dedupeKey(row: { occurredOn: string; amountMinor: number; note: string }) {
  return `${row.occurredOn}|${row.amountMinor}|${normalizeNote(row.note)}`
}

/**
 * Marks rows already present. Counts matter: two identical coffees in the file
 * and one in the account means one is new. Returns a flag per row.
 */
export function markDuplicates(rows: { occurredOn: string; amountMinor: number; note: string }[], existingKeys: string[]) {
  const remaining = new Map<string, number>()
  for (const key of existingKeys) remaining.set(key, (remaining.get(key) ?? 0) + 1)
  return rows.map((row) => {
    const key = dedupeKey(row)
    const left = remaining.get(key) ?? 0
    if (left > 0) {
      remaining.set(key, left - 1)
      return true
    }
    return false
  })
}
