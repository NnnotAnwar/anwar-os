"use client"

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react"
import Link from "next/link"
import {
  Check,
  Heart,
  Hourglass,
  Lightbulb,
  Loader2Icon,
  Question,
  Send,
  ShieldWarning,
  type AppIcon,
} from "@/components/icons"
import { NAV_BACK } from "@/components/motion"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { Challenge, Solution } from "../pow"
import { solveChallenge } from "../pow-solver"
import { feedbackKinds, formatWait, kindLabels, MESSAGE_MAX, MESSAGE_MIN, preview, type FeedbackKind } from "../schema"
import { getFeedbackChallenge, submitFeedback } from "../submit"

const kinds: Record<FeedbackKind, { icon: AppIcon; hint: string; placeholder: string }> = {
  complaint: {
    icon: ShieldWarning,
    hint: "Something broke or annoyed you",
    placeholder: "e.g. The CV page is hard to read on my phone",
  },
  suggestion: {
    icon: Lightbulb,
    hint: "An idea to make something better",
    placeholder: "e.g. Add a dark mode to the calculators",
  },
  question: { icon: Question, hint: "Ask me anything", placeholder: "e.g. Do you take freelance projects?" },
  thanks: { icon: Heart, hint: "Something worked for you", placeholder: "e.g. The compound growth calculator saved me an hour" },
}

type Field = "kind" | "message" | "name" | "contact"
type Proof = { state: "solving"; share: number } | { state: "ready" } | { state: "failed" }

/**
 * The public form, in three short steps: what kind of message, the message,
 * and (optionally) how to answer. A proof-of-work puzzle solves in the
 * background from page load, so by the time someone has written a sentence
 * the spam check is done and sending is instant; its progress shows quietly by
 * the Send button.
 */
