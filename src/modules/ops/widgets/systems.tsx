import NextLink from "next/link"
import { CheckCircle, Plugs } from "@/components/icons"
import { actions } from "../actions"
import { StatusDot } from "../components/status-dot"
import { needsAttention, serviceStatus, statusLabels } from "../lib/status"

const rowClass =
  "flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 -mx-2 outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"

/** Today tile: "All 7 systems running" or which ones need attention. */
export async function Systems() {
  const res = await actions.services.handler({ stats: false })
  if (!res.connected) {
    return (
      <p className="text-meta flex items-center gap-2 text-muted-foreground">
        <Plugs className="size-4 shrink-0" />
        {res.reason === "not_configured" ? "Control panel not connected." : "Can't reach the control panel agent."}
      </p>
    )
  }
  const bad = res.services.filter(needsAttention)
  if (bad.length === 0) {
    return (
      <NextLink href="/app/ops" className={`${rowClass} self-start`}>
        <CheckCircle className="size-5 shrink-0 text-emerald-500" />
        <span className="text-body">
          All <span className="tabular-nums">{res.services.length}</span> systems running
        </span>
      </NextLink>
    )
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <p className="flex items-baseline gap-1.5">
        <span className="text-metric text-destructive tabular-nums">{bad.length}</span>
        <span className="text-meta text-muted-foreground">
          of {res.services.length} {bad.length === 1 ? "needs" : "need"} attention
        </span>
      </p>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
        {bad.slice(0, 4).map((s) => {
          const status = serviceStatus(s)
          return (
            <li key={s.name}>
              <NextLink href={`/app/ops#service-${s.name}`} className={rowClass}>
                <StatusDot status={status} />
                <span className="text-body min-w-0 flex-1 truncate">{s.name}</span>
                <span className="text-caption shrink-0 text-muted-foreground">{statusLabels[status]}</span>
              </NextLink>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
