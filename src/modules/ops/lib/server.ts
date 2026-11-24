import type { OpsAlertKind } from "@/db/schema/ops"
import type { AgentService, Offline } from "../schema"
import { formatBytes, formatDuration, needsAttention, serviceStatus } from "./status"

// The Server section of /app/ops and the alerts osbot sends share one set of
// rules: this file turns what ops-agent reports (GET /host), the certificate
// checks and the service list into levels for the tiles and into alerts.
// Pure: no I/O, so the thresholds are unit-tested (server.test.ts).

// ---------------------------------------------------------------------------
// What ops-agent reports (services/ops-agent/internal/host)
// ---------------------------------------------------------------------------

export type BackupRun = {
  status: "ok" | "failed"
  started_at?: string
  finished_at?: string
  file?: string
  size_bytes?: number
  offsite: boolean
  error?: string
}

export type HostReport = {
  time: string
  hostname?: string
  os?: string
  kernel?: string
  arch?: string
  cpus?: number
  docker_version?: string
  uptime_seconds: number | null
  boot_time?: string
  /** 1, 5 and 15 minutes. */
  load: number[] | null
  memory: {
    total_bytes: number
    available_bytes: number
    used_bytes: number
    swap_total_bytes: number
    swap_used_bytes: number
    psi_some_avg60: number | null
    psi_full_avg60: number | null
  } | null
  disk: { path: string; total_bytes: number; used_bytes: number; available_bytes: number; used_percent: number } | null
  docker_disk: {
    images_bytes: number
    images: number
    unused_images: number
    containers_bytes: number
    containers: number
    volumes_bytes: number
    volumes: number
    build_cache_bytes: number
    total_bytes: number
  } | null
  reboot: { required: boolean; since?: string; packages: string[] } | null
  backup: { last: BackupRun | null; last_success: BackupRun | null } | null
  sites: string[]
  errors: Record<string, string>
}

/** One TLS certificate as served on 443 (lib/tls.ts). */
export type CertCheck = {
  domain: string
  /** ISO time the certificate stops being valid; null when the handshake failed. */
  validTo: string | null
  issuer: string | null
  /** Chain and hostname verified against the system's CAs. */
  trusted: boolean
  /** Why it isn't trusted, or why it couldn't be checked. */
  error: string | null
  checkedAt: string
}

/** The parts of node:tls' getPeerCertificate() we read. */
export type PeerCert = { valid_to?: string; issuer?: Record<string, string | string[] | undefined> }

