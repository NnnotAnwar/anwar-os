// The monthly report as a one- or two-page A4 PDF. pdf-lib with the built-in
// Helvetica: pure JS, no browser, no font files, so it renders the same in the
// arm64 production image and in tests. Helvetica only has Latin-1 (WinAnsi):
// other letters lose their accents ("č" → "c"), anything else becomes "?".

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib"
import { formatMoney } from "@/modules/budget/lib/money"
import { percentChange } from "./compare"
import type { MonthlyReport } from "../schema"

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 48
const INK = rgb(0.11, 0.1, 0.16)
const MUTED = rgb(0.42, 0.41, 0.5)
const ACCENT = rgb(0.31, 0.27, 0.9)
const RULE = rgb(0.88, 0.87, 0.93)
const BAR = rgb(0.84, 0.82, 0.98)

type Fonts = { regular: PDFFont; bold: PDFFont }

/** Replaces what Helvetica can't draw: accents dropped, the rest "?". */
export function pdfSafe(text: string, supported: Set<number>): string {
  let out = ""
  for (const ch of text.normalize("NFC")) {
    const cp = ch.codePointAt(0)!
    if (supported.has(cp)) {
      out += ch
      continue
    }
    const plain = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    out += [...plain].every((c) => supported.has(c.codePointAt(0)!)) && plain ? plain : "?"
  }
  return out
}

class Writer {
  page: PDFPage
  y: number
  private readonly supported: Set<number>

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: Fonts,
    private readonly footer: string,
  ) {
    this.supported = new Set(fonts.regular.getCharacterSet())
    this.page = this.newPage()
    this.y = A4.height - MARGIN
  }

  private newPage() {
    const page = this.doc.addPage([A4.width, A4.height])
    const text = this.safe(this.footer)
    page.drawText(text, { x: MARGIN, y: 28, size: 8, font: this.fonts.regular, color: MUTED })
    return page
  }

  safe(text: string) {
    return pdfSafe(text, this.supported)
  }

  /** Room for `height` points, else a new page. */
  need(height: number) {
    if (this.y - height >= MARGIN) return
    this.page = this.newPage()
    this.y = A4.height - MARGIN
  }

  fit(text: string, width: number, size: number, font: PDFFont) {
    let t = this.safe(text)
    if (font.widthOfTextAtSize(t, size) <= width) return t
    while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1)
    return `${t.trimEnd()}...`
  }

  text(text: string, { x = MARGIN, size = 10, bold = false, color = INK, width = A4.width - 2 * MARGIN } = {}) {
    const font = bold ? this.fonts.bold : this.fonts.regular
    this.page.drawText(this.fit(text, width, size, font), { x, y: this.y, size, font, color })
  }

  right(text: string, xRight: number, { size = 10, bold = false, color = INK } = {}) {
    const font = bold ? this.fonts.bold : this.fonts.regular
    const t = this.safe(text)
    this.page.drawText(t, { x: xRight - font.widthOfTextAtSize(t, size), y: this.y, size, font, color })
  }

  line(gap = 14) {
    this.y -= gap
  }

  rule() {
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: A4.width - MARGIN, y: this.y }, thickness: 0.6, color: RULE })
  }

  section(title: string) {
    this.need(70)
    this.line(18)
    this.text(title.toUpperCase(), { size: 8.5, bold: true, color: ACCENT })
    this.line(8)
    this.rule()
    this.line(16)
  }

  /** "Label ........ value", value right-aligned. */
  row(label: string, value: string, { hint, bold = false }: { hint?: string; bold?: boolean } = {}) {
    this.need(16)
    const right = A4.width - MARGIN
    // A hint ("+12% vs October (CZK 1,200)") sits between: keep the label short then.
    this.text(label, { bold, width: hint ? 160 : 300 })
    if (hint) this.right(hint, right - 130, { size: 9, color: MUTED })
    this.right(value, right, { bold })
    this.line(16)
  }

  bar(share: number) {
    const width = (A4.width - 2 * MARGIN) * Math.max(0, Math.min(1, share))
    if (width > 0.5) this.page.drawRectangle({ x: MARGIN, y: this.y - 4.5, width, height: 2.2, color: BAR })
  }
}

const n = (value: number) => value.toLocaleString("en")

