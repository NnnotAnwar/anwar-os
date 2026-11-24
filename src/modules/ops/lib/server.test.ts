import { describe, expect, it } from "vitest"
import type { AgentService } from "../schema"
import {
  backupVerdict,
  certDaysLeft,
  certLevel,
  diskLevel,
  evaluateAlerts,
  memoryLevel,
  memoryPressure,
  rebootLevel,
  toCertCheck,
  type CertCheck,
  type HostReport,
} from "./server"

const NOW = new Date("2026-11-24T12:00:00Z")
const GB = 1024 ** 3
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const daysAhead = (d: number) => new Date(NOW.getTime() + d * 86_400_000 + 3_600_000).toISOString()

function healthyHost(over: Partial<HostReport> = {}): HostReport {
  return {
    time: NOW.toISOString(),
    hostname: "anwar-os",
    os: "Ubuntu 24.04.1 LTS",
    kernel: "6.8.0-49-generic",
    cpus: 2,
    uptime_seconds: 3 * 86_400,
    load: [0.2, 0.1, 0.1],
    memory: {
      total_bytes: 4 * GB,
      available_bytes: 3 * GB,
      used_bytes: 1 * GB,
      swap_total_bytes: 2 * GB,
      swap_used_bytes: 0.2 * GB,
      psi_some_avg60: 0.1,
      psi_full_avg60: 0,
    },
    disk: { path: "/", total_bytes: 38 * GB, used_bytes: 14 * GB, available_bytes: 22 * GB, used_percent: 38.9 },
    docker_disk: {
      images_bytes: 6 * GB,
      images: 30,
      unused_images: 20,
      containers_bytes: 0.1 * GB,
      containers: 6,
      volumes_bytes: 0.5 * GB,
      volumes: 3,
      build_cache_bytes: 0,
      total_bytes: 6.6 * GB,
    },
    reboot: { required: false, packages: [] },
    backup: {
      last: { status: "ok", finished_at: hoursAgo(10), size_bytes: 5_000_000, offsite: true },
      last_success: { status: "ok", finished_at: hoursAgo(10), size_bytes: 5_000_000, offsite: true },
    },
    sites: ["anwar-os.com"],
    errors: {},
    ...over,
  }
}

const cert = (over: Partial<CertCheck> = {}): CertCheck => ({
  domain: "anwar-os.com",
  validTo: daysAhead(60),
  issuer: "Let's Encrypt · E6",
  trusted: true,
  error: null,
  checkedAt: NOW.toISOString(),
  ...over,
})

const svc = (over: Partial<AgentService>): AgentService => ({
  name: "web",
  container: "anwar-os-web-1",
  image: "ghcr.io/nnnotanwar/anwar-os-web",
  tag: "0123456789abcdef0123456789abcdef01234567",
  state: "running",
  health: "healthy",
  exit_code: 0,
  restart_count: 0,
  protected: true,
  cpu_percent: null,
  mem_bytes: null,
  mem_limit_bytes: null,
  ...over,
})