export function FeedbackForm() {
  const [kind, setKind] = useState<FeedbackKind | null>(null)
  const [message, setMessage] = useState("")
  const [name, setName] = useState("")
  const [contact, setContact] = useState("")
  const [website, setWebsite] = useState("")
  const [error, setError] = useState<{ text: string; field?: Field; limit?: boolean } | null>(null)
  const [sent, setSent] = useState<{ kind: FeedbackKind; message: string; contact: boolean } | null>(null)
  const [proofState, setProofState] = useState<Proof>({ state: "solving", share: 0 })
  const [retryAt, setRetryAt] = useState<number | null>(null)
  const [pending, startTransition] = useTransition()
  const proof = useRef<Promise<Solution | null> | null>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const kindRef = useRef<HTMLFieldSetElement>(null)

  /** Fetches a fresh challenge and starts solving it, reporting progress in 5% steps. */
  const prepare = useCallback(() => {
    let shown = 0
    proof.current = (async () => {
      try {
        const challenge: Challenge = await getFeedbackChallenge()
        setProofState({ state: "solving", share: 0 })
        const number = await solveChallenge(challenge, undefined, (share) => {
          if (share - shown >= 0.05) {
            shown = share
            setProofState({ state: "solving", share })
          }
        })
        if (number === null) {
          setProofState({ state: "failed" })
          return null
        }
        setProofState({ state: "ready" })
        const { algorithm, challenge: hash, salt, signature } = challenge
        return { algorithm, challenge: hash, salt, signature, number }
      } catch {
        setProofState({ state: "failed" })
        return null
      }
    })()
    return proof.current
  }, [])

  useEffect(() => {
    void prepare()
  }, [prepare])

  const remaining = useCountdown(retryAt)
  /** Rate limited right now: Send waits, the alert counts down. */
  const limited = retryAt !== null && remaining !== 0

  const length = message.trim().length
  const steps = { kind: kind !== null, message: length >= MESSAGE_MIN, contact: Boolean(name.trim() || contact.trim()) }
  const current: 1 | 2 | 3 = !steps.kind ? 1 : !steps.message ? 2 : 3

  function pick(next: FeedbackKind) {
    setKind(next)
    if (error?.field === "kind") setError(null)
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (limited) return
    if (!kind) {
      setError({ text: "Pick what kind of message this is.", field: "kind" })
      kindRef.current?.querySelector("input")?.focus()
      return
    }
    if (length < MESSAGE_MIN) {
      setError({ text: `Write a little more — at least ${MESSAGE_MIN} characters.`, field: "message" })
      messageRef.current?.focus()
      return
    }
    setError(null)
    startTransition(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const solution = await (attempt === 0 && proof.current ? proof.current : prepare())
        if (!solution) {
          setError({ text: "The spam check couldn't run. Check your connection and send again." })
          void prepare()
          return
        }
        const result = await submitFeedback({ kind, message, name, contact, website, solution })
        if (result.ok) {
          setSent({ kind, message, contact: Boolean(contact.trim()) })
          setMessage("")
          setKind(null)
          void prepare()
          return
        }
        if ("retry" in result) continue
        if ("limit" in result) {
          // Without the database's exact wait, count down the whole window (an upper bound).
          const wait = result.retryAfter ?? (result.limit === "burst" ? 600 : 86_400)
          setRetryAt(Date.now() + wait * 1000)
          setError({ text: result.error, limit: true })
        } else {
          setError({ text: result.error, field: result.field })
        }
        // A used or rejected solution can't be sent twice; get the next one ready.
        void prepare()
        return
      }
      setError({ text: "The spam check failed twice. Reload the page and try again." })
    })
  }

  if (sent) return <Sent sent={sent} onAgain={() => setSent(null)} />

  const invalid = (field: Field) => (error?.field === field ? true : undefined)
  const nearMax = message.length > MESSAGE_MAX * 0.9

  return (
    <form onSubmit={submit} noValidate className="glass grid gap-6 rounded-xl p-4 md:p-6">
      <Step n={1} title="What is it?" done={steps.kind} current={current === 1}>
        <fieldset ref={kindRef} className="grid gap-2" aria-describedby={error?.field === "kind" ? "fb-error" : undefined}>
          <legend className="sr-only">What is it?</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {feedbackKinds.map((k) => {
              const { icon: Icon, hint } = kinds[k]
              const checked = kind === k
              return (
                <label
                  key={k}
                  className={cn(
                    "press relative grid cursor-pointer content-start gap-1 rounded-lg border border-field-border bg-field p-3 transition-colors hover:border-accent-500/50 has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                    checked && "border-accent-500 bg-secondary",
                  )}
                >
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    checked={checked}
                    onChange={() => pick(k)}
                    className="sr-only"
                  />
                  <span className="flex items-center justify-between">
                    <Icon className={cn("size-5 text-muted-foreground", checked && "text-text-accent")} />
                    {checked && <Check className="animate-pop size-4 text-text-accent" />}
                  </span>
                  <span className="text-body-strong">{kindLabels[k]}</span>
                  <span className="text-caption text-muted-foreground">{hint}</span>
                </label>
              )
            })}
          </div>
        </fieldset>
      </Step>

      <Step n={2} title="Your message" done={steps.message} current={current === 2} labelFor="fb-message">
        <div className="grid gap-1.5">
          <Textarea
            ref={messageRef}
            id="fb-message"
            value={message}
            onChange={(e) => {
              setMessage(e.target.value)
              if (error?.field === "message") setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit()
            }}
            placeholder={kind ? kinds[kind].placeholder : "Pick a kind above, or just start writing"}
            maxLength={MESSAGE_MAX}
            rows={6}
            required
            aria-invalid={invalid("message")}
            aria-describedby={cn("fb-count", error?.field === "message" && "fb-error")}
            className="min-h-36"
          />
          <div className="text-caption flex items-center justify-between gap-2 text-muted-foreground">
            <span>
              <kbd className="font-sans">⌘</kbd> Enter sends
            </span>
            <span
              id="fb-count"
              className={cn("tabular-nums", nearMax && "text-warning-text", message.length >= MESSAGE_MAX && "text-destructive")}
            >
              {length > 0 && length < MESSAGE_MIN ? (
                <>
                  {MESSAGE_MIN - length} more to go<span className="sr-only"> (at least {MESSAGE_MIN} characters)</span>
                </>
              ) : (
                <>
                  {message.length.toLocaleString("en")} / {MESSAGE_MAX.toLocaleString("en")}
                  <span className="sr-only"> characters</span>
                </>
              )}
            </span>
          </div>
        </div>
      </Step>

      <Step n={3} title="Want a reply?" optional done={steps.contact} current={current === 3}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid content-start gap-1.5">
            <label htmlFor="fb-name" className="text-small text-muted-foreground">
              Name
            </label>
            <Input
              id="fb-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jana"
              maxLength={100}
              autoComplete="name"
              aria-invalid={invalid("name")}
              className="max-sm:h-11"
            />
          </div>
          <div className="grid content-start gap-1.5">
            <label htmlFor="fb-contact" className="text-small text-muted-foreground">
              Email or Telegram
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
              className="max-sm:h-11"
            />
            <p id="fb-contact-hint" className="text-caption text-muted-foreground">
              Leave it empty to stay anonymous.
            </p>
          </div>
        </div>
      </Step>

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

      {error && (
        <div
          id="fb-error"
          role="alert"
          className={cn(
            "text-meta flex items-start gap-2 rounded-lg px-3 py-2.5",
            error.limit ? "bg-warning-surface text-warning-text" : "bg-error-surface text-destructive",
          )}
        >
          {error.limit && <Hourglass className="mt-0.5 size-4 shrink-0" />}
          <p>
            {error.text}
            {error.limit &&
              (limited && remaining !== null ? (
                <>
                  {" "}
                  You can send again in <span className="font-semibold tabular-nums">{formatWait(remaining)}</span> — your
                  text stays here.
                </>
              ) : limited ? (
                " Wait a few minutes, then send again — your text stays here."
              ) : (
                " You can send again now."
              ))}
          </p>
        </div>
      )}

      <div className="grid gap-3 border-t border-hairline pt-4 sm:flex sm:items-center sm:justify-between">
        <ProofStatus proof={proofState} />
        <Button
          type="submit"
          size="lg"
          disabled={pending || limited}
          className="max-sm:h-11 max-sm:w-full sm:min-w-40"
        >
          {pending ? <Loader2Icon className="animate-spin" /> : limited ? <Hourglass /> : <Send />}
          {pending
            ? proofState.state === "solving"
              ? "Checking…"
              : "Sending…"
            : limited && remaining !== null
              ? `Try again in ${formatWait(remaining)}`
              : "Send feedback"}
        </Button>
      </div>

      <p className="text-caption max-w-prose text-muted-foreground">
        What’s stored: the kind, your message, and the name and contact if you give them. Only Anwar can read it. To
        stop spam, a one-way hash of your IP address is kept for 24 hours — never the address itself. No cookies, no
        tracking.
      </p>
    </form>
  )
}

