"use client"

import { useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Plus } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { quickAddIdea } from "../server-actions"

/** One-line capture: type, press Enter, keep going. */
export function QuickAdd() {
  const [title, setTitle] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const input = useRef<HTMLInputElement>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = title.trim()
    if (!value) {
      setError("Write the idea first — a few words are enough.")
      return
    }
    startTransition(async () => {
      const result = await quickAddIdea(value)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setTitle("")
      setError(null)
      toast.success("Idea added")
      input.current?.focus()
    })
  }

  return (
    <form onSubmit={submit} className="glass grid gap-2 rounded-xl p-3" aria-label="Add an idea">
      <div className="flex gap-2">
        <label htmlFor="quick-idea" className="sr-only">
          New idea
        </label>
        <Input
          ref={input}
          id="quick-idea"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            if (error) setError(null)
          }}
          placeholder="e.g. Telegram bot that splits a shared bill"
          maxLength={200}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "quick-idea-error" : undefined}
          className="h-9"
        />
        <Button type="submit" size="lg" disabled={pending}>
          <Plus />
          Add idea
        </Button>
      </div>
      {error && (
        <p id="quick-idea-error" className="text-caption text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
