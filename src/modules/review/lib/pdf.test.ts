import fontkit from "@pdf-lib/fontkit"
import { PDFDocument } from "pdf-lib"
import { describe, expect, it } from "vitest"
import { INTER_BOLD, INTER_REGULAR } from "../fonts/inter"
import type { MonthlyReport } from "../schema"
import { pdfSafe, renderReportPdf } from "./pdf"

const report: MonthlyReport = {
  month: "2026-10",
  label: "October 2026",
  previousMonth: "2026-09",
  previousLabel: "September 2026",
  today: "2026-11-01",
  timezone: "Europe/Prague",
  partial: false,
  delivered: false,
  url: "/app/review?month=2026-10",
  pdfUrl: "/app/review/pdf?month=2026-10",
  spending: {
    currency: "CZK",
    expenseMinor: 12_400_00,
    previousExpenseMinor: 10_000_00,
    incomeMinor: 50_000_00,
    previousIncomeMinor: 50_000_00,
    netMinor: 37_600_00,
    categories: [
      { name: "Potraviny a drogérie", color: null, amountMinor: 8_000_00, previousMinor: 6_000_00 },
      { name: "Café ☕", color: null, amountMinor: 4_400_00, previousMinor: 4_000_00 },
      { name: "Продукты", color: null, amountMinor: 1_000_00, previousMinor: 0 },
    ],
    changes: [{ name: "Potraviny a drogérie", color: null, amountMinor: 8_000_00, previousMinor: 6_000_00 }],
    otherCurrencies: [{ currency: "EUR", expenseMinor: 12_99, incomeMinor: 0 }],
    transactionCount: 42,
    url: "/app/budget?month=2026-10",
  },
  subscriptions: { totals: [{ currency: "CZK", monthlyMinor: 1_547_00, count: 6 }], url: "/app/budget/subscriptions" },
  tasks: { done: 31, added: 28, previousDone: 20, url: "/app/tasks" },
  captured: { notes: 12, ideas: 4, links: null, feedback: 2 },
  site: { views: 540, previousViews: 400, pages: [{ path: "/cv", label: "CV", views: 210 }], url: "/app/analytics" },
  journal: {
    written: 18,
    rated: 16,
    averageMood: 3.8,
    best: { day: "2026-10-12", mood: 5, text: "Hike to Karlštejn 😄" },
    worst: { day: "2026-10-03", mood: 1, text: "Плохой день" },
    url: "/app/journal?year=2026",
  },
}

describe("pdfSafe", () => {
  const latin1 = new Set(Array.from({ length: 256 }, (_, i) => i))

  it("keeps what the font has, drops accents it lacks, and replaces the rest", () => {
    expect(pdfSafe("Café", latin1)).toBe("Café")
    expect(pdfSafe("Řeřicha čaj", latin1)).toBe("Rericha caj")
    expect(pdfSafe("Coffee ☕ to go", latin1)).toBe("Coffee to go")
    expect(pdfSafe("☕ Coffee", latin1)).toBe("Coffee")
    expect(pdfSafe("Кофе", latin1)).toBe("????")
  })

  it("keeps Czech, Russian and the punctuation the report uses with the embedded Inter", () => {
    for (const data of [INTER_REGULAR, INTER_BOLD]) {
      const font = fontkit.create(Buffer.from(data, "base64"))
      const supported = new Set(font.characterSet)
      const text = "Potraviny a drogérie · Řeřicha čaj · Продукты и ЖКХ — «ёлка» №5 · +12% · Kč 1 547,00 € ✓"
      expect(pdfSafe(text, supported)).toBe("Potraviny a drogérie · Řeřicha čaj · Продукты и ЖКХ — «ёлка» №5 · +12% · Kč 1 547,00 €")
    }
  })
})

describe("renderReportPdf", () => {
  it("renders a valid A4 PDF with the report's title", async () => {
    const bytes = await renderReportPdf(report, new Date("2026-11-01T09:00:00Z"))
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-")
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
    expect(doc.getTitle()).toBe("Monthly report · October 2026")
    const { width, height } = doc.getPage(0).getSize()
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842])
  })

  it("adds pages instead of drawing off the bottom", async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ name: `Category ${i}`, color: null, amountMinor: 1000 - i, previousMinor: 0 }))
    const bytes = await renderReportPdf({ ...report, spending: { ...report.spending!, categories: many } })
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1)
  })

  it("renders a report with every module off", async () => {
    const bytes = await renderReportPdf({
      ...report,
      spending: null,
      subscriptions: null,
      tasks: null,
      site: null,
      journal: null,
      captured: { notes: null, ideas: null, links: null, feedback: null },
    })
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })

  it("renders a journal month with lines but no moods", async () => {
    const bytes = await renderReportPdf({ ...report, journal: { written: 3, rated: 0, averageMood: null, best: null, worst: null, url: "" } })
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1)
  })
})
