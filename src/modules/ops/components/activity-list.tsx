import { History, Play, Refresh, Rocket, StopIcon, type AppIcon } from "@/components/icons"
import { EmptyState } from "@/components/list/shortcut-hint"
import { formatRelative } from "@/lib/time"
import { cn } from "@/lib/utils"
import { formatDuration, shortTag } from "../lib/status"
import { actionLabels, type OpsAction, type OpsEvent, type OpsResult } from "../schema"

const icons: Record<OpsAction, AppIcon> = { start: Play, stop: StopIcon, restart: Refresh, deploy: Rocket }

const verbs: Record<OpsAction, string> = { start: "Started", stop: "Stopped", restart: "Restarted", deploy: "Deployed" }

const resultLabel: Record<OpsResult, string> = { pending: "Running", ok: "Done", error: "Failed", refused: "Refused" }

function sentence(e: OpsEvent) {
  const undo = e.detail.undoOf ? " (undo)" : ""
  if (e.action === "deploy") {
    const tag = e.detail.tag ? shortTag(e.detail.tag) : "a tag"
    if (e.result === "error" && e.detail.rolledBack) return `Deploy of ${tag} rolled back on ${e.service}${undo}`
    return `${e.result === "ok" ? "Deployed" : "Deploy"} ${tag} to ${e.service}${undo}`
  }
  return `${e.result === "ok" ? verbs[e.action] : actionLabels[e.action]} ${e.service}${undo}`
}

/** The audit trail (ops_events): who did what to which service, when, and how it went. */
export function ActivityList({ events, now, locale }: { events: OpsEvent[]; now: Date; locale: string }) {
  if (events.length === 0) {
    return (
      <EmptyState icon={History} title="No activity yet">
        Starts, stops, restarts and deploys from this panel show up here, with who did them and how they ended.
      </EmptyState>
    )
  }
  return (
    <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl">
      {events.map((e) => {
        const Icon = icons[e.action]
        return (
          <li key={e.id} className="flex gap-3 px-3 py-2.5 sm:px-4">
            <span
              className={cn(
                "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-track text-muted-foreground [&_svg]:size-3.5",
                e.result === "error" && "bg-error-surface text-destructive",
                e.result === "refused" && "bg-warning-surface text-warning-text",
              )}
            >
              <Icon />
            </span>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <p className="text-body min-w-0 truncate">{sentence(e)}</p>
              <p className="text-caption text-muted-foreground">
                <span
                  className={cn(
                    e.result === "ok" && "text-foreground",
                    e.result === "error" && "text-destructive",
                    e.result === "refused" && "text-warning-text",
                  )}
                >
                  {resultLabel[e.result]}
                </span>
                {e.durationMs != null && <span className="tabular-nums"> · {formatDuration(e.durationMs)}</span>}
                {e.actor && <> · {e.actor}</>}
              </p>
              {e.error && <p className="text-caption line-clamp-2 text-destructive">{e.error}</p>}
            </div>
            <time dateTime={e.createdAt} className="text-caption shrink-0 text-muted-foreground tabular-nums">
              {formatRelative(new Date(e.createdAt), now, locale)}
            </time>
          </li>
        )
      })}
    </ul>
  )
}
