import "server-only"
import { internalApi, InternalApiError, type InternalApiContext } from "@/core/internal-api"
import { OSBOT_SIGNATURE_HEADERS } from "./signature"

// The wrapper every /api/internal/osbot/* handler goes through (the shared
// factory in src/core/internal-api.ts):
//   1. off (404) unless OSBOT_API_SECRET is set;
//   2. HMAC signature over timestamp, nonce, method, path + query and body
//      (signature.ts), 60 s window, each signature accepted once;
//   3. resolves the site owner (app.site_owner_id()) and runs the handler inside
//      actAs(owner), so module actions and asViewer() act as the owner and RLS
//      applies as usual. The bot never names a user: it can only ever act as
//      the owner.

export type OsbotContext = InternalApiContext

/** A client error the bot can show as is. */
export const OsbotApiError = InternalApiError
export type OsbotApiError = InternalApiError

export { parseInput } from "@/core/internal-api"

export const osbotRoute = internalApi({ name: "osbot api", secretEnv: "OSBOT_API_SECRET", headers: OSBOT_SIGNATURE_HEADERS })