/** One numbered step. The number turns into a tick when the step is done; the current one is the accent. */
function Step({
  n,
  title,
  done,
  current,
  optional,
  labelFor,
  children,
}: {
  n: number
  title: string
  done: boolean
  current: boolean
  optional?: boolean
  labelFor?: string
  children: ReactNode
}) {
  const titleClass = "text-card-title flex items-baseline gap-2 self-center"
  const titleContent = (
    <>
      {title}
      {optional && <span className="text-caption font-medium text-muted-foreground">optional</span>}
    </>
  )
  return (
    <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 gap-y-2.5">
      <span
        aria-hidden
        className={cn(
          "text-small flex size-7 items-center justify-center rounded-full bg-track font-semibold text-muted-foreground tabular-nums transition-colors",
          current && "bg-primary text-primary-foreground",
          done && "bg-secondary text-text-accent",
        )}
      >
        {done ? <Check className="animate-pop size-3.5" /> : n}
      </span>
      {labelFor ? (
        <label htmlFor={labelFor} className={titleClass}>
          {titleContent}
        </label>
      ) : (
        <p className={titleClass}>{titleContent}</p>
      )}
      <div className="col-span-2 sm:col-start-2 sm:col-end-3">{children}</div>
    </div>
  )
}

/** A small ring by the Send button: the spam check solving, then ready. Announced once, not per percent. */
function ProofStatus({ proof }: { proof: Proof }) {
  const share = proof.state === "ready" ? 1 : proof.state === "solving" ? proof.share : 0
  const r = 7
  const c = 2 * Math.PI * r
  return (
    <p className="text-caption flex items-center gap-2 text-muted-foreground">
      {proof.state === "ready" ? (
        <span className="animate-pop flex size-4 items-center justify-center rounded-full bg-secondary text-text-accent">
          <Check className="size-2.5" />
        </span>
      ) : (
        <svg viewBox="0 0 18 18" className="size-4 -rotate-90" aria-hidden>
          <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2" className="stroke-track" />
          <circle
            cx="9"
            cy="9"
            r={r}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.max(0.04, share))}
            className={cn("stroke-accent-500 transition-[stroke-dashoffset] duration-300", proof.state === "failed" && "stroke-destructive")}
          />
        </svg>
      )}
      <span role="status">
        {proof.state === "ready"
          ? "Spam check done — ready to send"
          : proof.state === "failed"
            ? "Spam check will retry when you send"
            : "Running a quick spam check in the background"}
      </span>
    </p>
  )
}

