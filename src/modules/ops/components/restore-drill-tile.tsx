"use client"

import { ArrowUpRight, ClockCounterClockwise } from "@/components/icons"
import { cn } from "@/lib/utils"
import { DRILL, drillDuration, drillFigures, drillLevel, failedChecks, type DrillState } from "../lib/drill"
import { Tile } from "./server-panel"

/**
 * Ops → Server → Restore drill: the monthly GitHub Actions job that restores
 * the newest backup into a throwaway Postgres and checks it. "Last restore
 * drill: 1 Dec, OK, 2 min 14 s, 1,234 rows". Read-only: the drill runs in
 * GitHub (Actions → Restore drill → Run workflow).
 */
export function RestoreDrillTile({ state, renderedAt, timezone, locale }: { state: DrillState; renderedAt: string; timezone: string; locale: string }) {
  const now = new Date(renderedAt)
  const level = drillLevel(state, now)
  const { latest, lastOk, configured } = state
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { timeZone: timezone, day: "numeric", month: "short" }).format(new Date(iso))
  const failed = latest?.status === "failed"

  return (
    <Tile icon={ClockCounterClockwise} title="Restore drill" level={level}>
      <p className={cn("text-body-strong", failed && "text-destructive")} data-testid="drill-summary">
        {latest
          ? [`${day(latest.finishedAt)}`, failed ? "Failed" : "OK", drillDuration(latest.durationMs), latest.totalRows != null ? drillFigures({ totalRows: latest.totalRows, backupBytes: null }, locale) : null]
              .filter(Boolean)
              .join(", ")
          : "No drill yet"}
      </p>
      <dl className="text-caption grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-muted-foreground">
        {latest?.backupFile && (
          <>
            <dt>Backup</dt>
            <dd className="min-w-0 truncate tabular-nums" title={latest.backupFile}>
              {latest.backupFile}
              {latest.backupBytes != null ? ` · ${drillFigures({ totalRows: null, backupBytes: latest.backupBytes })}` : ""}
            </dd>
          </>
        )}
        {failed && (
          <>
            <dt>Why</dt>
            <dd className="min-w-0 break-words text-destructive">{failedChecks(latest) || "drill.sh reported a failure"}</dd>
          </>
        )}
        {failed && lastOk && (
          <>
            <dt>Last OK</dt>
            <dd className="tabular-nums">{day(lastOk.finishedAt)}</dd>
          </>
        )}
        {!latest && (
          <>
            <dt>Set up</dt>
            <dd className="min-w-0">
              {configured
                ? "Run it once: GitHub → Actions → Restore drill → Run workflow."
                : "Add RESTORE_DRILL_SECRET on the server and the GitHub secrets (docs/DEPLOY.md, “Restore drill”)."}
            </dd>
          </>
        )}
        <dt>Alert</dt>
        <dd>failed, or none passed for {DRILL.maxAgeDays} d</dd>
      </dl>
      {latest?.runUrl && (
        <a
          href={latest.runUrl}
          target="_blank"
          rel="noreferrer"
          className="text-caption inline-flex min-h-11 w-fit items-center gap-1 rounded text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0"
        >
          Run log <ArrowUpRight className="size-3" />
        </a>
      )}
    </Tile>
  )
}
