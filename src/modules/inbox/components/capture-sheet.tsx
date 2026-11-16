"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { TrayArrowDown } from "@/components/icons"
import { Sheet } from "@/components/sheet"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { isTyping, useAfterG } from "@/lib/keys"
import { CAPTURE_EVENT } from "../schema"
import { captureToInbox } from "../server-actions"

/** Opens the capture sheet from anywhere (a button, another module). */
export function openCapture() {
  window.dispatchEvent(new Event(CAPTURE_EVENT))
}

/**
 * Global quick capture, mounted once in the app shell. Press C anywhere (not
 * while typing) to jot something down; Enter saves it to the inbox.
 */
export function CaptureSheet() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const afterG = useAfterG()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "c" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || isTyping(e.target) || afterG(e)) return
      // Another dialog (⌘K, a sheet) owns the keyboard while it's open.
      if (document.querySelector("[data-slot=dialog-content]:not([data-closed])")) return
      e.preventDefault()
      setOpen(true)
    }
    const onOpen = () => setOpen(true)
    window.addEventListener("keydown", onKey)
    window.addEventListener(CAPTURE_EVENT, onOpen)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener(CAPTURE_EVENT, onOpen)
    }
  }, [afterG])

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Capture"
      description="Anything — a thought, a to-do, a link. Sort it later in the inbox."
    >
      {open && (
        <CaptureForm
          onDone={() => {
            setOpen(false)
            toast.success("Captured to inbox", {
              // Read at save time: usePathname() would make the shell dynamic.
              action: window.location.pathname.startsWith("/app/inbox") ? undefined : { label: "Open inbox", onClick: () => router.push("/app/inbox") },
            })
          }}
        />
      )}
    </Sheet>
  )
}

export function CaptureForm({ onDone, compact = false, autoFocus = true }: { onDone: () => void; compact?: boolean; autoFocus?: boolean }) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])

  function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!text.trim()) {
      setError("Write something or paste a link first.")
      return
    }
    startTransition(async () => {
      const result = await captureToInbox({ text })
      if (!result.ok) return setError(result.error)
      setText("")
      setError(null)
      onDone()
      ref.current?.focus()
    })
  }

  return (
    <form onSubmit={submit} className={compact ? "glass grid gap-2 rounded-xl p-2.5" : "grid gap-3 p-4"} aria-label="Capture to inbox">
      <div className="flex items-start gap-2">
        {compact && <TrayArrowDown className="mt-3 ml-1.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <label htmlFor={compact ? "inbox-capture" : "capture-text"} className="sr-only">
          What’s on your mind?
        </label>
        <textarea
          ref={ref}
          id={compact ? "inbox-capture" : "capture-text"}
          autoFocus={autoFocus}
          rows={compact ? 1 : 3}
          value={text}
          maxLength={10_000}
          onChange={(e) => {
            setText(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={compact ? "Capture a thought, a to-do, a link" : "e.g. Ask Petra about the shift swap · https://…"}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "capture-error" : undefined}
          className={
            compact
              ? "text-body min-h-10 flex-1 resize-none bg-transparent py-2.5 outline-none placeholder:text-muted-foreground/80"
              : "text-body min-h-24 w-full resize-none rounded-lg border border-field-border bg-field p-3 outline-none focus-visible:border-accent-500 focus-visible:ring-3 focus-visible:ring-accent-500/20"
          }
        />
        {compact && (
          <Button type="submit" size="lg" disabled={pending || !text.trim()} className="mt-0.5 shrink-0">
            Capture
          </Button>
        )}
      </div>
      {error && (
        <p id="capture-error" className="text-caption px-1 text-destructive" role="alert">
          {error}
        </p>
      )}
      {!compact && (
        <div className="flex items-center gap-2">
          <p className="text-caption hidden items-center gap-1 text-muted-foreground sm:flex">
            <Kbd>↵</Kbd> save · <Kbd>⇧↵</Kbd> new line
          </p>
          <Button type="submit" size="lg" disabled={pending} className="ml-auto max-sm:h-11 max-sm:w-full">
            Save to inbox
          </Button>
        </div>
      )}
    </form>
  )
}
