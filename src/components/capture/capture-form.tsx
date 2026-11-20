"use client"

import { useState, useTransition, type ComponentType } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { NAV_BACK, NAV_FORWARD } from "@/components/motion"
import { Lightbulb, LinkIcon, NotebookPen, TrayArrowDown } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { saveCapture } from "@/core/capture-actions"
import { captureDestinations, type CaptureDestinationId, type CaptureDraft } from "@/core/capture"
import { cn } from "@/lib/utils"

const icons: Record<CaptureDestinationId, ComponentType<{ className?: string }>> = {
  inbox: TrayArrowDown,
  note: NotebookPen,
  link: LinkIcon,
  idea: Lightbulb,
}

const placeholders: Record<CaptureDestinationId, string> = {
  inbox: "Optional",
  note: "From the first line if empty",
  link: "Fetched from the page if empty",
  idea: "What's the idea?",
}

/**
 * The capture screen's form: pick a destination (Inbox by default), check the
 * prefilled fields, save. One tap for the common case; ⌘/Ctrl+Enter saves too.
 */
export function CaptureForm({ initial, shared }: { initial: CaptureDraft; shared: boolean }) {
  const router = useRouter()
  const [destination, setDestination] = useState<CaptureDestinationId>(captureDestinations[0].id)
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string>()
  const [pending, startTransition] = useTransition()
  const current = captureDestinations.find((d) => d.id === destination)!

  function update(field: keyof CaptureDraft, value: string) {
    setDraft((d) => ({ ...d, [field]: value }))
    setError(undefined)
  }

  function save() {
    startTransition(async () => {
      const result = await saveCapture(destination, draft, shared)
      if (!result.ok) return setError(result.error)
      toast.success(result.message)
      router.push(result.href, { transitionTypes: NAV_FORWARD })
    })
  }

  return (
    <form
      className="glass grid gap-5 rounded-xl p-4 md:p-6"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          save()
        }
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="text-eyebrow pb-2 text-text-accent">Save to</legend>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {captureDestinations.map((d) => {
            const Icon = icons[d.id]
            const selected = d.id === destination
            return (
              <label
                key={d.id}
                className={cn(
                  "press flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 outline-none",
                  "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                  selected
                    ? "border-accent-500 bg-secondary text-secondary-foreground"
                    : "border-field-border bg-field hover:bg-track",
                )}
              >
                <input
                  type="radio"
                  name="destination"
                  value={d.id}
                  checked={selected}
                  onChange={() => {
                    setDestination(d.id)
                    setError(undefined)
                  }}
                  className="sr-only"
                />
                <Icon className={cn("size-5 shrink-0", selected ? "text-text-accent" : "text-muted-foreground")} />
                <span className="text-body-strong">{d.label}</span>
              </label>
            )
          })}
        </div>
        <p className="text-caption text-muted-foreground">{current.hint}</p>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="capture-title">Title</Label>
        <Input
          id="capture-title"
          value={draft.title}
          maxLength={200}
          placeholder={placeholders[destination]}
          onChange={(e) => update("title", e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="capture-text">Text</Label>
        <Textarea
          id="capture-text"
          value={draft.text}
          rows={5}
          onChange={(e) => update("text", e.target.value)}
          autoFocus={!initial.text && !initial.url && !initial.title}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="capture-url">Link</Label>
        <Input
          id="capture-url"
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://"
          value={draft.url}
          onChange={(e) => update("url", e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : `Save to ${current.label}`}
        </Button>
        <Button
          size="lg"
          variant="ghost"
          nativeButton={false}
          render={<Link href="/app" transitionTypes={NAV_BACK} />}
        >
          Cancel
        </Button>
        <span className="text-caption ml-auto hidden text-muted-foreground md:inline">⌘ Enter to save</span>
      </div>
    </form>
  )
}