function Sent({
  sent,
  onAgain,
}: {
  sent: { kind: FeedbackKind; message: string; contact: boolean }
  onAgain: () => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => headingRef.current?.focus(), [])
  return (
    <div className="glass grid justify-items-center gap-4 rounded-xl p-6 text-center md:p-10">
      <svg viewBox="0 0 56 56" className="animate-pop size-14" aria-hidden>
        <circle cx="28" cy="28" r="26" className="fill-secondary" />
        <path
          d="M17 29 l7 7 l15 -16"
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="draw-in stroke-text-accent"
          style={{ "--len": 36 } as React.CSSProperties}
        />
      </svg>
      <div className="grid gap-1.5">
        <h2 ref={headingRef} tabIndex={-1} className="text-greeting outline-none">
          Sent — thank you
        </h2>
        <p role="status" className="text-meta max-w-prose text-pretty text-muted-foreground">
          {sent.contact
            ? "Your message reached Anwar. He reads everything and answers through the contact you left when there's something to say."
            : "Your message reached Anwar. He reads everything. You didn't leave a contact, so there's no reply — that's fine."}
        </p>
      </div>
      <figure className="text-meta grid w-full max-w-md gap-1 rounded-lg bg-track p-3 text-left">
        <figcaption className="text-eyebrow text-text-accent">{kindLabels[sent.kind]}</figcaption>
        <blockquote className="text-pretty text-muted-foreground">{preview(sent.message, 220)}</blockquote>
      </figure>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" size="lg" onClick={onAgain} className="max-sm:h-11">
          Send another
        </Button>
        <Link href="/" transitionTypes={NAV_BACK} className={cn(buttonVariants({ size: "lg" }), "max-sm:h-11")}>
          Back to the start
        </Link>
      </div>
    </div>
  )
}

/** Whole seconds left until `until` (ms), ticking once a second; null without a target or before the first tick. */
function useCountdown(until: number | null) {
  // No clock during render: the page prerenders, and the time only matters once a limit is hit.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    if (until === null) return
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [until])
  if (until === null || now === null) return null
  return Math.max(0, Math.ceil((until - now) / 1000))
}
