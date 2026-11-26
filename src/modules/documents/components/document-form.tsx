"use client"

import { useState, useTransition, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Field, fieldClass } from "@/components/editor-fields"
import { ArrowLeft, Plus } from "@/components/icons"
import { NAV_BACK, NAV_FORWARD } from "@/components/motion"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { describeReminders, reminderLabel } from "../lib/format"
import { MAX_REMINDER_DAYS, MAX_REMINDERS, normalizeReminderDays } from "../lib/reminders"
import { sideIds } from "../lib/sides"
import { DEFAULT_REMINDER_DAYS, documentKinds, kindLabels, type AttachedFile, type DocumentDetail, type DocumentKind } from "../schema"
import { createDocument, updateDocument } from "../server-actions"
import { Attachments } from "./attachments"

const PRESET_DAYS = [180, 90, 60, 30, 14, 7, 1, 0]

/** What a kind suggests as a name, until the owner types one. */
const suggestedName: Record<DocumentKind, string> = {
  passport: "Passport",
  residence_permit: "Residence permit",
  id_card: "ID card",
  driving_licence: "Driving licence",
  insurance: "Health insurance",
  other: "",
}

/** New document, or edit one (`document`). Saves on submit, then shows the document. */
export function DocumentForm({ document }: { document: DocumentDetail | null }) {
  const router = useRouter()
  const [kind, setKind] = useState<DocumentKind>(document?.kind ?? "passport")
  const [name, setName] = useState(document?.name ?? suggestedName.passport)
  const [expiresOn, setExpiresOn] = useState(document?.expiresOn ?? "")
  const [issuedOn, setIssuedOn] = useState(document?.issuedOn ?? "")
  const [notes, setNotes] = useState(document?.notes ?? "")
  const [days, setDays] = useState<number[]>(document?.reminderDays ?? [...DEFAULT_REMINDER_DAYS])
  const [custom, setCustom] = useState("")
  const [files, setFiles] = useState<AttachedFile[]>(document?.files ?? [])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<{ field: string; message: string } | null>(null)
  const [pending, start] = useTransition()
  const back = document ? `/app/documents/${document.id}` : "/app/documents"

  function pickKind(next: DocumentKind) {
    // Follow the kind while the name is still the suggestion (or empty).
    if (!name.trim() || name === suggestedName[kind]) setName(suggestedName[next])
    setKind(next)
  }

  function toggleDay(day: number) {
    if (days.includes(day)) return setDays(days.filter((d) => d !== day))
    if (days.length >= MAX_REMINDERS) return setError({ field: "reminders", message: `Up to ${MAX_REMINDERS} reminders.` })
    setDays(normalizeReminderDays([...days, day]))
  }

  function addCustom() {
    const n = Number(custom.trim())
    if (!Number.isInteger(n) || n < 0 || n > MAX_REMINDER_DAYS) {
      return setError({ field: "reminders", message: `Enter a whole number of days from 0 to ${MAX_REMINDER_DAYS}.` })
    }
    if (!days.includes(n)) toggleDay(n)
    setCustom("")
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError({ field: "name", message: "Give the document a name, e.g. Passport." })
    if (!expiresOn) return setError({ field: "expiresOn", message: "Enter the expiry date: the last day it's valid." })
    if (issuedOn && issuedOn > expiresOn) return setError({ field: "issuedOn", message: "The issue date can't be after the expiry date." })
    if (uploading) return setError({ field: "files", message: "Wait for the upload to finish." })
    const payload = { name, kind, expiresOn, issuedOn: issuedOn || null, notes, reminderDays: days, fileIds: files.map((f) => f.id), ...sideIds(files) }
    start(async () => {
      const result = document ? await updateDocument({ id: document.id, ...payload }) : await createDocument(payload)
      if (!result.ok) return setError({ field: "form", message: result.error })
      toast.success(document ? "Document saved" : "Document added")
      router.push(`/app/documents/${result.value.id}`, { transitionTypes: document ? NAV_BACK : NAV_FORWARD })
    })
  }

  const errorFor = (field: string) =>
    error?.field === field ? (
      <p id={`document-${field}-error`} role="alert" className="text-caption text-destructive">
        {error.message}
      </p>
    ) : null
  const invalid = (field: string) => ({
    "aria-invalid": error?.field === field || undefined,
    "aria-describedby": error?.field === field ? `document-${field}-error` : undefined,
  })

  return (
    <article className="mx-auto grid w-full max-w-2xl gap-4">
      <div className="flex min-h-9 items-center">
        <Link
          href={back}
          transitionTypes={NAV_BACK}
          className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "-ml-2.5 text-muted-foreground")}
        >
          <ArrowLeft />
          {document ? document.name : "Documents"}
        </Link>
      </div>

      <form onSubmit={submit} noValidate className="glass grid gap-5 rounded-xl p-4 md:p-6" aria-label={document ? "Edit document" : "New document"}>
        <h1 className="text-card-title">{document ? "Edit document" : "New document"}</h1>

        <fieldset className="grid gap-2">
          <legend className="text-small mb-1.5 text-muted-foreground">Kind</legend>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind">
            {documentKinds.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => pickKind(k)}
                className={cn(
                  "text-small h-11 rounded-lg border px-3 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9",
                  kind === k
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-field-border bg-field text-muted-foreground hover:text-foreground",
                )}
              >
                {kindLabels[k]}
              </button>
            ))}
          </div>
        </fieldset>

        <Field label="Name">
          {(id) => (
            <>
              <Input
                id={id}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (error?.field === "name") setError(null)
                }}
                maxLength={80}
                required
                placeholder="e.g. Passport"
                autoComplete="off"
                className="h-11 text-base md:h-9 md:text-sm"
                {...invalid("name")}
              />
              {errorFor("name")}
            </>
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Expires on" hint="The last day it's valid.">
            {(id) => (
              <>
                <input
                  id={id}
                  type="date"
                  value={expiresOn}
                  onChange={(e) => {
                    setExpiresOn(e.target.value)
                    if (error?.field === "expiresOn") setError(null)
                  }}
                  required
                  className={cn(fieldClass, "h-11 tabular-nums md:h-9 dark:[color-scheme:dark]")}
                  {...invalid("expiresOn")}
                />
                {errorFor("expiresOn")}
              </>
            )}
          </Field>
          <Field label="Issued on (optional)">
            {(id) => (
              <>
                <input
                  id={id}
                  type="date"
                  value={issuedOn}
                  max={expiresOn || undefined}
                  onChange={(e) => {
                    setIssuedOn(e.target.value)
                    if (error?.field === "issuedOn") setError(null)
                  }}
                  className={cn(fieldClass, "h-11 tabular-nums md:h-9 dark:[color-scheme:dark]")}
                  {...invalid("issuedOn")}
                />
                {errorFor("issuedOn")}
              </>
            )}
          </Field>
        </div>

        <fieldset className="grid gap-2">
          <legend className="text-small mb-1.5 text-muted-foreground">Telegram reminders</legend>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days before expiry">
            {normalizeReminderDays([...PRESET_DAYS, ...days]).map((day) => {
              const on = days.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    if (error?.field === "reminders") setError(null)
                    toggleDay(day)
                  }}
                  className={cn(
                    "text-small h-11 rounded-lg border px-3 tabular-nums outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-field-border bg-field text-muted-foreground hover:text-foreground",
                  )}
                >
                  {reminderLabel(day)}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="document-custom-days" className="text-caption text-muted-foreground">
              Other
            </label>
            <Input
              id="document-custom-days"
              inputMode="numeric"
              value={custom}
              onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  addCustom()
                }
              }}
              placeholder="45"
              maxLength={3}
              className="h-11 w-20 text-center tabular-nums md:h-9"
              {...invalid("reminders")}
            />
            <span className="text-caption text-muted-foreground">days before</span>
            <Button type="button" variant="ghost" size="sm" className="h-11 md:h-8" onClick={addCustom} disabled={!custom}>
              <Plus />
              Add
            </Button>
          </div>
          {errorFor("reminders")}
          <p className="text-caption text-muted-foreground">
            {days.length
              ? `osbot sends a card at 10:00, ${describeReminders(days)}, and once when it has expired.`
              : "No reminders: osbot stays quiet about this one."}
          </p>
        </fieldset>

        <Field label="Notes (optional)" hint="Where it's kept, what renewing needs. No document numbers.">
          {(id) => (
            <textarea
              id={id}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="e.g. Renew at the MV ČR office on Koněvova; bring photos and insurance proof."
              className={cn(fieldClass, "field-sizing-content h-auto min-h-16 resize-none py-2 text-base leading-6 md:text-sm")}
            />
          )}
        </Field>

        <Attachments files={files} onChange={setFiles} onBusy={setUploading} />
        {errorFor("files")}

        {errorFor("form")}
        <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
          <Button type="submit" size="lg" className="h-11 md:h-9" disabled={pending || uploading}>
            {document ? "Save changes" : "Add document"}
          </Button>
          <Link href={back} transitionTypes={NAV_BACK} className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-11 md:h-9")}>
            Cancel
          </Link>
        </div>
      </form>
    </article>
  )
}
