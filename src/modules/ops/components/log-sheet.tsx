"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Pause, Play, Refresh } from "@/components/icons"
import { Sheet } from "@/components/sheet"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { LogLine } from "../schema"
import { pollLogs } from "../server-actions"

const TAILS = [100, 200, 500, 1000] as const
const FOLLOW_MS = 3000

// Log lines are the one place the app uses a monospace face: columns of
// timestamps and JSON read far better aligned.
const mono = { fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace' }

function timeOf(ts: string) {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour12: false })
}

/** Tail of a service's logs. Follow polls every 3 s and keeps the view pinned to the end. */
export function LogSheet({ service, onOpenChange }: { service: string | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet
      open={service !== null}
      onOpenChange={onOpenChange}
      title={service ? `Logs · ${service}` : "Logs"}
      description="Newest at the bottom. Times are your local time."
      className="sm:max-w-3xl"
    >
      {service && <LogView key={service} service={service} />}
    </Sheet>
  )
}

type LogsResult = Awaited<ReturnType<typeof pollLogs>>

function LogView({ service }: { service: string }) {
  const [lines, setLines] = useState<LogLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [tail, setTail] = useState<(typeof TAILS)[number]>(200)
  const [follow, setFollow] = useState(true)
  const [loading, setLoading] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  const apply = useCallback((res: LogsResult) => {
    setLoading(false)
    if (res.ok) {
      setLines(res.lines)
      setError(null)
    } else {
      setError(res.error)
    }
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    void pollLogs({ service, tail }).then(apply)
  }, [service, tail, apply])

  // First load and every tail change; then every 3 s while following.
  useEffect(() => {
    let live = true
    const fetchNow = () => void pollLogs({ service, tail }).then((res) => live && apply(res))
    fetchNow()
    const id = follow
      ? setInterval(() => {
          if (document.visibilityState === "visible") fetchNow()
        }, FOLLOW_MS)
      : undefined
    return () => {
      live = false
      clearInterval(id)
    }
  }, [service, tail, follow, apply])

  // Stay at the bottom while following, unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && follow && pinned.current) el.scrollTop = el.scrollHeight
  }, [lines, follow])

  return (
    <div className="grid gap-2 p-4 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={follow ? "secondary" : "outline"}
          size="sm"
          className="min-h-11 sm:min-h-8"
          aria-pressed={follow}
          onClick={() => {
            setFollow((f) => !f)
            pinned.current = true
          }}
        >
          {follow ? <Pause /> : <Play />}
          {follow ? "Following" : "Follow"}
        </Button>
        <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={load} disabled={loading}>
          <Refresh className={cn(loading && "animate-spin")} />
          Refresh
        </Button>
        <label className="text-caption ml-auto flex items-center gap-1.5 text-muted-foreground">
          Lines
          <select
            value={tail}
            onChange={(e) => setTail(Number(e.target.value) as (typeof TAILS)[number])}
            className="text-meta h-11 rounded-lg border border-field-border bg-field px-2 text-foreground sm:h-8"
          >
            {TAILS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="text-meta rounded-lg bg-error-surface px-3 py-2 text-destructive">{error}</p>}

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="h-[60svh] overflow-auto rounded-lg border border-hairline bg-[#0f0e1a] p-3 text-[12px] leading-[1.55] text-[#e6e4f2] sm:h-[55vh]"
        style={mono}
        role="log"
        aria-live={follow ? "polite" : "off"}
        aria-label={`Log lines of ${service ?? ""}`}
        tabIndex={0}
      >
        {lines.length === 0 && !error ? (
          <p className="text-[#a3a1bd]">{loading ? "Loading…" : "No log lines yet."}</p>
        ) : (
          lines.map((l, i) => (
            <div key={`${l.ts}-${i}`} className={cn("flex gap-3 whitespace-pre-wrap break-all", l.stream === "stderr" && "text-[#fda4af]")}>
              <span className="shrink-0 text-[#7c7a96] tabular-nums select-none">{timeOf(l.ts)}</span>
              <span className="min-w-0">{l.text}</span>
            </div>
          ))
        )}
      </div>
      <p className="text-caption text-muted-foreground">
        {lines.length} lines{follow ? " · updates every 3 s" : ""} · red lines are stderr
      </p>
    </div>
)
}
