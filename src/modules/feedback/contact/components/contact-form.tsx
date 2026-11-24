"use client"

import { useActionState, useEffect, useRef, useSyncExternalStore } from "react"
import Link from "next/link"
import {
  Briefcase,
  ChatText,
  Check,
  Code,
  Hourglass,
  InfoIcon,
  Loader2Icon,
  Send,
  type AppIcon,
} from "@/components/icons"
import { NAV_BACK } from "@/components/motion"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { formatWait, preview } from "../../schema"
import {
  CONTACT,
  contactTopics,
  emptyValues,
  topicLabels,
  type ContactField,
  type ContactFormState,
  type ContactTopic,
} from "../schema"
import { sendContact } from "../submit"

const topics: Record<ContactTopic, { icon: AppIcon; hint: string; placeholder: string }> = {
  job: {
    icon: Briefcase,
    hint: "A role on your team",
    placeholder: "e.g. We're hiring a full-stack developer in Prague — here's the role…",
  },
  freelance: {
    icon: Code,
    hint: "Something to build",
    placeholder: "e.g. We need a booking app for our studio. Budget, timeline, what exists today…",
  },
  other: { icon: ChatText, hint: "Anything that needs a reply", placeholder: "e.g. A question about one of your projects" },
}

const initial: ContactFormState = { status: "idle", values: emptyValues }
const noSubscribe = () => () => {}

/**
 * The public contact form. A plain HTML form posting to a server function, so
 * it works without JavaScript (the server then answers with a redirect and the
 * page shows `notice`); with JavaScript it sends without a reload and keeps
 * what was typed on any error. `token` is the spam check (contact/token.ts),
 * rendered into the page per request.
 */
