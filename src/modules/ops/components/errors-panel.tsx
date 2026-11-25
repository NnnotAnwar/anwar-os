"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Bug, Check, ChevronDown } from "@/components/icons"
import { EmptyState } from "@/components/list/shortcut-hint"
import { Button } from "@/components/ui/button"
import { formatRelative } from "@/lib/time"
import { cn } from "@/lib/utils"
import type { ErrorGroup, ErrorsView } from "../errors"
import { errorWhere, hourlySeries, last24h, moveError, routeTypeLabels, sourceLabels } from "../lib/errors-view"
import { changeErrorStatus, pollErrors } from "../server-actions"

const POLL_MS = 60_000
const count = (n: number) => new Intl.NumberFormat("en").format(n)

/**
 * Ops → Errors: server errors of the app and the bots, one row per cause
 * (fingerprint), newest first, refreshed every minute while visible. A row
 * opens to its stack; Resolve acts in one tap with Undo. A resolved error
 * that happens again comes back here on its own (and osbot says so).
 * Telegram links open a row directly: /app/ops#error-<id>.
 */
export function ErrorsPanel({ initial, renderedAt, timezone, locale }: { initial: ErrorsView; renderedAt: string; timezone: string; locale: string }) {
  const [view, setView] = useState(initial)
  const [now, setNow] = useState(() => new Date(renderedAt))
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // A server refresh brings a new snapshot: take it over.
  const [snapshot, setSnapshot] = useState(initial)
  if (snapshot !== initial) {
    setSnapshot(initial)
    setView(initial)
  }

  useEffect(() => {
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible") return
      const next = await pollErrors()
      if (next) setView(next)
      setNow(new Date())
    }, POLL_MS)
    return () => clearInterval(id)
  }, [])

  // Deep link from Telegram: open that row and bring it into view.
  useEffect(() => {
    const m = /^#error-([0-9a-f-]{36})$/.exec(window.location.hash)
    if (!m) return
    const id = m[1]!
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the URL hash happens after hydration by design
    setExpanded(id)
    requestAnimationFrame(() => document.getElementById(`error-${id}`)?.scrollIntoView({ block: "center" }))
  }, [])

  const when = (iso: string) => new Intl.DateTimeFormat(locale, { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))

  async function setStatus(group: ErrorGroup, status: "resolved" | "open", undo = false) {
    const before = view
    setBusy(group.id)
    setView((v) => moveError(v, group.id, status, new Date().toISOString()))
    const res = await changeErrorStatus({ id: group.id, status })
    setBusy(null)
    if (!res.ok) {
      setView(before)
      toast.error(res.error)
      return
    }
    if (undo) {
      toast.success("Back in open errors")
      return
    }
    toast.success("Resolved", {
      description: "If it happens again, it comes back.",
      action: { label: "Undo", onClick: () => void setStatus({ ...group, status: "resolved" }, "open", true) },
    })
  }

  const recent = view.open.reduce((n, g) => n + last24h(g.hourly, g.hourlyAt, now), 0)

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="errors-title" className="text-eyebrow text-muted-foreground">
          Errors
        </h2>
        {view.open.length > 0 && (
          <p className="text-caption text-muted-foreground tabular-nums" data-testid="errors-summary">
            {count(view.open.length)} open · {count(recent)} in the last 24 h
          </p>
        )}
      </div>

      {view.open.length === 0 ? (
        <EmptyState icon={Bug} title="No open errors">
          Server errors of the app and the bots land here, grouped by cause. A resolved error that happens again comes back.
        </EmptyState>
      ) : (
        <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl" aria-label="Open errors">
          {view.open.map((g) => (
            <ErrorRow
              key={g.id}
              group={g}
              now={now}
              locale={locale}
              when={when}
              open={expanded === g.id}
              onToggle={() => setExpanded((id) => (id === g.id ? null : g.id))}
              busy={busy === g.id}
              onResolve={() => void setStatus(g, "resolved")}
            />
          ))}
        </ul>
      )}

      {view.resolved.length > 0 && (
        <details className="group/resolved">
          <summary className="text-meta flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8">
            <ChevronDown className="size-3.5 transition-transform group-open/resolved:rotate-180" />
            Recently resolved ({view.resolved.length})
          </summary>
          <ul className="glass mt-2 divide-y divide-hairline overflow-hidden rounded-xl" aria-label="Recently resolved errors">
            {view.resolved.map((g) => (
              <li key={g.id} className="flex items-start gap-3 px-3 py-2.5 sm:px-4">
                <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <p className="text-body min-w-0 truncate text-muted-foreground">{title(g)}</p>
                  <p className="text-caption text-muted-foreground">
                    {errorWhere(g)} · ×{count(g.count)}
                    {g.resolvedAt && <> · resolved {formatRelative(new Date(g.resolvedAt), now, locale)}</>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

function title(g: Pick<ErrorGroup, "name" | "message">) {
  return g.message ? `${g.name}: ${g.message}` : g.name
}

function ErrorRow({
  group: g,
  now,
  locale,
  when,
  open,
  onToggle,
  busy,
  onResolve,
}: {
  group: ErrorGroup
  now: Date
  locale: string
  when: (iso: string) => string
  open: boolean
  onToggle: () => void
  busy: boolean
  onResolve: () => void
}) {
  const series = hourlySeries(g.hourly, g.hourlyAt, now)
  const day = series.reduce((a, b) => a + b, 0)
  const panel = `error-${g.id}-details`
  return (
    <li id={`error-${g.id}`} className="grid scroll-mt-24 gap-2 px-3 py-3 sm:px-4" data-testid="error-row">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panel}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-error-surface text-destructive [&_svg]:size-3.5">
            <Bug />
          </span>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-body-strong line-clamp-2 break-words">{title(g)}</span>
            <span className="text-caption flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
              <span className="min-w-0 break-all">{errorWhere(g)}</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums text-foreground">×{count(g.count)}</span>
              <span aria-hidden>·</span>
              <time dateTime={g.lastSeen} className="tabular-nums">
                {formatRelative(new Date(g.lastSeen), now, locale)}
              </time>
              {g.reopenedCount > 0 && <span className="rounded bg-warning-surface px-1 text-warning-text">came back</span>}
            </span>
          </span>
          <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </div>

      <div className="flex items-center gap-3 pl-10">
        <Sparkline series={series} label={`${count(day)} in the last 24 hours`} />
        <span className="text-caption flex-1 text-muted-foreground tabular-nums">{count(day)} in 24 h</span>
        <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={busy} onClick={onResolve}>
          <Check />
          Resolve
        </Button>
      </div>

      {open && (
        <div id={panel} className="grid gap-2 pl-10">
          <dl className="text-caption grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-muted-foreground">
            <dt>First seen</dt>
            <dd className="tabular-nums">{when(g.firstSeen)}</dd>
            <dt>Last seen</dt>
            <dd className="tabular-nums">{when(g.lastSeen)}</dd>
            <dt>Where</dt>
            <dd className="min-w-0 break-all">
              {sourceLabels[g.source]} · {routeTypeLabels[g.routeType]}
              {g.renderSource ? ` · ${g.renderSource}` : ""}
            </dd>
            {g.digest && (
              <>
                <dt>Digest</dt>
                <dd className="min-w-0 break-all font-mono">{g.digest}</dd>
              </>
            )}
            {g.reopenedCount > 0 && (
              <>
                <dt>Came back</dt>
                <dd>{g.reopenedCount === 1 ? "once" : `${g.reopenedCount} times`} after being resolved</dd>
              </>
            )}
          </dl>
          {g.stack ? (
            <pre
              className="text-caption max-h-80 overflow-auto rounded-lg bg-field p-3 font-mono whitespace-pre text-foreground"
              aria-label="Stack trace"
              tabIndex={0}
            >
              {g.stack}
            </pre>
          ) : (
            <p className="text-caption text-muted-foreground">No stack was recorded.</p>
          )}
        </div>
      )}
    </li>
  )
}

/** 24 bars, one per hour, oldest left. */
function Sparkline({ series, label }: { series: number[]; label: string }) {
  const max = Math.max(1, ...series)
  return (
    <svg viewBox="0 0 72 20" className="h-5 w-[72px] shrink-0 text-destructive" role="img" aria-label={label}>
      {series.map((n, i) => {
        const h = n ? Math.max(2, (n / max) * 20) : 1
        return <rect key={i} x={i * 3} y={20 - h} width={2} height={h} rx={0.5} className={n ? "fill-current" : "fill-muted-foreground/30"} />
      })}
    </svg>
  )
}
