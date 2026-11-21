"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { ShortcutHint } from "@/components/list/shortcut-hint"
import { useListKeyboard } from "@/components/list/use-list-keyboard"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { shortTag, sortServices, summary } from "../lib/status"
import type { AgentService } from "../schema"
import { controlService, deployService, pollServices } from "../server-actions"
import { DeploySheet } from "./deploy-sheet"
import { LogSheet } from "./log-sheet"
import { ServiceCard, type CardHandlers } from "./service-card"

const POLL_MS = 10_000

/**
 * The live part of /app/ops: service cards refreshed every 10 s while the tab
 * is visible, and every action on them. Frequent, recoverable actions act in
 * one tap (restart; start with Undo); stop asks first; deploy goes through its
 * sheet and offers Undo (redeploy the previous tag) when it succeeds.
 */
export function OpsPanel({ initial, renderedAt }: { initial: AgentService[]; /** Server clock (ISO) so SSR and hydration agree. */ renderedAt: string }) {
  const [services, setServices] = useState(initial)
  const [busy, setBusy] = useState<Record<string, string>>({})
  const [logsFor, setLogsFor] = useState<string | null>(null)
  const [deployFor, setDeployFor] = useState<AgentService | null>(null)
  const [stopFor, setStopFor] = useState<AgentService | null>(null)
  const [now, setNow] = useState(() => new Date(renderedAt))
  const list = useRef<HTMLUListElement>(null)

  // A server refresh (after an action) brings a new snapshot: take it over.
  const [snapshot, setSnapshot] = useState(initial)
  if (snapshot !== initial) {
    setSnapshot(initial)
    setServices(initial)
  }

  useEffect(() => {
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible") return
      const res = await pollServices()
      if (res.connected) setServices(res.services)
      setNow(new Date())
    }, POLL_MS)
    return () => clearInterval(id)
  }, [])

  function replace(s: AgentService) {
    setServices((list) => list.map((x) => (x.name === s.name ? s : x)))
  }

  async function control(s: AgentService, action: "start" | "stop" | "restart", undoOf?: string) {
    setBusy((b) => ({ ...b, [s.name]: action }))
    const res = await controlService({ service: s.name, action, undoOf })
    setBusy((b) => without(b, s.name))
    if (!res.ok) {
      toast.error(`${s.name}: ${res.error}`)
      return
    }
    replace(res.service)
    setNow(new Date())
    if (undoOf) {
      toast.success(`${s.name} is ${action === "start" ? "running" : "stopped"} again`)
    } else if (action === "restart") {
      toast.success(`${s.name} restarted`)
    } else {
      const back = action === "start" ? "stop" : "start"
      toast.success(`${s.name} ${action === "start" ? "started" : "stopped"}`, {
        duration: 8000,
        action: { label: "Undo", onClick: () => void control(res.service, back, res.eventId) },
      })
    }
  }

  async function deploy(s: AgentService, tag: string, undoOf?: string) {
    setDeployFor(null)
    setBusy((b) => ({ ...b, [s.name]: "deploy" }))
    const id = toast.loading(`Deploying ${shortTag(tag)} to ${s.name}…`, {
      description: "Pulling the image and waiting for the healthcheck.",
    })
    const res = await deployService({ service: s.name, tag, undoOf })
    setBusy((b) => without(b, s.name))
    if (!res.ok) {
      toast.error(`${s.name}: deploy failed`, { id, description: res.error, duration: 15000 })
      return
    }
    if (res.outcome.service) replace(res.outcome.service)
    const previous = res.outcome.previous_tag
    toast.success(`${s.name} is on ${shortTag(tag)}`, {
      id,
      description: `Healthy after ${Math.round(res.outcome.seconds)} s.`,
      duration: 10000,
      action:
        undoOf || !previous || previous === tag
          ? undefined
          : { label: "Undo", onClick: () => void deploy(res.outcome.service ?? s, previous, res.eventId) },
    })
  }

  const handlers: CardHandlers = {
    logs: (s) => setLogsFor(s.name),
    restart: (s) => void control(s, "restart"),
    start: (s) => void control(s, "start"),
    stop: (s) => setStopFor(s),
    deploy: (s) => setDeployFor(s),
  }

  const shown = useMemo(() => sortServices(services), [services])
  const byName = (id: string | null) => shown.find((s) => s.name === id)

  useListKeyboard({
    container: list,
    handlers: { open: (id) => id && setLogsFor(id) },
    extra: {
      l: (id) => id && setLogsFor(id),
      r: (id) => {
        const s = byName(id)
        if (s && s.state === "running") handlers.restart(s)
      },
      d: (id) => {
        const s = byName(id)
        if (s && !s.protected) handlers.deploy(s)
      },
      s: (id) => {
        const s = byName(id)
        if (!s) return
        if (s.state === "running") {
          if (!s.protected) handlers.stop(s)
        } else handlers.start(s)
      },
    },
  })

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="services-title" className="text-eyebrow text-muted-foreground">
          Services
        </h2>
        <p className="text-caption text-muted-foreground tabular-nums" aria-live="polite">
          {summary(services)}
        </p>
      </div>
      <ul ref={list} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Services">
        {shown.map((s) => (
          <ServiceCard key={s.name} service={s} busy={busy[s.name] ?? null} now={now} handlers={handlers} />
        ))}
      </ul>
      <ShortcutHint
        items={[
          [["J", "K"], "Move"],
          [["L"], "Logs"],
          [["R"], "Restart"],
          [["S"], "Start / stop"],
          [["D"], "Deploy"],
        ]}
        touch="Long-press a card for all its actions."
      />

      <LogSheet service={logsFor} onOpenChange={(open) => !open && setLogsFor(null)} />
      <DeploySheet
        service={deployFor}
        onOpenChange={(open) => !open && setDeployFor(null)}
        onDeploy={(s, tag) => void deploy(s, tag)}
      />
      <AlertDialog open={stopFor !== null} onOpenChange={(open) => !open && setStopFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop {stopFor?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {stopFor?.kind === "bot"
                ? "The bot stops answering until you start it again, also after a server reboot."
                : "It stays stopped until you start it again, also after a server reboot."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const s = stopFor
                setStopFor(null)
                if (s) void control(s, "stop")
              }}
            >
              Stop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function without(map: Record<string, string>, key: string) {
  const next = { ...map }
  delete next[key]
  return next
}
