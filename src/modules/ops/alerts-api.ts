import "server-only"
import { osbotRoute, parseInput } from "@/modules/osbot/api"
import { ackAlerts, ackAlertsInput, checkAlerts } from "./alerts"

// /api/internal/osbot/ops-alerts/*: osbot's server-alert loop
// (bots/osbot/osbot/ops_alerts.py). Same signed, owner-only wrapper as the
// rest of osbot's API; the files under src/app/api/internal/osbot/ops-alerts/
// re-export these.

/** POST ops-alerts/check: evaluate now; returns { checkedAt, firing, mutedUntil, notifications }. */
export const opsAlertsCheckPOST = osbotRoute(async () => checkAlerts())

/** POST ops-alerts/ack { items: [{ key, event: "firing" | "resolved" }] } once sent. */
export const opsAlertsAckPOST = osbotRoute(async ({ body }) => ackAlerts(parseInput(ackAlertsInput, body)))