export function ContactForm({ token: initialToken, notice }: { token: string; notice?: string }) {
  const [state, action, pending] = useActionState(sendContact, initial)
  // "1" once hydrated: tells the server this browser runs scripts, so it answers with state instead of a redirect.
  const js = useSyncExternalStore(noSubscribe, () => "1", () => "")
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (state.status === "error" || state.status === "confirm") errorRef.current?.focus()
  }, [state])

  if (state.status === "sent") return <Sent state={state} />

  const values = state.values
  const token = state.token || initialToken
  const error = state.status === "error" ? state : state.status === "idle" && notice ? { error: notice, field: undefined, retryAfter: undefined } : null
  const invalid = (field: ContactField) => (error?.field === field ? true : undefined)
  const describedBy = (field: ContactField, hint?: string) =>
    cn(hint, error?.field === field && "contact-error") || undefined

  return (
    <form action={action} className="glass grid gap-5 rounded-xl p-4 md:p-6">
      <fieldset className="grid gap-2" aria-describedby={describedBy("topic")}>
        <legend className="text-card-title mb-2.5">What is it about?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {contactTopics.map((t) => {
            const { icon: Icon, hint } = topics[t]
            return (
              <label
                key={t}
                className="press group relative grid cursor-pointer content-start gap-1 rounded-lg border border-field-border bg-field p-3 transition-colors hover:border-accent-500/50 has-checked:border-accent-500 has-checked:bg-secondary has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
              >
                <input
                  type="radio"
                  name="topic"
                  value={t}
                  defaultChecked={values.topic === t}
                  required
                  className="peer sr-only"
                />
                <span className="flex items-center justify-between">
                  <Icon className="size-5 text-muted-foreground group-has-checked:text-text-accent" />
                  <Check className="size-4 text-text-accent opacity-0 group-has-checked:opacity-100" />
                </span>
                <span className="text-body-strong">{topicLabels[t]}</span>
                <span className="text-caption text-muted-foreground">{hint}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="contact-name" label="Your name">
          <Input
            id="contact-name"
            name="name"
            defaultValue={values.name}
            required
            maxLength={CONTACT.nameMax}
            autoComplete="name"
            placeholder="e.g. Jana Nováková"
            aria-invalid={invalid("name")}
            aria-describedby={describedBy("name")}
            className="max-sm:h-11"
          />
        </Field>
        <Field id="contact-email" label="Email">
          <Input
            id="contact-email"
            name="email"
            type="email"
            defaultValue={values.email}
            required
            maxLength={CONTACT.emailMax}
            autoComplete="email"
            inputMode="email"
            placeholder="e.g. jana@company.com"
            aria-invalid={invalid("email")}
            aria-describedby={describedBy("email", "contact-email-hint")}
            className="max-sm:h-11"
          />
          <p id="contact-email-hint" className="text-caption text-muted-foreground">
            The reply goes here.
          </p>
        </Field>
        <Field id="contact-company" label="Company" optional className="sm:col-span-2">
          <Input
            id="contact-company"
            name="company"
            defaultValue={values.company}
            maxLength={CONTACT.companyMax}
            autoComplete="organization"
            placeholder="e.g. Studio Nová"
            aria-invalid={invalid("company")}
            aria-describedby={describedBy("company")}
            className="max-sm:h-11"
          />
        </Field>
        <Field id="contact-message" label="Message" className="sm:col-span-2">
          <Textarea
            id="contact-message"
            name="message"
            defaultValue={values.message}
            required
            minLength={CONTACT.messageMin}
            maxLength={CONTACT.messageMax}
            rows={7}
            placeholder={topics[(values.topic as ContactTopic) || "other"]?.placeholder ?? topics.other.placeholder}
            aria-invalid={invalid("message")}
            aria-describedby={describedBy("message", "contact-message-hint")}
            className="min-h-40"
          />
          <p id="contact-message-hint" className="text-caption text-muted-foreground">
            What you have in mind, and anything that helps: timeline, budget, links. Up to{" "}
            {CONTACT.messageMax.toLocaleString("en")} characters.
          </p>
        </Field>
      </div>

      {/* Honeypot: invisible and unreachable for people; bots fill every field. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="js" value={js} />

      {state.status === "confirm" && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="status"
          className="text-meta flex items-start gap-2 rounded-lg bg-secondary px-3 py-2.5 text-foreground outline-none"
        >
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-text-accent" />
          <p>
            The form had been open a while. Press <strong>Send message</strong> once more — your text is still here.
          </p>
        </div>
      )}
      {error && (
        <div
          ref={errorRef}
          id="contact-error"
          tabIndex={-1}
          role="alert"
          className={cn(
            "text-meta flex items-start gap-2 rounded-lg px-3 py-2.5 outline-none",
            error.retryAfter ? "bg-warning-surface text-warning-text" : "bg-error-surface text-destructive",
          )}
        >
          {error.retryAfter ? <Hourglass className="mt-0.5 size-4 shrink-0" /> : null}
          <p>
            {error.error}
            {error.retryAfter
              ? ` You can send again in about ${formatWait(error.retryAfter)} — your text stays here.`
              : null}
          </p>
        </div>
      )}

      <div className="grid gap-3 border-t border-hairline pt-4 sm:flex sm:items-center sm:justify-between">
        <p className="text-caption max-w-sm text-muted-foreground">
          Not anonymous: I need your name and email to answer. For an anonymous note, use the{" "}
          <Link href="/feedback" className="text-text-accent underline-offset-4 hover:underline">
            feedback form
          </Link>
          .
        </p>
        <Button type="submit" size="lg" disabled={pending} className="max-sm:h-11 max-sm:w-full sm:min-w-44">
          {pending ? <Loader2Icon className="animate-spin" /> : <Send />}
          {pending ? "Sending…" : "Send message"}
        </Button>
      </div>

      <p className="text-caption max-w-prose text-muted-foreground">
        What’s stored: your name, email, company and message — only Anwar can read them. Archived messages are deleted
        after 12 months; to have yours deleted sooner, say so in a reply or send a new message here. To stop spam, a
        one-way hash of your IP address is kept for 24 hours — never the address itself. No cookies, no tracking.
      </p>
    </form>
  )
}

function Field({
  id,
  label,
  optional,
  className,
  children,
}: {
  id: string
  label: string
  optional?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <label htmlFor={id} className="text-small flex items-baseline gap-2 text-muted-foreground">
        {label}
        {optional && <span className="text-caption">optional</span>}
      </label>
      {children}
    </div>
  )
}

function Sent({ state }: { state: Extract<ContactFormState, { status: "sent" }> }) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => headingRef.current?.focus(), [])
  const first = state.name.trim().split(/\s+/)[0]
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
          {first ? `Thanks, ${first}` : "Thank you"}
        </h2>
        <p role="status" className="text-meta max-w-prose text-pretty text-muted-foreground">
          Your message reached Anwar. He answers by email to{" "}
          <span className="font-medium text-foreground">{state.email}</span>, usually within a few days.
        </p>
      </div>
      <figure className="text-meta grid w-full max-w-md gap-1 rounded-lg bg-track p-3 text-left">
        <figcaption className="text-eyebrow text-text-accent">{topicLabels[state.topic]}</figcaption>
        <blockquote className="text-pretty text-muted-foreground">{preview(state.message, 220)}</blockquote>
      </figure>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/projects" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "max-sm:h-11")}>
          See projects
        </Link>
        <Link href="/" transitionTypes={NAV_BACK} className={cn(buttonVariants({ size: "lg" }), "max-sm:h-11")}>
          Back to the start
        </Link>
      </div>
    </div>
  )
}
