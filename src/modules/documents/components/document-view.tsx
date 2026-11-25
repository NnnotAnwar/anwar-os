"use client"

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Field, fieldClass } from "@/components/editor-fields"
import { ArrowLeft, ArrowsClockwise, Bell, BellSlash, History, Paperclip, Pencil, Trash2 } from "@/components/icons"
import { pendingRemovals } from "@/components/list/pending"
import { NAV_BACK, NAV_FORWARD } from "@/components/motion"
import { Button, buttonVariants } from "@/components/ui/button"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { ItemIcon } from "@/modules/files/components/file-type-icon"
import { rawHref } from "@/modules/files/lib/links"
import { formatBytes } from "@/modules/files/lib/validation"
import { addDaysIso, formatDate, formatShortDate } from "../lib/dates"
import { describeReminders } from "../lib/format"
import { REMINDER_TIME, reminderStages } from "../lib/reminders"
import { needsAttention } from "../lib/status"
import { kindLabels, type AttachedFile, type DocumentDetail } from "../schema"
import { deleteDocument, renewDocument } from "../server-actions"
import { Attachments } from "./attachments"
import { KindIcon, StatusChip } from "./bits"

/** One document: its dates and status, Renewed, reminders, scans and history. */
export function DocumentView({ document, renew }: { document: DocumentDetail; renew: boolean }) {
  const router = useRouter()
  const [renewing, setRenewing] = useState(renew)
  // ?renew=1 (osbot's ✓ Renewed) opens the panel; a later visit without it closes it.
  const [synced, setSynced] = useState(renew)
  if (renew !== synced) {
    setSynced(renew)
    setRenewing(renew)
  }
  const urgent = needsAttention(document.status)

  function remove() {
    const id = document.id
    removeWithUndo({
      message: `“${document.name}” deleted`,
      hide: () => {
        pendingRemovals.add(id)
        router.push("/app/documents", { transitionTypes: NAV_BACK })
      },
      restore: () => {
        pendingRemovals.remove(id)
        router.push(`/app/documents/${id}`)
      },
      commit: () => deleteDocument({ id }),
    })
  }

  return (
    <article className="mx-auto grid w-full max-w-2xl gap-4">
      <div className="flex min-h-9 items-center gap-1">
        <Link
          href="/app/documents"
          transitionTypes={NAV_BACK}
          className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "-ml-2.5 text-muted-foreground")}
        >
          <ArrowLeft />
          Documents
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <Link
            href={`/app/documents/${document.id}/edit`}
            transitionTypes={NAV_FORWARD}
            className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-11 md:h-9")}
          >
            <Pencil />
            Edit
          </Link>
          <Button variant="ghost" size="icon" className="size-11 md:size-9" onClick={remove} aria-label="Delete document">
            <Trash2 />
          </Button>
        </div>
      </div>

      <section className="glass grid gap-4 rounded-xl p-4 [--glass-shadow:var(--shadow-glass-lg)] md:p-6" aria-labelledby="document-name">
        <div className="flex items-start gap-3">
          <KindIcon kind={document.kind} tone={document.status.tone} className="size-12" />
          <div className="grid min-w-0 flex-1 gap-1">
            <p className="text-eyebrow text-text-accent">{kindLabels[document.kind]}</p>
            <h1 id="document-name" className="text-greeting break-words">
              {document.name}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <StatusChip status={document.status} />
          <p className="text-meta text-muted-foreground">{document.status.detail}</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 border-t border-hairline pt-4">
          <div className="grid gap-0.5">
            <dt className="text-caption text-muted-foreground">Expires on</dt>
            <dd className="text-body-strong tabular-nums">{formatDate(document.expiresOn)}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-caption text-muted-foreground">Issued on</dt>
            <dd className="text-body tabular-nums">{document.issuedOn ? formatDate(document.issuedOn) : "—"}</dd>
          </div>
        </dl>
        {document.notes && <p className="text-body whitespace-pre-line text-muted-foreground">{document.notes}</p>}
        {!renewing && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="lg"
              variant={urgent ? "default" : "outline"}
              className="h-11 md:h-9"
              onClick={() => setRenewing(true)}
            >
              <ArrowsClockwise />
              Renewed
            </Button>
            {urgent && (
              <p className="text-caption self-center text-muted-foreground">Got the new one? Enter its expiry date to reset the reminders.</p>
            )}
          </div>
        )}
      </section>

      {renewing && (
        <RenewPanel
          document={document}
          onDone={() => {
            setRenewing(false)
            if (renew) router.replace(`/app/documents/${document.id}`)
          }}
        />
      )}

      <RemindersCard document={document} />
      <FilesCard files={document.files} documentId={document.id} />
      {document.history.length > 0 && <HistoryCard document={document} />}
    </article>
  )
}