function vs(current: number, previous: number, previousLabel: string, format: (v: number) => string) {
  const pct = percentChange(current, previous)
  if (pct === null) return previous === 0 && current === 0 ? "" : `${previousLabel}: ${format(previous)}`
  return `${pct > 0 ? "+" : ""}${pct}% vs ${previousLabel} (${format(previous)})`
}

/** The report as PDF bytes. `generatedAt` is printed in the footer. */
export async function renderReportPdf(report: MonthlyReport, generatedAt = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) }
  doc.setTitle(`Monthly report · ${report.label}`)
  doc.setAuthor("anwar.os")
  doc.setCreator("anwar.os")
  doc.setProducer("anwar.os")
  doc.setCreationDate(generatedAt)
  doc.setModificationDate(generatedAt)

  const stamp = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: report.timezone }).format(generatedAt)
  const w = new Writer(doc, fonts, `anwar.os · monthly report ${report.month} · generated ${stamp}`)
  const prev = report.previousLabel.split(" ")[0]!

  w.text("MONTHLY REPORT", { size: 9, bold: true, color: ACCENT })
  w.line(26)
  w.text(report.label, { size: 24, bold: true })
  w.line(18)
  w.text(report.partial ? `So far, up to ${report.today} · compared with ${report.previousLabel}` : `Compared with ${report.previousLabel}`, {
    size: 10,
    color: MUTED,
  })
  w.line(6)

  const s = report.spending
  if (s) {
    const money = (minor: number) => formatMoney(minor, s.currency)
    w.section("Money")
    w.row("Spent", money(s.expenseMinor), { bold: true, hint: vs(s.expenseMinor, s.previousExpenseMinor, prev, money) })
    w.row("Income", money(s.incomeMinor), { hint: vs(s.incomeMinor, s.previousIncomeMinor, prev, money) })
    w.row("Net", formatMoney(s.netMinor, s.currency, "en", { signed: true }))
    for (const c of s.otherCurrencies) {
      w.row(`In ${c.currency}`, `${formatMoney(c.expenseMinor, c.currency)} spent · ${formatMoney(c.incomeMinor, c.currency)} in`)
    }
    if (s.categories.length) {
      w.line(6)
      w.need(30)
      w.text("Category", { size: 8.5, bold: true, color: MUTED })
      w.right(prev, A4.width - MARGIN - 130, { size: 8.5, bold: true, color: MUTED })
      w.right(report.label.split(" ")[0]!, A4.width - MARGIN, { size: 8.5, bold: true, color: MUTED })
      w.line(16)
      const top = s.categories[0]!.amountMinor || 1
      for (const c of s.categories) {
        w.need(18)
        w.bar(c.amountMinor / top)
        w.row(c.name, money(c.amountMinor), { hint: money(c.previousMinor) })
      }
    }
    if (s.changes.length) {
      w.line(4)
      w.need(16)
      const moves = s.changes.map((c) => {
        const d = c.amountMinor - c.previousMinor
        return `${c.name} ${d > 0 ? "+" : "-"}${money(Math.abs(d))}`
      })
      w.text(`Biggest changes: ${moves.join(" · ")}`, { size: 9, color: MUTED })
      w.line(14)
    }
  }

  const subs = report.subscriptions
  if (subs && subs.totals.length) {
    w.section("Subscriptions")
    for (const t of subs.totals) {
      w.row(`${t.count} active ${t.count === 1 ? "subscription" : "subscriptions"}`, `${formatMoney(t.monthlyMinor, t.currency)} a month`)
    }
  }

  const t = report.tasks
  const c = report.captured
  const counts: [string, number | null][] = [
    ["Notes", c.notes],
    ["Ideas", c.ideas],
    ["Links", c.links],
    ["Feedback messages", c.feedback],
  ]
  if (t || counts.some(([, v]) => v !== null)) {
    w.section("Work")
    if (t) {
      w.row("Tasks done", n(t.done), { bold: true, hint: vs(t.done, t.previousDone, prev, n) })
      w.row("Tasks added", n(t.added))
    }
    for (const [label, value] of counts) if (value !== null) w.row(`${label} added`, n(value))
  }

  const site = report.site
  if (site) {
    w.section("Public site")
    w.row("Page views", n(site.views), { bold: true, hint: vs(site.views, site.previousViews, prev, n) })
    for (const p of site.pages) w.row(`${p.label}  ${p.path}`, n(p.views))
    if (!site.pages.length) {
      w.text("No views this month.", { size: 9, color: MUTED })
      w.line(14)
    }
  }

  return doc.save({ useObjectStreams: true })
}