describe("levels", () => {
  it("rates the disk like the alert: above 85 % is bad, above 75 % worth watching", () => {
    const disk = (p: number) => ({ path: "/", total_bytes: 1, used_bytes: 1, available_bytes: 1, used_percent: p })
    expect(diskLevel(disk(50))).toBe("ok")
    expect(diskLevel(disk(80))).toBe("warn")
    expect(diskLevel(disk(85))).toBe("warn")
    expect(diskLevel(disk(85.1))).toBe("bad")
    expect(diskLevel(null)).toBe("unknown")
  })

  it("calls memory pressure on little available memory, stalls or full swap", () => {
    const base = healthyHost().memory!
    expect(memoryPressure(base)).toBeNull()
    expect(memoryLevel(base)).toBe("ok")
    expect(memoryPressure({ ...base, available_bytes: 0.3 * GB })).toMatch(/available of 4.0 GB/)
    expect(memoryPressure({ ...base, psi_some_avg60: 12.5 })).toMatch(/waited for memory 13 %/)
    expect(memoryPressure({ ...base, swap_used_bytes: 1.9 * GB })).toMatch(/swap 1.9 GB of 2.0 GB/)
    expect(memoryLevel({ ...base, available_bytes: 0.7 * GB })).toBe("warn")
    // No swap configured and no PSI: only available memory counts.
    expect(memoryPressure({ ...base, swap_total_bytes: 0, swap_used_bytes: 0, psi_some_avg60: null })).toBeNull()
  })

  it("lets a reboot wait two days before it is a problem", () => {
    expect(rebootLevel({ required: false, packages: [] }, NOW)).toBe("ok")
    expect(rebootLevel({ required: true, since: hoursAgo(10), packages: [] }, NOW)).toBe("warn")
    expect(rebootLevel({ required: true, since: hoursAgo(49), packages: [] }, NOW)).toBe("bad")
    expect(rebootLevel(null, NOW)).toBe("unknown")
  })

  it("counts certificate days and flags short, expired and untrusted ones", () => {
    expect(certDaysLeft(cert({ validTo: daysAhead(30) }), NOW)).toBe(30)
    expect(certLevel(cert(), NOW)).toBe("ok")
    expect(certLevel(cert({ validTo: daysAhead(20) }), NOW)).toBe("warn")
    expect(certLevel(cert({ validTo: daysAhead(13) }), NOW)).toBe("bad")
    expect(certLevel(cert({ validTo: hoursAgo(2) }), NOW)).toBe("bad")
    expect(certLevel(cert({ trusted: false, error: "SELF_SIGNED" }), NOW)).toBe("bad")
    expect(certLevel(cert({ validTo: null, error: "ECONNREFUSED" }), NOW)).toBe("unknown")
  })
})

describe("backupVerdict", () => {
  it("is fine for a backup from last night", () => {
    const v = backupVerdict(healthyHost().backup, undefined, NOW)
    expect(v).toMatchObject({ level: "ok", ageMs: 10 * 3_600_000 })
    expect(v.detail).toMatch(/4.8 MB, off-site/)
  })

  it("flags a backup older than 26 hours", () => {
    const old = { status: "ok" as const, finished_at: hoursAgo(27), offsite: true }
    expect(backupVerdict({ last: old, last_success: old }, undefined, NOW)).toMatchObject({ level: "bad", title: "No backup for 1 d 3 h" })
  })

  it("flags a failed last run even when the last good one is recent", () => {
    const v = backupVerdict(
      {
        last: { status: "failed", error: "failed while uploading (exit 1)", offsite: false },
        last_success: { status: "ok", finished_at: hoursAgo(20), offsite: true },
      },
      undefined,
      NOW,
    )
    expect(v).toMatchObject({ level: "bad", title: "Last backup failed" })
    expect(v.detail).toMatch(/^failed while uploading \(exit 1\)\. Last good backup 20 h ago/)
  })

  it("says what's missing when there is no status", () => {
    expect(backupVerdict({ last: null, last_success: null }, undefined, NOW)).toMatchObject({ level: "bad", title: "No backup recorded yet" })
    expect(backupVerdict(null, "not mounted", NOW)).toMatchObject({ level: "unknown", title: "Backup status unknown" })
  })
})