const YEARS = [1, 2, 5, 10]

function plusYears(iso: string, years: number) {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number]
  const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate()
  return `${String(y + years).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`
}

/** "Renewed": the new expiry date (focused), the new issue date and the new scan. Old dates go to the history. */
function RenewPanel({ document, onDone }: { document: DocumentDetail; onDone: () => void }) {
  const [expiresOn, setExpiresOn] = useState("")
  const [issuedOn, setIssuedOn] = useState("")
  const [files, setFiles] = useState<AttachedFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const panel = useRef<HTMLElement>(null)
  const dateInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
    dateInput.current?.focus()
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!expiresOn) return setError("Enter the new expiry date.")
    if (expiresOn <= document.expiresOn) return setError(`The new expiry date should be after ${formatDate(document.expiresOn)}.`)
    if (issuedOn && issuedOn > expiresOn) return setError("The issue date can't be after the expiry date.")
    start(async () => {
      const result = await renewDocument({ id: document.id, expiresOn, issuedOn: issuedOn || null, addFileIds: files.map((f) => f.id) })
      if (!result.ok) return setError(result.error)
      toast.success(`Renewed · valid until ${formatDate(result.value.expiresOn)}`)
      onDone()
    })
  }

  return (
    <section ref={panel} aria-labelledby="renew-title" className="glass grid gap-4 rounded-xl p-4 md:p-6">
      <div className="grid gap-1">
        <h2 id="renew-title" className="text-card-title">
          Renewed {document.name}?
        </h2>
        <p className="text-caption text-muted-foreground">
          The current dates ({formatDate(document.expiresOn)}) move to the history; reminders start over for the new date.
        </p>
      </div>
      <form onSubmit={submit} noValidate className="grid gap-4" aria-label="Renewal">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New expiry date">
            {(id) => (
              <div className="grid gap-2">
                <input
                  ref={dateInput}
                  id={id}
                  type="date"
                  value={expiresOn}
                  min={addDaysIso(document.expiresOn, 1)}
                  onChange={(e) => {
                    setExpiresOn(e.target.value)
                    setError(null)
                  }}
                  required
                  aria-invalid={Boolean(error) || undefined}
                  aria-describedby={error ? "renew-error" : undefined}
                  className={cn(fieldClass, "h-11 tabular-nums md:h-9 dark:[color-scheme:dark]")}
                />
                <div className="flex flex-wrap gap-1.5" aria-label="Quick dates">
                  {YEARS.map((years) => {
                    const value = plusYears(document.expiresOn, years)
                    return (
                      <button
                        key={years}
                        type="button"
                        onClick={() => {
                          setExpiresOn(value)
                          setError(null)
                        }}
                        className={cn(
                          "text-caption h-8 rounded-full px-2.5 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                          expiresOn === value ? "bg-accent-500/15 text-text-accent" : "bg-track text-muted-foreground hover:text-foreground",
                        )}
                        aria-label={`${years} ${years === 1 ? "year" : "years"} later: ${formatDate(value)}`}
                      >
                        +{years} {years === 1 ? "year" : "years"}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </Field>
          <Field label="Issued on (optional)">
            {(id) => (
              <input
                id={id}
                type="date"
                value={issuedOn}
                max={expiresOn || undefined}
                onChange={(e) => setIssuedOn(e.target.value)}
                className={cn(fieldClass, "h-11 tabular-nums md:h-9 dark:[color-scheme:dark]")}
              />
            )}
          </Field>
        </div>
        <Attachments files={files} onChange={setFiles} onBusy={setUploading} label="The new scan (optional)" />
        {error && (
          <p id="renew-error" role="alert" className="text-caption text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
          <Button type="submit" size="lg" className="h-11 md:h-9" disabled={pending || uploading}>
            Save renewal
          </Button>
          <Button type="button" variant="ghost" size="lg" className="h-11 md:h-9" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </section>
  )
}

function RemindersCard({ document }: { document: DocumentDetail }) {
  const { today } = document
  const stages = reminderStages(document.expiresOn, document.reminderDays)
  const next = stages.find((s) => s.day >= today)
  const snoozed = document.snoozedUntil && document.snoozedUntil >= today ? document.snoozedUntil : null
  const nextLabel = next
    ? `${next.day === today ? "Today" : formatShortDate(next.day)} at ${REMINDER_TIME} · ${
        next.stage === "expired" ? "the day after it expires" : next.stage === "0" ? "on the day" : `${next.stage} days before`
      }`
    : null
  const off = document.reminderDays.length === 0
  return (
    <section aria-labelledby="document-reminders" className="glass grid gap-2 rounded-xl p-4 md:p-6">
      <h2 id="document-reminders" className="text-card-title flex items-center gap-2">
        {off ? <BellSlash className="size-4 text-muted-foreground" /> : <Bell className="size-4 text-text-accent" />}
        Telegram reminders
      </h2>
      <p className="text-meta text-muted-foreground">
        {off ? "Off for this document. Edit it to turn them on." : `At ${REMINDER_TIME}: ${describeReminders(document.reminderDays)}, and once when it has expired.`}
      </p>
      {snoozed && <p className="text-meta">💤 Snoozed: osbot reminds you again on {formatShortDate(snoozed)}.</p>}
      {!off && nextLabel && <p className="text-meta">Next: {nextLabel}</p>}
    </section>
  )
}

function FilesCard({ files, documentId }: { files: AttachedFile[]; documentId: string }) {
  return (
    <section aria-labelledby="document-files" className="glass grid gap-2 rounded-xl p-4 md:p-6">
      <h2 id="document-files" className="text-card-title flex items-center gap-2">
        <Paperclip className="size-4 text-text-accent" />
        Scans and files
      </h2>
      {files.length === 0 ? (
        <p className="text-meta text-muted-foreground">
          No scan yet.{" "}
          <Link href={`/app/documents/${documentId}/edit`} className="text-text-accent underline-offset-4 hover:underline">
            Attach one
          </Link>{" "}
          to have it at hand when you renew.
        </p>
      ) : (
        <ul className="grid gap-1 sm:grid-cols-2">
          {files.map((file) => (
            <li key={file.id}>
              <Link
                href={`/app/files/file/${file.id}`}
                transitionTypes={NAV_FORWARD}
                className="press flex min-h-14 items-center gap-2.5 rounded-lg bg-field px-2 py-1.5 outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {file.mime.startsWith("image/") && file.mime !== "image/svg+xml" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a presigned redirect, not an optimizable asset
                  <img src={rawHref(file.id, "inline")} alt="" loading="lazy" className="size-10 shrink-0 rounded-md bg-muted object-cover" />
                ) : (
                  <ItemIcon item={{ kind: "file", mime: file.mime }} className="size-10" />
                )}
                <span className="grid min-w-0 flex-1">
                  <span className="text-body truncate">{file.name}</span>
                  <span className="text-caption text-muted-foreground tabular-nums">{formatBytes(file.size)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function HistoryCard({ document }: { document: DocumentDetail }) {
  return (
    <section aria-labelledby="document-history" className="glass grid gap-2 rounded-xl p-4 md:p-6">
      <h2 id="document-history" className="text-card-title flex items-center gap-2">
        <History className="size-4 text-text-accent" />
        Earlier renewals
      </h2>
      <ul className="grid gap-1.5">
        {document.history.map((entry, i) => (
          <li key={`${entry.expiresOn}-${i}`} className="text-meta flex flex-wrap justify-between gap-x-3 tabular-nums">
            <span>
              Valid until {formatDate(entry.expiresOn)}
              {entry.issuedOn && <span className="text-muted-foreground"> · issued {formatDate(entry.issuedOn)}</span>}
            </span>
            <span className="text-muted-foreground">renewed {formatDate(entry.renewedOn)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
