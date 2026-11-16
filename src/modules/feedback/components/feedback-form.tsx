"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { CheckCircle, Loader2Icon, Send } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { Challenge, Solution } from "../pow"
import { solveChallenge } from "../pow-solver"
import { feedbackKinds, kindLabels, MESSAGE_MAX, MESSAGE_MIN, type FeedbackKind } from "../schema"
import { getFeedbackChallenge, submitFeedback } from "../submit"

const placeholders: Record<FeedbackKind, string> = {
  complaint: "e.g. The CV page is hard to read on my phone",
  suggestion: "e.g. Add a dark mode to the calculators",
  question: "e.g. Do you take freelance projects?",
  thanks: "e.g. The compound growth calculator saved me an hour",
}

type Field = "kind" | "message" | "name" | "contact"

/**
 * The public form. A proof-of-work puzzle starts solving in the background as
 * soon as the page opens, so by the time someone has written a sentence it's
 * done and sending is instant.
 */
export function FeedbackForm() {
  const [kind, setKind] = useState<FeedbackKind>("suggestion")
  const [message, setMessage] = useState("")
  const [name, setName] = useState("")
  const [contact, setContact] = useState("")
  const [website, setWebsite] = useState("")
  const [error, setError] = useState<{ text: string; field?: Field } | null>(null)
  const [sent, setSent] = useState(false)
  const [checking, setChecking] = useState(false)
  const [pending, startTransition] = useTransition()
  const proof = useRef<Promise<Solution | null> | null>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)

  /** Fetches a fresh challenge and starts solving it. */
  const prepare = useCallback(() => {
    proof.current = (async () => {
      try {
        const challenge: Challenge = await getFeedbackChallenge()
        const number = await solveChallenge(challenge)
        if (number === null) return null
        const { algorithm, challenge: hash, salt, signature } = challenge
        return { algorithm, challenge: hash, salt, signature, number }
      } catch {
        return null
      }
    })()
    return proof.current
  }, [])

  useEffect(() => {
    void prepare()
  }, [prepare])

  const length = message.trim().length

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (length < MESSAGE_MIN) {
      setError({ text: `Write a little more — at least ${MESSAGE_MIN} characters.`, field: "message" })
      messageRef.current?.focus()
      return
    }
    setError(null)
    startTransition(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        setChecking(true)
        const solution = await (attempt === 0 && proof.current ? proof.current : prepare())
        setChecking(false)
        if (!solution) {
          setError({ text: "The spam check couldn't run. Check your connection and send again." })
          void prepare()
          return
        }
        const result = await submitFeedback({ kind, message, name, contact, website, solution })
        if (result.ok) {
          setSent(true)
          setMessage("")
          void prepare()
          return
        }
        if ("retry" in result) continue
        setError({ text: result.error, field: result.field })
        // A used or rejected solution can't be sent twice; get the next one ready.
        void prepare()
        return
      }
      setError({ text: "The spam check failed twice. Reload the page and try again." })
    })
  }

  if (sent) {
    return (
      <div role="status" className="glass grid justify-items-start gap-3 rounded-xl p-4 md:p-6">
        <CheckCircle className="size-6 text-text-accent" />
        <div className="grid gap-1">
          <p className="text-card-title">Thanks — your message reached Anwar</p>
          <p className="text-meta max-w-prose text-muted-foreground">
            {contact
              ? "He reads everything and answers through the contact you left when there's something to say."
              : "He reads everything. You didn't leave a contact, so there's no reply — that's fine."}
          </p>
        </div>
        <Button variant="outline" onClick={() => setSent(false)}>
          Send another
        </Button>
      </div>
    )
  }

  const invalid = (field: Field) => (error?.field === field ? true : undefined)

  return (
    <form onSubmit={submit} noValidate className="glass grid gap-4 rounded-xl p-4 md:p-6">
      <fieldset className="grid gap-2">
        <legend className="text-eyebrow mb-2 text-muted-foreground">What is it?</legend>
        <div className="segmented flex-wrap">
          {feedbackKinds.map((k) => (
            <label
              key={k}
              className={`text-small ${cn(
                "cursor-pointer rounded-lg px-3 py-1.5 text-muted-foreground hover:text-foreground has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                kind === k && "segment-active text-foreground",
              )}`}
            >
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
                className="sr-only"
              />
              {kindLabels[k]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid content-start gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="fb-message" className="text-eyebrow text-muted-foreground">
            Message
          </label>
          <span
            className={`text-caption ${cn(
              "tabular-nums text-muted-foreground",
              message.length > MESSAGE_MAX && "text-destructive",
            )}`}
            aria-live="polite"
          >
            {message.length} / {MESSAGE_MAX}
          </span>
        </div>
        <Textarea
          ref={messageRef}
          id="fb-message"
          value={message}
          onChange={(e) => {
            setMessage(e.target.value)
            if (error?.field === "message") setError(null)
          }}
          placeholder={placeholders[kind]}
          maxLength={MESSAGE_MAX}
          rows={6}
          required
          aria-invalid={invalid("message")}
          aria-describedby={error?.field === "message" ? "fb-error" : undefined}
          className="min-h-36"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <label htmlFor="fb-name" className="text-eyebrow text-muted-foreground">
            Name <span className="normal-case tracking-normal">(optional)</span>
          </label>
          <Input
            id="fb-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Jana"
            maxLength={100}
            autoComplete="name"
            aria-invalid={invalid("name")}
          />
        </div>
        <div className="grid content-start gap-1.5">
          <label htmlFor="fb-contact" className="text-eyebrow text-muted-foreground">
            Email or Telegram <span className="normal-case tracking-normal">(optional)</span>
          </label>
          <Input
            id="fb-contact"
            value={contact}
            onChange={(e) => {
              setContact(e.target.value)
              if (error?.field === "contact") setError(null)
            }}
            placeholder="e.g. @jana or jana@example.com"
            maxLength={200}
            autoComplete="email"
            inputMode="email"
            aria-invalid={invalid("contact")}
            aria-describedby={error?.field === "contact" ? "fb-error" : "fb-contact-hint"}
          />
          <p id="fb-contact-hint" className="text-caption text-muted-foreground">
            Only if you’d like an answer.
          </p>
        </div>
      </div>

      {/* Honeypot: invisible and unreachable for people; bots fill every field. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="fb-website">Website</label>
        <input
          id="fb-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <p className="text-caption max-w-prose text-muted-foreground">
        What’s stored: the kind, your message, and the name and contact if you give them. Only Anwar can read it. To
        stop spam, a one-way hash of your IP address is kept for 24 hours — never the address itself. No cookies, no
        tracking.
      </p>

      {error && (
        <p id="fb-error" role="alert" className="text-meta rounded-lg bg-error-surface px-3 py-2 text-destructive">
          {error.text}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {pending && (
          <p role="status" className="text-caption text-muted-foreground">
            {checking ? "Running a quick spam check…" : "Sending…"}
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending} className="max-sm:h-11 max-sm:w-full">
          {pending ? <Loader2Icon className="animate-spin" /> : <Send />}
          Send feedback
        </Button>
      </div>
    </form>
  )
}
