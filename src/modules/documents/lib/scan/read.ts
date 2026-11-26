// What the scanner reads off a card: the machine-readable zone (MRZ, with
// check digits) where there is one, and printed dates and titles otherwise.
// Pure functions over OCR text, unit-tested in read.test.ts. The document
// number is in the MRZ too; it's never kept (the app stores no numbers).
import { parse } from "mrz"
import type { DocumentKind } from "../../schema"

export type Mrz = {
  format: "TD1" | "TD2" | "TD3"
  documentCode: string
  /** "2031-03-15"; null when the field didn't read. */
  expiresOn: string | null
  bornOn: string | null
  /** The expiry passed its check digit: the date is the one on the card. */
  checked: boolean
}

export type ScanReading = {
  kind: DocumentKind | null
  expiresOn: string | null
  issuedOn: string | null
  /** Where the expiry came from: the MRZ (check digit passed) or the printed text. */
  expirySource: "mrz" | "text" | null
  /** Which of the photos carries the MRZ (the back of an ID card, a passport's data page). */
  mrzPhoto: number | null
}

const FORMATS = [
  { format: "TD1", lines: 3, length: 30 },
  { format: "TD2", lines: 2, length: 36 },
  { format: "TD3", lines: 2, length: 44 },
] as const

/** An OCR'd line as MRZ characters: capitals, digits and the < filler (OCR often reads it as « or K<). */
export function mrzLine(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[«‹≤(\[{]/g, "<")
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9<]/g, "")
}

/** Lines that look like MRZ: long, mostly MRZ characters, with filler. */
function candidates(text: string) {
  return text
    .split(/\r?\n/)
    .map((raw) => ({ raw, line: mrzLine(raw) }))
    // OCR often drops a line's trailing filler, so short lines stay in: the
    // check digits decide which consecutive lines really are the MRZ.
    .filter(({ raw, line }) => line.length >= 12 && line.length >= raw.replace(/\s/g, "").length * 0.8)
    .map(({ line }) => line)
}

/** Fits an OCR'd line to the format's length: filler dropped at the end comes back, extra characters go. */
function fit(line: string, length: number) {
  if (line.length >= length) return line.slice(0, length)
  return line.padEnd(length, "<")
}

function isoDate(yymmdd: string | null | undefined, century: (yy: number) => number): string | null {
  if (!yymmdd || !/^\d{6}$/.test(yymmdd)) return null
  const yy = Number(yymmdd.slice(0, 2))
  const mm = Number(yymmdd.slice(2, 4))
  const dd = Number(yymmdd.slice(4, 6))
  const year = century(yy)
  const date = new Date(Date.UTC(year, mm - 1, dd))
  if (date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) return null
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
}

/** The MRZ in `text`, if one reads: tries each format over consecutive candidate lines. */
export function findMrz(text: string, today: string): Mrz | null {
  const lines = candidates(text)
  const thisYear = Number(today.slice(2, 4))
  let best: Mrz | null = null
  for (const { format, lines: count, length } of FORMATS) {
    for (let i = 0; i + count <= lines.length; i++) {
      const group = lines.slice(i, i + count)
      if (group.some((l) => l.length > length + 4)) continue
      let result: ReturnType<typeof parse>
      try {
        result = parse(group.map((l) => fit(l, length)), { autocorrect: true })
      } catch {
        continue
      }
      const detail = (field: string) => result.details.find((d) => d.field === field)
      const mrz: Mrz = {
        format,
        documentCode: String(result.fields.documentCode ?? ""),
        // Expiry is always this century; a birth year after this year's is the last century's.
        expiresOn: isoDate(result.fields.expirationDate, (yy) => 2000 + yy),
        bornOn: isoDate(result.fields.birthDate, (yy) => (yy > thisYear ? 1900 : 2000) + yy),
        checked: Boolean(detail("expirationDate")?.valid && detail("expirationDateCheckDigit")?.valid !== false),
      }
      if (mrz.checked) return mrz
      // Unchecked, keep it only if every line has the filler a real MRZ has.
      if (mrz.expiresOn && group.every((l) => l.includes("<"))) best ??= mrz
    }
  }
  return best
}

/** A document code's kind: P… passports; …R (IR, AR, RP…) residence permits; other I/A/C cards IDs. */
export function kindFromCode(code: string): DocumentKind | null {
  const c = code.toUpperCase()
  if (c.startsWith("P")) return "passport"
  if (/^(.R|R.?)$/.test(c)) return "residence_permit"
  if (/^[IAC]/.test(c)) return "id_card"
  return null
}

/** Printed titles, in the languages a card in Czechia is likely to carry (diacritics optional: OCR drops them). */
const KIND_WORDS: [DocumentKind, RegExp][] = [
  ["residence_permit", /RESIDENCE\s*PERMIT|POVOLEN[IÍ]\s*K\s*POBYTU|K\s*POBYTU|AUFENTHALTS|TITRE\s*DE\s*S[EÉ]JOUR|PERMESSO\s*DI\s*SOGGIORNO|PERMISO\s*DE\s*RESIDENCIA|DOCASN[EÉ]|TRVAL[EÉ]M\s*POBYTU/i],
  ["passport", /PASSPORT|CESTOVN[IÍ]\s*PAS|REISEPASS|PASSEPORT|PASAPORTE|PASZPORT/i],
  ["driving_licence", /DRIVING\s*LICEN[CS]E|[RŘ]IDI[CČ]SK[YÝ]\s*PR[UŮ]KAZ|F[UÜ]HRERSCHEIN|PERMIS\s*DE\s*CONDUIRE|PRAWO\s*JAZDY/i],
  ["insurance", /INSURANCE|POJI[SŠ]T[EĚ]N|POJI[SŠ][TŤ]OVN|KRANKENVERSICHERUNG|EHIC|ZDRAVOTN/i],
  ["id_card", /IDENTITY\s*CARD|OB[CČ]ANSK[YÝ]\s*PR[UŮ]KAZ|PERSONALAUSWEIS|CARTE\s*D.?IDENTIT|DOWOD\s*OSOBISTY/i],
]

