"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Certificate, CloudCheck, Cube, Gauge, HardDrive, MemoryIcon, TriangleAlertIcon, type AppIcon } from "@/components/icons"
import { cn } from "@/lib/utils"
import type { ServerStatus } from "../host"
import {
  LIMITS,
  backupVerdict,
  certDaysLeft,
  certLevel,
  diskLevel,
  evaluateAlerts,
  memoryLevel,
  rebootLevel,
  type HostReport,
  type Level,
} from "../lib/server"
import { formatBytes, formatDuration } from "../lib/status"
import { pollServer } from "../server-actions"

const POLL_MS = 60_000

const levelDot: Record<Level, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-destructive",
  unknown: "bg-muted-foreground/50",
}
const levelText: Record<Level, string> = { ok: "OK", warn: "Watch", bad: "Needs attention", unknown: "Unknown" }
const meterFill: Record<Level, string> = { ok: "bg-primary", warn: "bg-amber-500", bad: "bg-destructive", unknown: "bg-muted-foreground/50" }

/**
 * Ops → Server: the host's vital signs from ops-agent (GET /host) and the
 * certificate of every site, refreshed every minute while the tab is visible.
 * The problems line uses the same rules as osbot's alerts (lib/server.ts).
 */
export function ServerPanel({
  initial,
  renderedAt,
  timezone,
  locale,
}: {
  initial: ServerStatus
  /** Server clock (ISO) so SSR and hydration agree. */
  renderedAt: string
  timezone: string
  locale: string
}) {
  const [status, setStatus] = useState(initial)
  const [now, setNow] = useState(() => new Date(renderedAt))

  useEffect(() => {
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible") return
      const next = await pollServer()
      if (next) setStatus(next)
      setNow(new Date())
    }, POLL_MS)
    return () => clearInterval(id)
  }, [])

  const { host, offline, certs } = status
  const problems = useMemo(
    () => evaluateAlerts({ host, offline: offline?.reason === "not_configured" ? null : offline, certs, services: null }, now),
    [host, offline, certs, now],
  )
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="server-title" className="text-eyebrow text-muted-foreground">
          Server
        </h2>
        {host && (
          <p className="text-caption min-w-0 truncate text-muted-foreground" data-testid="server-identity">
            {[host.hostname, host.os, host.uptime_seconds != null ? `up ${formatDuration(host.uptime_seconds * 1000)}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>

      {problems.length > 0 && (
        <div role="status" className="glass grid gap-1.5 rounded-xl p-4 ring-1 ring-destructive/30" aria-label="Server problems">
          <p className="text-body-strong flex items-center gap-2">
            <TriangleAlertIcon className="size-4 shrink-0 text-destructive" />
            {problems.length === 1 ? "1 problem" : `${problems.length} problems`}
          </p>
          <ul className="text-meta grid gap-1 text-muted-foreground">
            {problems.map((p) => (
              <li key={p.key}>
                <span className="text-foreground">{p.title}.</span> {p.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!host && offline && offline.reason !== "not_configured" && (
        <p className="text-meta glass rounded-xl p-4 text-muted-foreground">
          Can&apos;t read the server&apos;s vitals: {"message" in offline ? offline.message : "the agent refused the signature."}
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Server">
        {host && (
          <>
            <DiskTile host={host} />
            <MemoryTile host={host} />
            <SystemTile host={host} now={now} when={when} />
            <BackupTile host={host} now={now} when={when} />
            <DockerTile host={host} />
          </>
        )}
        <CertTile status={status} now={now} />
      </ul>
    </>
  )
}

function Tile({
  icon: Icon,
  title,
  level,
  children,
  className,
}: {
  icon: AppIcon
  title: string
  level: Level
  children: ReactNode
  className?: string
}) {
  return (
    <li className={className}>
      <article
        aria-label={title}
        className={cn(
          "glass grid h-full content-start gap-2 rounded-xl p-4",
          level === "bad" && "ring-1 ring-destructive/40",
          level === "warn" && "ring-1 ring-amber-500/40",
        )}
      >
        <header className="flex items-center gap-2">
          <Icon className="size-4 shrink-0 text-text-accent" />
          <h3 className="text-eyebrow min-w-0 flex-1 truncate text-muted-foreground">{title}</h3>
          <span className="text-caption flex shrink-0 items-center gap-1.5 text-muted-foreground">
            <span aria-hidden className={cn("size-2 rounded-full", levelDot[level])} />
            {levelText[level]}
          </span>
        </header>
        {children}
      </article>
    </li>
  )
}

function Meter({ value, level, label }: { value: number; level: Level; label: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} className="h-1.5 overflow-hidden rounded-full bg-track">
      <div className={cn("h-full rounded-full", meterFill[level])} style={{ width: `${v}%` }} />
    </div>
  )
}

function Unknown({ why }: { why?: string }) {
  return <p className="text-meta text-muted-foreground">{why ? `Not available: ${why}.` : "Not available."}</p>
}

function DiskTile({ host }: { host: HostReport }) {
  const d = host.disk
  const level = diskLevel(d)
  return (
    <Tile icon={HardDrive} title="Disk" level={level}>
      {d ? (
        <>
          <p className="text-metric tabular-nums">{Math.round(d.used_percent)} %</p>
          <Meter value={d.used_percent} level={level} label="Disk used" />
          <p className="text-caption text-muted-foreground tabular-nums">
            {formatBytes(d.available_bytes)} free of {formatBytes(d.total_bytes)} · alert above {LIMITS.diskAlertPercent} %
          </p>
        </>
      ) : (
        <Unknown why={host.errors.disk} />
      )}
    </Tile>
  )
}

function MemoryTile({ host }: { host: HostReport }) {
  const m = host.memory
  const level = memoryLevel(m)
  return (
    <Tile icon={MemoryIcon} title="Memory" level={level}>
      {m ? (
        <>
          <p className="text-metric tabular-nums">
            {formatBytes(m.used_bytes)} <span className="text-meta text-muted-foreground">of {formatBytes(m.total_bytes)}</span>
          </p>
          <Meter value={(m.used_bytes / m.total_bytes) * 100} level={level} label="Memory used" />
          <p className="text-caption text-muted-foreground tabular-nums">
            {formatBytes(m.available_bytes)} available
            {m.swap_total_bytes > 0 && <> · swap {formatBytes(m.swap_used_bytes)} of {formatBytes(m.swap_total_bytes)}</>}
            {m.psi_some_avg60 != null && <> · stalls {m.psi_some_avg60.toFixed(1)} %</>}
          </p>
        </>
      ) : (
        <Unknown why={host.errors.memory} />
      )}
    </Tile>
  )
}

function SystemTile({ host, now, when }: { host: HostReport; now: Date; when: (iso: string) => string }) {
  const reboot = host.reboot
  const level = rebootLevel(reboot, now)
  return (
    <Tile icon={Gauge} title="System" level={level === "unknown" ? "ok" : level}>
      <p className="text-metric tabular-nums">
        {host.load ? host.load.map((l) => l.toFixed(2)).join(" · ") : "–"}
        <span className="text-meta text-muted-foreground"> load{host.cpus ? ` · ${host.cpus} CPUs` : ""}</span>
      </p>
      <dl className="text-caption grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-muted-foreground">
        <dt>Kernel</dt>
        <dd className="truncate text-foreground tabular-nums">{host.kernel || "–"}</dd>
        <dt>Booted</dt>
        <dd className="truncate tabular-nums">{host.boot_time ? when(host.boot_time) : "–"}</dd>
        <dt>Reboot</dt>
        <dd className={cn("min-w-0", level === "bad" ? "text-destructive" : level === "warn" && "text-warning-text")} data-testid="reboot-status">
          {!reboot
            ? `unknown${host.errors.reboot ? ` (${host.errors.reboot})` : ""}`
            : !reboot.required
              ? "not needed"
              : `pending${reboot.since ? ` for ${formatDuration(now.getTime() - new Date(reboot.since).getTime())}` : ""}${
                  reboot.packages.length ? ` · ${reboot.packages.slice(0, 3).join(", ")}${reboot.packages.length > 3 ? "…" : ""}` : ""
                }`}
        </dd>
      </dl>
    </Tile>
  )
}

function BackupTile({ host, now, when }: { host: HostReport; now: Date; when: (iso: string) => string }) {
  const verdict = backupVerdict(host.backup, host.errors.backup, now)
  const ok = host.backup?.last_success
  const last = host.backup?.last
  return (
    <Tile icon={CloudCheck} title="Backup" level={verdict.level === "unknown" ? "warn" : verdict.level}>
      <p className={cn("text-body-strong", verdict.level === "bad" && "text-destructive")}>
        {verdict.ageMs != null && verdict.level === "ok" ? `${formatDuration(verdict.ageMs)} ago` : verdict.title}
      </p>
      <dl className="text-caption grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-muted-foreground">
        {ok?.finished_at && (
          <>
            <dt>Last good</dt>
            <dd className="truncate tabular-nums">
              {when(ok.finished_at)}
              {ok.size_bytes ? ` · ${formatBytes(ok.size_bytes)}` : ""}
              {ok.offsite ? " · off-site" : " · local only"}
            </dd>
          </>
        )}
        {last?.status === "failed" && (
          <>
            <dt>Last run</dt>
            <dd className="min-w-0 text-destructive">
              failed{last.finished_at ? ` ${when(last.finished_at)}` : ""}
              {last.error ? `: ${last.error}` : ""}
            </dd>
          </>
        )}
        {verdict.level !== "ok" && !last && (
          <>
            <dt>Why</dt>
            <dd className="min-w-0">{verdict.detail}</dd>
          </>
        )}
        <dt>Alert</dt>
        <dd>failed, or none for {LIMITS.backupMaxAgeHours} h</dd>
      </dl>
    </Tile>
  )
}

function DockerTile({ host }: { host: HostReport }) {
  const d = host.docker_disk
  return (
    <Tile icon={Cube} title="Docker" level={d ? "ok" : "unknown"}>
      {d ? (
        <>
          <p className="text-metric tabular-nums">{formatBytes(d.total_bytes)}</p>
          <dl className="text-caption grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground tabular-nums">
            <div>
              <dt className="inline">Images </dt>
              <dd className="inline text-foreground">{formatBytes(d.images_bytes)}</dd>
              <span> · {d.images}{d.unused_images ? `, ${d.unused_images} unused` : ""}</span>
            </div>
            <div>
              <dt className="inline">Volumes </dt>
              <dd className="inline text-foreground">{formatBytes(d.volumes_bytes)}</dd>
            </div>
            <div>
              <dt className="inline">Containers </dt>
              <dd className="inline text-foreground">{formatBytes(d.containers_bytes)}</dd>
            </div>
            <div>
              <dt className="inline">Build cache </dt>
              <dd className="inline text-foreground">{formatBytes(d.build_cache_bytes)}</dd>
            </div>
          </dl>
          {host.docker_version && <p className="text-caption text-muted-foreground">Docker {host.docker_version}</p>}
        </>
      ) : (
        <Unknown why={host.errors.docker_disk} />
      )}
    </Tile>
  )
}

function CertTile({ status, now }: { status: ServerStatus; now: Date }) {
  const { certs } = status
  const levels = certs.map((c) => certLevel(c, now))
  const level: Level = levels.includes("bad") ? "bad" : levels.includes("warn") ? "warn" : certs.length ? "ok" : "unknown"
  return (
    <Tile icon={Certificate} title="Certificates" level={level} className="sm:col-span-2 xl:col-span-1">
      {certs.length === 0 ? (
        <p className="text-meta text-muted-foreground">
          {status.host?.errors.sites ? `No site list: ${status.host.errors.sites}.` : "No HTTPS sites to check here."}
        </p>
      ) : (
        <ul className="grid gap-1" aria-label="Certificates">
          {certs.map((c, i) => {
            const days = certDaysLeft(c, now)
            return (
              <li key={c.domain} className="text-caption flex min-w-0 items-center gap-2" title={c.error ?? c.issuer ?? undefined}>
                <span aria-hidden className={cn("size-2 shrink-0 rounded-full", levelDot[levels[i]!])} />
                <span className="min-w-0 flex-1 truncate text-foreground">{c.domain}</span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums text-muted-foreground",
                    levels[i] === "bad" && "text-destructive",
                    levels[i] === "warn" && "text-warning-text",
                  )}
                >
                  {days == null ? "couldn't check" : days < 0 ? "expired" : !c.trusted ? "not trusted" : `${days} d left`}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Tile>
  )
}
