"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Bookmark, BookmarkFilled, Loader2Icon, Plus } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { addLink } from "../server-actions"

/** One field: paste a URL, press Enter. The title and icon are fetched on the server. */
export function AddLinkForm({ autoFocus }: { autoFocus?: boolean }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState("")
  const [readLater, setReadLater] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = url.trim()
    if (!value) {
      setError("Paste a link first, e.g. https://react.dev/learn")
      input.current?.focus()
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await addLink({ url: value, readLater })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setUrl("")
      const { id, duplicate, fetched, title } = result.data
      const open = { label: "Edit", onClick: () => router.push(`/app/links/${id}`) }
      if (duplicate) toast.info(`Already saved as “${title}”`, { action: open })
      else if (fetched) toast.success("Link saved", { description: title, action: open })
      else toast.success("Link saved", { description: "The page didn't share a title. Edit it any time.", action: open })
      input.current?.focus()
    })
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-2">
      <div className="flex gap-2">
        <label htmlFor="add-link" className="sr-only">
          Paste a link to save
        </label>
        <input
          ref={input}
          id="add-link"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoFocus={autoFocus}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            if (error) setError(null)
          }}
          onPaste={(e) => {
            // Pasting into an empty field saves right away: the common case is one link.
            const pasted = e.clipboardData.getData("text").trim()
            if (!url && pasted && !pending) {
              e.preventDefault()
              setUrl(pasted)
              requestAnimationFrame(() => input.current?.form?.requestSubmit())
            }
          }}
          placeholder="e.g. https://react.dev/learn"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "add-link-error" : undefined}
          className="h-9 min-w-0 flex-1 rounded-lg border border-field-border bg-field px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-pressed={readLater}
          aria-label="Save to read later"
          title="Save to read later"
          onClick={() => setReadLater((v) => !v)}
          className={cn(readLater && "text-text-accent")}
        >
          {readLater ? <BookmarkFilled /> : <Bookmark />}
        </Button>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : <Plus />}
          <span className="hidden sm:inline">{pending ? "Saving…" : "Save link"}</span>
          <span className="sr-only sm:hidden">Save link</span>
        </Button>
      </div>
      {error && (
        <p id="add-link-error" role="alert" className="text-meta rounded-lg bg-error-surface px-3 py-2 text-destructive">
          {error}
        </p>
      )}
      {pending && (
        <p role="status" className="text-caption text-muted-foreground">
          Reading the page title…
        </p>
      )}
    </form>
  )
}
