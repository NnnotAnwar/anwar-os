import "server-only"
import { TelegramLogo } from "@/components/icons"
import { cn } from "@/lib/utils"
import { osbotStatus, type OsbotStatus } from "../service"

// Settings → Telegram: is osbot connected? Reads the bot's last heartbeat
// (osbot_heartbeats, RLS: the viewer's own row). Server component; render it
// inside <Suspense> (it reads the session and the clock).

type State = "connected" | "stale" | "waiting" | "off"

function stateOf(status: OsbotStatus): State {
  if (!status.configured) return "off"
  if (status.connected) return "connected"
  return status.lastBeatAt ? "stale" : "waiting"
}

const labels: Record<State, string> = {
  connected: "Connected",
  stale: "Not responding",
  waiting: "Waiting for the bot",
  off: "Not set up",
}

const dots: Record<State, string> = {
  connected: "bg-emerald-500",
  stale: "bg-warning-text",
  waiting: "bg-warning-text",
  off: "bg-muted-foreground/50",
}

export function ago(fromIso: string, now: Date) {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(fromIso).getTime()) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

export async function TelegramStatus() {
  const now = new Date()
  const status = await osbotStatus(now)
  const state = stateOf(status)
  const directAlerts = Boolean(process.env.OSBOT_TOKEN && process.env.OSBOT_OWNER_CHAT_ID)

  let detail: string
  switch (state) {
    case "connected":
      detail = `Last heartbeat ${ago(status.lastBeatAt!, now)}${status.version && status.version !== "dev" ? ` · version ${status.version.slice(0, 7)}` : ""}. Reminders, feedback alerts and quick capture are on.`
      break
    case "stale":
      detail = `Last heartbeat ${ago(status.lastBeatAt!, now)}. ${directAlerts ? "Feedback alerts go out directly meanwhile; reminders wait for the bot." : "Reminders and alerts wait for the bot."}`
      break
    case "waiting":
      detail = "The API is on, but the bot hasn't checked in yet. Start bot-osbot on the server."
      break
    case "off":
      detail = `Set OSBOT_TOKEN, OSBOT_OWNER_CHAT_ID and OSBOT_API_SECRET in the server's .env and deploy (docs/DEPLOY.md, “Connect osbot”).${directAlerts ? " Feedback alerts already go out directly." : ""}`
      break
  }

  return (
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-field text-text-accent" aria-hidden>
        <TelegramLogo className="size-5" />
      </span>
      <div className="grid min-w-0 gap-1">
        <p className="flex items-center gap-2 text-body-strong">
          <span className={cn("size-2 shrink-0 rounded-full", dots[state])} aria-hidden />
          osbot · {labels[state]}
        </p>
        <p className="text-meta text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}
