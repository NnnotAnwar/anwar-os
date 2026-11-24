import "server-only"
import { agentRequest, isAgentError } from "./agent"
import type { CertCheck, HostReport } from "./lib/server"
import type { Offline } from "./schema"
import { checkCertificates, ownDomain } from "./tls"

export type ServerStatus = {
  /** Null when the agent isn't configured, can't be reached or is too old for GET /host. */
  host: HostReport | null
  offline: Offline | null
  certs: CertCheck[]
  checkedAt: string
}

/**
 * The Server section's data: ops-agent's GET /host plus a certificate check
 * for every domain in the edge site files (or, without the agent, the site's
 * own domain). Never throws.
 */
export async function loadServerStatus(): Promise<ServerStatus> {
  const res = await agentRequest<{ host: HostReport }>("GET", "/host", undefined, 35_000)
  let host: HostReport | null = null
  let offline: Offline | null = null
  if (!res.ok && res.status === 404) {
    // An agent from before GET /host answers with Go's plain-text 404.
    offline = { reason: "error", message: "This ops-agent has no GET /host yet: deploy the current image." }
  } else if (!res.ok) {
    offline = res.reason === "unreachable" || res.reason === "error" ? { reason: res.reason, message: res.message } : { reason: res.reason }
  } else if (res.status === 200 && res.data?.host && typeof res.data.host === "object") {
    host = { ...res.data.host, sites: res.data.host.sites ?? [], errors: res.data.host.errors ?? {} }
  } else {
    offline = {
      reason: "error",
      message:
        res.status === 404
          ? "This ops-agent has no GET /host yet: deploy the current image."
          : isAgentError(res.data)
            ? res.data.message
            : `The agent answered ${res.status}.`,
    }
  }

  const own = ownDomain()
  const domains = host?.sites.length ? host.sites : own ? [own] : []
  const certs = await checkCertificates([...new Set(domains)])
  return { host, offline, certs, checkedAt: new Date().toISOString() }
}
