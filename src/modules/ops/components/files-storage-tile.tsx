"use client"

import { useState } from "react"
import { toast } from "sonner"
import { FolderDuo, Refresh, Trash2 } from "@/components/icons"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { FilesCheckView } from "../files-check"
import { FILES_CHECK, filesCheckLevel, isStale, type MismatchedItem, type MissingItem } from "../lib/files-check"
import { formatBytes, formatDuration } from "../lib/status"
import { checkFilesNow, deleteFileOrphans } from "../server-actions"
import { Tile } from "./server-panel"

const count = (n: number) => new Intl.NumberFormat("en").format(n)
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`

/**
 * Ops → Server → Files storage: the last comparison of the Files rows with the
 * bucket (weekly from osbot), "Check now", and the leftovers it found with a
 * guarded "Delete orphans". Lost or damaged files can't be fixed from here:
 * they are listed so you know what to restore.
 */
export function FilesStorageTile({ initial, renderedAt, timezone, locale }: { initial: FilesCheckView; renderedAt: string; timezone: string; locale: string }) {
  const [view, setView] = useState(initial)
  const [busy, setBusy] = useState<"check" | "delete" | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const now = new Date(renderedAt)
  const { configured, check } = view
  const level = filesCheckLevel(check, now)
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))

  async function runCheck() {
    setBusy("check")
    const res = await checkFilesNow()
    setBusy(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setView({ configured: true, check: res.check })
    const c = res.check
    if (c.status === "error") toast.error(`The check failed: ${c.error ?? "unknown error"}`)
    else if (c.status === "problems") toast.warning("Checked: some files need a look")
    else toast.success("Checked: every file is where it should be")
  }

  const deletable = check?.findings?.orphans.filter((o) => o.deletable) ?? []

  async function removeOrphans() {
    setBusy("delete")
    const res = await deleteFileOrphans({ keys: deletable.map((o) => o.key) })
    setBusy(null)
    setConfirmOpen(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setView({ configured: true, check: res.check })
    toast.success(
      res.deleted
        ? `Deleted ${plural(res.deleted, "orphaned object")}${res.skipped ? ` · ${count(res.skipped)} kept (changed since the check)` : ""}`
        : "Nothing deleted: they changed since the check",
    )
  }

  const f = check?.findings ?? null

  return (
    <Tile icon={FolderDuo} title="Files storage" level={level} className="sm:col-span-2 xl:col-span-3">
      <div className="grid gap-3" data-testid="files-storage">
        {!configured && (
          <p className="text-meta text-muted-foreground">
            File storage isn&apos;t configured (S3_* variables), so there is nothing to check{check ? ". This is the last result." : "."}
          </p>
        )}
        {!check ? (
          configured && (
            <p className="text-meta text-muted-foreground">Not checked yet. osbot compares every file with the bucket on Mondays at 04:00.</p>
          )
        ) : (
          <>
            {f && (
              <p className="text-metric tabular-nums">
                {plural(f.objects, "file")} <span className="text-meta text-muted-foreground">· {formatBytes(f.bytes)}</span>
              </p>
            )}
            <dl className="text-caption grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-muted-foreground">
              <dt>Checked</dt>
              <dd className={cn("min-w-0 tabular-nums", isStale(check, now) && "text-warning-text")}>
                {when(check.checkedAt)} · {formatDuration(now.getTime() - new Date(check.checkedAt).getTime())} ago
              </dd>
              {f && f.ignored.objects > 0 && (
                <>
                  <dt>Backups</dt>
                  <dd className="min-w-0 tabular-nums">
                    {plural(f.ignored.objects, "object")} · {formatBytes(f.ignored.bytes)} in {f.ignored.prefixes.join(", ")}
                  </dd>
                </>
              )}
              {f && f.recent > 0 && (
                <>
                  <dt>Uploading</dt>
                  <dd className="min-w-0">{plural(f.recent, "object")} from the last {FILES_CHECK.uploadGraceHours} h without a file yet</dd>
                </>
              )}
              <dt>Schedule</dt>
              <dd className="min-w-0">weekly, Mondays at 04:00 (osbot)</dd>
            </dl>

            {check.status === "error" && (
              <p className="text-meta text-destructive" role="status">
                The last check failed: {check.error ?? "unknown error"}
              </p>
            )}
            {f && check.status === "ok" && <p className="text-meta text-muted-foreground">Every file has its object, at the right size. No leftovers.</p>}

            {f && f.missingCount > 0 && <Problems title={`${plural(f.missingCount, "file")} missing from the bucket`} items={f.missing} total={f.missingCount} bad />}
            {f && f.mismatchedCount > 0 && (
              <Problems
                title={`${plural(f.mismatchedCount, "file")} with the wrong size`}
                items={f.mismatched}
                total={f.mismatchedCount}
                bad
                extra={(i) => ("actual" in i ? ` · ${formatBytes(i.size)} expected, ${formatBytes(i.actual)} stored` : "")}
              />
            )}
            {f && f.orphanCount > 0 && (
              <section aria-label="Orphaned objects" className="grid gap-1.5">
                <p className="text-body-strong text-warning-text">
                  {plural(f.orphanCount, "orphaned object")} · {formatBytes(f.orphanBytes)}
                </p>
                <p className="text-caption text-muted-foreground">
                  No file points at them and they are older than {FILES_CHECK.uploadGraceHours} h: abandoned uploads, or deletes that didn&apos;t reach storage.
                </p>
                <ul className="text-caption grid gap-0.5 text-muted-foreground">
                  {f.orphans.slice(0, 5).map((o) => (
                    <li key={o.key} className="flex min-w-0 gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono">{o.key}</span>
                      <span className="shrink-0 tabular-nums">{formatBytes(o.size)}</span>
                    </li>
                  ))}
                  {f.orphanCount > 5 && <li>and {count(f.orphanCount - 5)} more</li>}
                </ul>
                {f.orphans.some((o) => !o.deletable) && (
                  <p className="text-caption text-muted-foreground">Keys that don&apos;t look like Files uploads are only listed: remove them by hand if you know what they are.</p>
                )}
              </section>
            )}
          </>
        )}

        {configured && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={runCheck} disabled={busy !== null}>
              <Refresh className={cn(busy === "check" && "animate-spin motion-reduce:animate-none")} />
              {busy === "check" ? "Checking…" : "Check now"}
            </Button>
            {deletable.length > 0 && (
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogTrigger render={<Button variant="ghost" size="sm" className="hover:text-destructive" disabled={busy !== null} />}>
                  <Trash2 />
                  Delete orphans
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {plural(deletable.length, "orphaned object")}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {formatBytes(deletable.reduce((n, o) => n + o.size, 0))} that no file in anwar.os points at. Each is checked again first, and
                      anything that has a file by now is kept. Deleted objects can&apos;t be restored.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep them</AlertDialogCancel>
                    <Button variant="destructive" disabled={busy !== null} onClick={removeOrphans}>
                      {busy === "delete" ? "Deleting…" : "Delete"}
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </div>
    </Tile>
  )
}

function Problems({
  title,
  items,
  total,
  bad,
  extra,
}: {
  title: string
  items: (MissingItem | MismatchedItem)[]
  total: number
  bad?: boolean
  extra?: (item: MissingItem | MismatchedItem) => string
}) {
  return (
    <section aria-label={title} className="grid gap-1">
      <p className={cn("text-body-strong", bad && "text-destructive")}>{title}</p>
      <ul className="text-caption grid gap-0.5 text-muted-foreground">
        {items.slice(0, 5).map((i) => (
          <li key={i.key} className="min-w-0 truncate">
            <span className="text-foreground">{i.name ?? "Another account's file"}</span>
            {extra ? extra(i) : ` · ${formatBytes(i.size)}`}
          </li>
        ))}
        {total > 5 && <li>and {count(total - 5)} more</li>}
      </ul>
      <p className="text-caption text-muted-foreground">Restore them from a copy, or delete them in Files.</p>
    </section>
  )
}
