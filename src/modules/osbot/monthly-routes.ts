import "server-only"
import { z } from "zod"
import { monthlyReport } from "@/modules/review/report"
import { saveReportPdf } from "@/modules/review/save"
import { month, monthlyInput } from "@/modules/review/schema"
import { osbotRoute, parseInput } from "./api"
import { recordDeliveries } from "./deliveries"

// osbot's monthly report under /api/internal/osbot/monthly*: the card on the
// 1st (and /month), its PDF filed into Files → Reports, and the ack that
// keeps the card from repeating. Signed and run as the site owner (api.ts).

const monthBody = z.object({ month })

/** GET monthly?month=YYYY-MM: the report (default: this month so far), with `delivered`. */
export const monthlyGET = osbotRoute(async ({ url, owner }) =>
  monthlyReport(parseInput(monthlyInput, Object.fromEntries(url.searchParams)).month, owner.timezone),
)

/** POST monthly/pdf { month }: saves the PDF into Files → Reports; { saved, url, … }. */
export const monthlyPdfPOST = osbotRoute(async ({ body, owner }) =>
  saveReportPdf(await monthlyReport(parseInput(monthBody, body).month, owner.timezone)),
)

/** POST monthly/ack { month } once the card on the 1st is sent. */
export const monthlyAckPOST = osbotRoute(async ({ body }) => ({
  acked: await recordDeliveries("monthly", [parseInput(monthBody, body).month]),
}))
