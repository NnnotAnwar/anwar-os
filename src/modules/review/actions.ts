import "server-only"
import { requireViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import { monthlyReport } from "./report"
import { saveReportPdf } from "./save"
import { monthlyInput, savePdfInput, type MonthlyReport, type SavedReport } from "./schema"

// The monthly report as typed actions: the page, the assistant and MCP read it
// with `monthly`; `savePdf` files it under Files → Reports.

export const actions = {
  monthly: defineAction({
    description:
      "The user's monthly report for one month (YYYY-MM; default the current month so far, in their timezone): money spent and received in the base currency against the month before, spending per category with the biggest changes, active subscriptions per month, tasks done and added, notes/ideas/links/feedback added, and public site page views with the top pages. Sections are null when their module is off.",
    kind: "read",
    input: monthlyInput,
    handler: async ({ month }): Promise<MonthlyReport> => monthlyReport(month, (await requireViewer()).timezone),
  }),
  savePdf: defineAction({
    description:
      "Save one month's report (YYYY-MM) as a PDF in Files → Reports, replacing that month's earlier copy. Returns the file's link; saved is false when file storage isn't set up (the link then downloads the PDF instead).",
    kind: "write",
    input: savePdfInput,
    handler: async ({ month }): Promise<SavedReport> => saveReportPdf(await monthlyReport(month, (await requireViewer()).timezone)),
  }),
}