describe("evaluateAlerts", () => {
  it("raises nothing for a healthy server", () => {
    expect(evaluateAlerts({ host: healthyHost(), offline: null, certs: [cert()], services: [svc({})] }, NOW)).toEqual([])
  })

  it("raises nothing at all when the panel isn't configured", () => {
    expect(evaluateAlerts({ host: null, offline: { reason: "not_configured" }, certs: [], services: null }, NOW)).toEqual([])
  })

  it("raises one alert per problem, each with a stable key", () => {
    const host = healthyHost({
      disk: { path: "/", total_bytes: 38 * GB, used_bytes: 33 * GB, available_bytes: 3 * GB, used_percent: 91.7 },
      memory: { ...healthyHost().memory!, available_bytes: 0.2 * GB },
      reboot: { required: true, since: hoursAgo(72), packages: ["linux-image-6.8.0-50-generic", "libc6"] },
      backup: { last: { status: "failed", error: "failed while dumping the database (exit 1)", offsite: false }, last_success: null },
    })
    const alerts = evaluateAlerts(
      {
        host,
        offline: null,
        certs: [cert(), cert({ domain: "shiftella.app", validTo: daysAhead(5) })],
        services: [
          svc({}),
          svc({ name: "bot-osbot", protected: false, state: "restarting", restart_count: 7, tag: "abc" }),
          svc({ name: "edge.caddy", health: "unhealthy" }),
          svc({ name: "bot-expenses", state: "exited", exit_code: 137, oom_killed: true }),
          svc({ name: "stopped-on-purpose", state: "exited", exit_code: 0 }),
        ],
      },
      NOW,
    )
    expect(alerts.map((a) => [a.key, a.title])).toEqual([
      ["disk", "Disk 92 % full"],
      ["memory", "Memory pressure"],
      ["backup", "Last backup failed"],
      ["reboot", "Reboot pending for 3 d"],
      ["cert:shiftella.app", "Certificate for shiftella.app expires in 5 days"],
      ["container:bot-osbot", "bot-osbot keeps restarting"],
      ["container:edge.caddy", "edge.caddy is unhealthy"],
      ["container:bot-expenses", "bot-expenses is down"],
    ])
    expect(alerts[0]!.detail).toBe("3.0 GB free of 38.0 GB on /. Docker uses 6.6 GB (images 6.0 GB).")
    expect(alerts[3]!.detail).toMatch(/^Asked for by linux-image-6.8.0-50-generic, libc6\./)
    expect(alerts[5]!.detail).toBe("7 restarts · image tag abc.")
    expect(alerts[7]!.detail).toBe("killed: out of memory · image tag 0123456.")
  })

  it("reports an unreachable agent once instead of guessing about the server", () => {
    const alerts = evaluateAlerts(
      { host: null, offline: { reason: "unreachable", message: "Can't reach the agent." }, certs: [cert()], services: null },
      NOW,
    )
    expect(alerts).toEqual([
      { key: "agent", kind: "agent", title: "ops-agent is unreachable", detail: "Can't reach the agent. Server checks are paused until it answers." },
    ])
  })

  it("doesn't turn missing data into problems, except the backup status", () => {
    const host = healthyHost({ disk: null, memory: null, reboot: null, backup: null, errors: { disk: "x", memory: "x", reboot: "not mounted", backup: "not mounted" } })
    expect(evaluateAlerts({ host, offline: null, certs: [cert({ validTo: null, error: "timeout" })], services: null }, NOW).map((a) => a.key)).toEqual(["backup"])
  })

  it("keeps titles and details within the database limits", () => {
    const long = "x".repeat(2000)
    const [a] = evaluateAlerts(
      { host: healthyHost({ backup: { last: { status: "failed", error: long, offsite: false }, last_success: null } }), offline: null, certs: [], services: null },
      NOW,
    )
    expect(a!.detail.length).toBeLessThanOrEqual(1000)
  })
})

describe("toCertCheck", () => {
  it("reads expiry and issuer from the peer certificate", () => {
    const c = toCertCheck("anwar-os.com", { valid_to: "Feb 20 10:00:00 2027 GMT", issuer: { O: "Let's Encrypt", CN: "E6" } }, true, null, NOW)
    expect(c).toMatchObject({ domain: "anwar-os.com", validTo: "2027-02-20T10:00:00.000Z", issuer: "Let's Encrypt · E6", trusted: true, error: null })
  })

  it("keeps an untrusted certificate's expiry and says why", () => {
    const c = toCertCheck("x.test", { valid_to: "Jan  1 00:00:00 2027 GMT", issuer: { CN: "x.test" } }, false, "DEPTH_ZERO_SELF_SIGNED_CERT", NOW)
    expect(c).toMatchObject({ trusted: false, error: "DEPTH_ZERO_SELF_SIGNED_CERT", issuer: "x.test" })
    expect(c.validTo).toBe("2027-01-01T00:00:00.000Z")
  })

  it("handles a handshake without a certificate", () => {
    expect(toCertCheck("x.test", {}, false, null, NOW)).toMatchObject({ validTo: null, error: "No certificate presented." })
  })
})
