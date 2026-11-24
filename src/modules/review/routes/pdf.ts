import type { NextRequest } from "next/server"
import { getViewer } from "@/core/auth"
import { actions } from "../actions"
import { renderReportPdf } from "../lib/pdf"
import { MONTH, reportFileName } from "../schema"

/**
 * GET /app/review/pdf[?month=YYYY-MM]: the month's report as a PDF download,
 * made on the fly for the signed-in owner (default: the current month so far).
 */
export async function GET(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer) return new Response("Sign in to download reports.", { status: 401 })
  const param = request.nextUrl.searchParams.get("month")
  if (param !== null && !MONTH.test(param)) return new Response("Use a month like 2026-10.", { status: 400 })

  const report = await actions.monthly.handler({ month: param ?? undefined })
  const bytes = await renderReportPdf(report)
  const name = reportFileName(report.month)
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${request.nextUrl.searchParams.get("inline") === "1" ? "inline" : "attachment"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  })
}