export function kindFromText(text: string): DocumentKind | null {
  for (const [kind, re] of KIND_WORDS) if (re.test(text)) return kind
  return null
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

type FoundDate = { iso: string; at: number }

function validDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2100) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** Every date printed in `text`: 15.03.2031, 15/03/2031, 15 03 2031, 2031-03-15, 15 MAR 2031, 15 MAR/MARS 2031. */
export function datesIn(text: string): FoundDate[] {
  const found: FoundDate[] = []
  const push = (iso: string | null, at: number) => iso && found.push({ iso, at })
  for (const m of text.matchAll(/\b(\d{1,2})\s?[.\/\-]\s?(\d{1,2})\s?[.\/\-]\s?(\d{4})\b/g)) push(validDate(+m[3]!, +m[2]!, +m[1]!), m.index!)
  for (const m of text.matchAll(/\b(\d{2})\s(\d{2})\s(\d{4})\b/g)) push(validDate(+m[3]!, +m[2]!, +m[1]!), m.index!)
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(validDate(+m[1]!, +m[2]!, +m[3]!), m.index!)
  for (const m of text.toUpperCase().matchAll(/\b(\d{1,2})\s?([A-Z]{3})[A-Z]*(?:\s?\/\s?[A-Z]+)?\s?(\d{4})\b/g)) {
    const month = MONTHS.indexOf(m[2]!)
    if (month >= 0) push(validDate(+m[3]!, month + 1, +m[1]!), m.index!)
  }
  return found.sort((a, b) => a.at - b.at)
}

const EXPIRY_LABEL = /EXPIR|VALID|PLATNOST|PLATN|G[UÜ]LTIG|DATE\s*OF\s*EXPIRY|DATUM\s*KONCE|PLAT[IÍ]\s*DO|VALABLE/i
const ISSUE_LABEL = /ISSUE|ISSUED|VYD[AÁ]N|DATUM\s*VYD|AUSSTELL|D[EÉ]LIVR|EMISSION/i
const BIRTH_LABEL = /BIRTH|NAROZ|GEBURT|NAISSANCE/i

/** The date printed right after a label like "Date of issue" (within a line or two). */
function labelled(text: string, dates: FoundDate[], label: RegExp): string | null {
  for (const d of dates) {
    const before = text.slice(Math.max(0, d.at - 60), d.at)
    if (label.test(before) && !BIRTH_LABEL.test(before.slice(-25))) return d.iso
  }
  return null
}

/**
 * Reads the document from the OCR text of each photo (front, back…) and the
 * MRZ pass of each. `today` keeps future dates out of "issued".
 */
export function readCard(photos: { text: string; mrzText?: string }[], today: string): ScanReading {
  let mrz: Mrz | null = null
  let mrzPhoto: number | null = null
  photos.forEach((p, i) => {
    const found = findMrz(p.mrzText ?? "", today) ?? findMrz(p.text, today)
    if (found && (!mrz || (!mrz.checked && found.checked))) {
      mrz = found
      mrzPhoto = i
    }
  })
  const m = mrz as Mrz | null
  const text = photos.map((p) => p.text).join("\n")
  const dates = datesIn(text)

  // An unchecked MRZ may be printed text read as one: its code doesn't count.
  const kind = (m?.checked && kindFromCode(m.documentCode)) || kindFromText(text)

  let expiresOn: string | null = null
  let expirySource: ScanReading["expirySource"] = null
  if (m?.checked && m.expiresOn) {
    expiresOn = m.expiresOn
    expirySource = "mrz"
  } else {
    expiresOn = labelled(text, dates, EXPIRY_LABEL) ?? dates.map((d) => d.iso).sort().at(-1) ?? m?.expiresOn ?? null
    expirySource = expiresOn ? "text" : null
  }

  const born = m?.bornOn ?? labelled(text, dates, BIRTH_LABEL)
  const issuable = (iso: string) => iso !== born && iso !== expiresOn && iso <= today && (!expiresOn || iso < expiresOn)
  let issuedOn = labelled(text, dates, ISSUE_LABEL)
  if (issuedOn && !issuable(issuedOn)) issuedOn = null
  if (!issuedOn) {
    // Unlabelled: the latest past date that isn't the birth date (an issue date is the newest one printed).
    const minIssue = expiresOn ? `${Number(expiresOn.slice(0, 4)) - 15}${expiresOn.slice(4)}` : "1900-01-01"
    issuedOn =
      dates
        .map((d) => d.iso)
        .filter((iso) => issuable(iso) && iso >= minIssue)
        .sort()
        .at(-1) ?? null
  }
  return { kind, expiresOn, issuedOn, expirySource, mrzPhoto }
}
