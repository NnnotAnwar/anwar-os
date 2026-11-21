"use client"

import { Cpu, Lock, MemoryIcon, Play, Refresh, Rocket, StopIcon, Terminal } from "@/components/icons"
import { RowContextMenu } from "@/components/list/row-menu"
import type { RowAction } from "@/components/list/swipe-row"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { memoryLabel, serviceStatus, shortTag, statusLabels, uptimeLabel } from "../lib/status"
import type { AgentService } from "../schema"
import { StatusDot } from "./status-dot"

export type CardHandlers = {
  logs: (s: AgentService) => void
  restart: (s: AgentService) => void
  start: (s: AgentService) => void
  stop: (s: AgentService) => void
  deploy: (s: AgentService) => void
}

/** What a service offers, in one list for its buttons, its menu and its keys. */
export function serviceActions(s: AgentService, h: CardHandlers): RowAction[] {
  const running = s.state === "running" || s.state === "restarting"
  const list: RowAction[] = [{ id: "logs", label: "Logs", icon: Terminal, onSelect: () => h.logs(s), shortcut: "L" }]
  if (running) list.push({ id: "restart", label: "Restart", icon: Refresh, onSelect: () => h.restart(s), shortcut: "R" })
  else list.push({ id: "start", label: "Start", icon: Play, tone: "accent", onSelect: () => h.start(s), shortcut: "S" })
  if (!s.protected) {
    list.push({ id: "deploy", label: "Deploy a tag…", icon: Rocket, onSelect: () => h.deploy(s), shortcut: "D" })
    if (running) list.push({ id: "stop", label: "Stop…", icon: StopIcon, tone: "destructive", onSelect: () => h.stop(s), shortcut: "S" })
  }
  return list
}

export function ServiceCard({
  service: s,
  busy,
  now,
  handlers,
}: {
  service: AgentService
  /** The action in flight on this card ("restart", "deploy", …). */
  busy: string | null
  now: Date
  handlers: CardHandlers
}) {
  const status = serviceStatus(s)
  const uptime = uptimeLabel(s, now)
  const mem = memoryLabel(s)
  const actions = serviceActions(s, handlers)
  const running = s.state === "running" || s.state === "restarting"

  return (
    <li data-row-id={s.name} id={`service-${s.name}`} className="scroll-mt-24">
      <RowContextMenu actions={actions} label={s.name} render={<div />}>
        <article
          aria-busy={busy ? true : undefined}
          className={cn(
            "glass grid h-full content-start gap-3 rounded-xl p-4 transition-opacity",
            status === "down" && "ring-1 ring-destructive/40",
            status === "attention" && "ring-1 ring-amber-500/40",
          )}
        >
          <header className="flex items-start gap-2.5">
            <StatusDot status={status} className="mt-1.5" />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <h3 className="flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  data-row-primary
                  onClick={() => handlers.logs(s)}
                  className="text-body-strong truncate rounded text-left outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {s.name}
                </button>
                {s.protected && (
                  <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Protected: can't be stopped or deployed here" />
                )}
              </h3>
              <p className="text-caption truncate text-muted-foreground">
                <span className={cn(status === "down" && "text-destructive", status === "attention" && "text-warning-text")}>
                  {busy ? busyLabel(busy) : statusLabels[status]}
                </span>
                {uptime && <> · {uptime}</>}
                {s.health === "unhealthy" && <> · healthcheck failing</>}
                {status === "down" && <> · exit {s.exit_code}</>}
              </p>
            </div>
            {s.role && <span className="text-micro shrink-0 rounded-md bg-track px-1.5 py-0.5 text-muted-foreground">{s.role}</span>}
          </header>

          <dl className="text-caption grid grid-cols-2 gap-x-3 gap-y-1.5 text-muted-foreground">
            <div className="col-span-2 flex min-w-0 items-center gap-1.5">
              <dt className="sr-only">Image</dt>
              <dd className="min-w-0 truncate" title={`${s.image}:${s.tag}`}>
                <span className="text-foreground tabular-nums">{shortTag(s.tag)}</span>
                {s.revision && s.tag !== s.revision && <span className="tabular-nums"> · {s.revision.slice(0, 7)}</span>}
                <span className="opacity-70"> · {s.image.replace(/^ghcr\.io\//, "")}</span>
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt>
                <Cpu className="size-3.5" aria-label="CPU" />
              </dt>
              <dd className="tabular-nums">{s.cpu_percent != null ? `${s.cpu_percent.toFixed(1)} %` : "–"}</dd>
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <dt>
                <MemoryIcon className="size-3.5" aria-label="Memory" />
              </dt>
              <dd className="truncate tabular-nums">{mem ?? "–"}</dd>
            </div>
            <div className="col-span-2 flex items-center gap-1.5">
              <dt>Restarts</dt>
              <dd className={cn("tabular-nums", s.restart_count > 0 && "text-warning-text")}>{s.restart_count}</dd>
            </div>
          </dl>

          <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap" data-row-tools>
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => handlers.logs(s)}>
              <Terminal />
              Logs
            </Button>
            {running ? (
              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={!!busy} onClick={() => handlers.restart(s)}>
                <Refresh className={cn(busy === "restart" && "animate-spin")} />
                Restart
              </Button>
            ) : (
              <Button size="sm" className="min-h-11 sm:min-h-8" disabled={!!busy} onClick={() => handlers.start(s)}>
                <Play />
                Start
              </Button>
            )}
            {!s.protected && (
              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={!!busy} onClick={() => handlers.deploy(s)}>
                <Rocket />
                Deploy
              </Button>
            )}
            {!s.protected && running && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 text-muted-foreground hover:text-destructive sm:min-h-8"
                disabled={!!busy}
                onClick={() => handlers.stop(s)}
              >
                <StopIcon />
                Stop
              </Button>
            )}
          </div>
        </article>
      </RowContextMenu>
    </li>
  )
}

function busyLabel(action: string) {
  switch (action) {
    case "restart":
      return "Restarting…"
    case "start":
      return "Starting…"
    case "stop":
      return "Stopping…"
    case "deploy":
      return "Deploying…"
    default:
      return "Working…"
  }
}
