import "server-only"
import { internalApi, parseInput } from "@/core/internal-api"
import { signatureHeaderNames } from "@/lib/signed-request"
import { drillReportInput } from "./lib/drill"
import { drillSource, saveDrillReport } from "./restore-drill"

// /api/ops/restore-drill/*: the monthly restore drill in GitHub Actions
// (infra/backup/drill.sh) asks for the newest backup and reports how the
// restore went. Unlike the bots' /api/internal/* these are reachable from the
// internet (GitHub's runners), so everything rests on the signature: the
// shared internal API factory with its own secret (RESTORE_DRILL_SECRET, also
// a GitHub secret) and x-drill-* headers (HMAC over timestamp, nonce, method,
// path and body; 60 s window; each signature once). Off (404) without the
// secret. Handlers act as the site owner; all they can do is hand out a
// 15-minute read link to one encrypted backup and record a drill.

export const DRILL_SIGNATURE_HEADERS = signatureHeaderNames("x-drill")

const drillRoute = internalApi({ name: "restore-drill api", secretEnv: "RESTORE_DRILL_SECRET", headers: DRILL_SIGNATURE_HEADERS })

/** POST source: { url, expiresIn, file, bytes, lastModified, previous }. */
export const drillSourcePOST = drillRoute(async () => drillSource())

/** POST report: the drill's outcome (lib/drill.ts drillReportInput). */
export const drillReportPOST = drillRoute(async ({ body }) => saveDrillReport(parseInput(drillReportInput, body)))