/** Turns what the TLS socket saw (tls.ts) into a CertCheck. */
export function toCertCheck(
  domain: string,
  peer: PeerCert | null,
  authorized: boolean,
  authorizationError: unknown,
  now: Date,
): CertCheck {
  const checkedAt = now.toISOString()
  if (!peer || !peer.valid_to) {
    return { domain, validTo: null, issuer: null, trusted: false, error: "No certificate presented.", checkedAt }
  }
  const validTo = new Date(peer.valid_to)
  const issuer = [peer.issuer?.O, peer.issuer?.CN].flat().filter(Boolean).join(" · ") || null
  return {
    domain,
    validTo: Number.isNaN(validTo.getTime()) ? null : validTo.toISOString(),
    issuer,
    trusted: authorized,
    error: authorized ? null : String(authorizationError ?? "Not trusted."),
    checkedAt,
  }
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const LIMITS = {
  diskAlertPercent: 85,
  diskWarnPercent: 75,
  /** Memory pressure: available below this share of RAM… */
  memoryAvailableAlert: 0.1,
  /** …or tasks stalled on memory this share (%) of the last minute (PSI some avg60)… */
  psiSomeAlert: 10,
  /** …or swap this full. */
  swapAlert: 0.9,
  backupMaxAgeHours: 26,
  certAlertDays: 14,
  /** Caddy renews 30 days ahead; under 21 something is already off. */
  certWarnDays: 21,
  rebootAlertHours: 48,
} as const

export type Level = "ok" | "warn" | "bad" | "unknown"

const HOUR = 3_600_000
const DAY = 24 * HOUR

const pct = (n: number) => `${Math.round(n)} %`

export function diskLevel(disk: HostReport["disk"]): Level {
  if (!disk) return "unknown"
  if (disk.used_percent > LIMITS.diskAlertPercent) return "bad"
  if (disk.used_percent > LIMITS.diskWarnPercent) return "warn"
  return "ok"
}

/** Why memory is under pressure, or null when it isn't. */
export function memoryPressure(m: HostReport["memory"]): string | null {
  if (!m || m.total_bytes <= 0) return null
  const reasons: string[] = []
  if (m.available_bytes / m.total_bytes < LIMITS.memoryAvailableAlert) {
    reasons.push(`${formatBytes(m.available_bytes)} available of ${formatBytes(m.total_bytes)}`)
  }
  if (m.psi_some_avg60 != null && m.psi_some_avg60 >= LIMITS.psiSomeAlert) {
    reasons.push(`tasks waited for memory ${pct(m.psi_some_avg60)} of the last minute`)
  }
  if (m.swap_total_bytes > 0 && m.swap_used_bytes / m.swap_total_bytes >= LIMITS.swapAlert) {
    reasons.push(`swap ${formatBytes(m.swap_used_bytes)} of ${formatBytes(m.swap_total_bytes)}`)
  }
  return reasons.length ? reasons.join(" · ") : null
}

export function memoryLevel(m: HostReport["memory"]): Level {
  if (!m) return "unknown"
  if (memoryPressure(m)) return "bad"
  return m.available_bytes / m.total_bytes < 0.2 ? "warn" : "ok"
}

export type BackupVerdict = { level: Level; title: string; detail: string; ageMs: number | null }

/** The backup tile and the backup alert. */
export function backupVerdict(backup: HostReport["backup"], error: string | undefined, now: Date): BackupVerdict {
  if (!backup) {
    return {
      level: "unknown",
      title: "Backup status unknown",
      detail:
        error === "not mounted"
          ? "ops-agent can't see the backup status directory (BACKUP_STATUS_DIR)."
          : `ops-agent couldn't read the backup status${error ? `: ${error}` : "."}`,
      ageMs: null,
    }
  }
  const ok = backup.last_success
  const finished = ok?.finished_at ? new Date(ok.finished_at).getTime() : null
  const ageMs = finished != null && !Number.isNaN(finished) ? now.getTime() - finished : null
  const lastGood = ageMs != null ? `Last good backup ${formatDuration(ageMs)} ago` : "No good backup recorded yet"
  const size = ok?.size_bytes ? ` (${formatBytes(ok.size_bytes)}${ok.offsite ? ", off-site" : ", local only"})` : ""

  if (backup.last?.status === "failed") {
    return {
      level: "bad",
      title: "Last backup failed",
      detail: `${backup.last.error || "backup.sh exited with an error"}. ${lastGood}${size}.`,
      ageMs,
    }
  }
  if (ageMs == null) {
    return { level: "bad", title: "No backup recorded yet", detail: "Run the backup once: sudo systemctl start anwar-os-backup.service", ageMs }
  }
  if (ageMs > LIMITS.backupMaxAgeHours * HOUR) {
    return {
      level: "bad",
      title: `No backup for ${formatDuration(ageMs)}`,
      detail: `${lastGood}${size}. Is anwar-os-backup.timer running?`,
      ageMs,
    }
  }
  return { level: "ok", title: "Backup OK", detail: `${lastGood}${size}.`, ageMs }
}

export function certDaysLeft(c: CertCheck, now: Date): number | null {
  if (!c.validTo) return null
  const t = new Date(c.validTo).getTime()
  return Number.isNaN(t) ? null : Math.floor((t - now.getTime()) / DAY)
}

export function certLevel(c: CertCheck, now: Date): Level {
  const days = certDaysLeft(c, now)
  if (days == null) return "unknown" // couldn't connect: the uptime checks cover outages
  if (days < LIMITS.certAlertDays || !c.trusted) return "bad"
  if (days < LIMITS.certWarnDays) return "warn"
  return "ok"
}

export function rebootLevel(r: HostReport["reboot"], now: Date): Level {
  if (!r) return "unknown"
  if (!r.required) return "ok"
  const since = r.since ? new Date(r.since).getTime() : now.getTime()
  return now.getTime() - since > LIMITS.rebootAlertHours * HOUR ? "bad" : "warn"
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export type Alert = { key: string; kind: OpsAlertKind; title: string; detail: string }

export type AlertInput = {
  /** Null when the agent isn't configured or can't be reached (see `offline`). */
  host: HostReport | null
  offline: Offline | null
  certs: CertCheck[]
  /** Null when the service list couldn't be read. */
  services: AgentService[] | null
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * Everything that is wrong right now, one alert per problem with a stable key.
 * A source that couldn't be read raises nothing of its own (except the backup
 * status and an unreachable agent): no data is not the same as a problem.
 */
export function evaluateAlerts({ host, offline, certs, services }: AlertInput, now: Date): Alert[] {
  const alerts: Alert[] = []
  const add = (a: Alert) => alerts.push({ ...a, title: clip(a.title, 200), detail: clip(a.detail, 1000) })

  if (offline) {
    if (offline.reason === "not_configured") return []
    add({
      key: "agent",
      kind: "agent",
      title: offline.reason === "unauthorized" ? "ops-agent refuses web's signature" : "ops-agent is unreachable",
      detail:
        offline.reason === "unauthorized"
          ? "OPS_AGENT_SECRET differs between web and ops-agent. Server checks are paused."
          : `${"message" in offline ? offline.message : ""} Server checks are paused until it answers.`.trim(),
    })
  }

  if (host) {
    if (diskLevel(host.disk) === "bad" && host.disk) {
      const d = host.disk
      const docker = host.docker_disk ? ` Docker uses ${formatBytes(host.docker_disk.total_bytes)} (images ${formatBytes(host.docker_disk.images_bytes)}).` : ""
      add({
        key: "disk",
        kind: "disk",
        title: `Disk ${pct(d.used_percent)} full`,
        detail: `${formatBytes(d.available_bytes)} free of ${formatBytes(d.total_bytes)} on ${d.path}.${docker}`,
      })
    }
    const pressure = memoryPressure(host.memory)
    if (pressure) add({ key: "memory", kind: "memory", title: "Memory pressure", detail: `${pressure}.` })

    const backup = backupVerdict(host.backup, host.errors?.backup, now)
    if (backup.level !== "ok") add({ key: "backup", kind: "backup", title: backup.title, detail: backup.detail })

    if (host.reboot && rebootLevel(host.reboot, now) === "bad") {
      const since = host.reboot.since ? now.getTime() - new Date(host.reboot.since).getTime() : 0
      const pkgs = host.reboot.packages.slice(0, 5).join(", ")
      add({
        key: "reboot",
        kind: "reboot",
        title: `Reboot pending for ${formatDuration(since)}`,
        detail: `${pkgs ? `Asked for by ${pkgs}${host.reboot.packages.length > 5 ? "…" : ""}. ` : ""}Unattended upgrades should reboot at 04:30; check its log.`,
      })
    }
  }

  for (const c of certs) {
    if (certLevel(c, now) !== "bad") continue
    const days = certDaysLeft(c, now)!
    const until = c.validTo ? new Date(c.validTo).toISOString().slice(0, 10) : ""
    add({
      key: `cert:${c.domain}`,
      kind: "cert",
      title:
        days < 0
          ? `Certificate for ${c.domain} expired`
          : !c.trusted
            ? `Certificate for ${c.domain} isn't trusted`
            : `Certificate for ${c.domain} expires in ${days} ${days === 1 ? "day" : "days"}`,
      detail: `Valid until ${until}${c.issuer ? ` · ${c.issuer}` : ""}${c.error ? ` · ${c.error}` : ""}. Caddy should renew 30 days ahead: check the edge logs.`,
    })
  }

  for (const s of services ?? []) {
    if (!needsAttention(s)) continue
    const status = serviceStatus(s)
    const title =
      s.state === "restarting"
        ? `${s.name} keeps restarting`
        : s.health === "unhealthy"
          ? `${s.name} is unhealthy`
          : `${s.name} is down`
    const bits = [
      status === "down" ? (s.oom_killed ? "killed: out of memory" : `exit ${s.exit_code}`) : null,
      s.restart_count > 0 ? `${s.restart_count} ${s.restart_count === 1 ? "restart" : "restarts"}` : null,
      `image tag ${s.tag.length === 40 ? s.tag.slice(0, 7) : s.tag}`,
    ].filter(Boolean)
    add({ key: `container:${s.name}`.toLowerCase(), kind: "container", title, detail: `${bits.join(" · ")}.` })
  }

  return alerts
}

/** The UI labels of the kinds, in the order the settings list them. */
export const alertKindLabels: Record<OpsAlertKind, { label: string; description: string }> = {
  disk: { label: "Disk", description: `Root disk more than ${LIMITS.diskAlertPercent} % full` },
  memory: { label: "Memory", description: "Little memory left, heavy swapping or tasks stalled on memory" },
  backup: { label: "Backups", description: `Last backup failed, or none for ${LIMITS.backupMaxAgeHours} h` },
  cert: { label: "Certificates", description: `A site's certificate expires in under ${LIMITS.certAlertDays} days` },
  container: { label: "Services", description: "A container is down, unhealthy or restarting" },
  reboot: { label: "Reboot", description: `A reboot has been pending for more than ${LIMITS.rebootAlertHours / 24} days` },
  agent: { label: "Agent", description: "ops-agent can't be reached, so nothing else can be checked" },
}
