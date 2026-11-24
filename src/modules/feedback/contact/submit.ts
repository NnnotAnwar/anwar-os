"use server"

import { sql } from "drizzle-orm"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { after } from "next/server"
import { asPublic } from "@/db"
import { alertNewContact } from "@/modules/osbot/contact-alerts"
import { clientIp, deriveKey, hashIp } from "../pow"
import { preview } from "../schema"
import {
  contactFormInput,
  topicLabels,
  type ContactField,
  type ContactFormState,
  type ContactTopic,
  type ContactValues,
} from "./schema"
import { createToken, tokenKey, verifyToken } from "./token"

// The public contact form's server functions. No session: the database
// function app.submit_contact() is the only way in; it re-validates everything
// and enforces the rate limits itself (db/modules/contact.sql).
//
// Two kinds of sender, told apart by the `js` field the form sets once it has
// hydrated:
//   - with JavaScript: sendContact returns the next form state (errors keep
//     what was typed; success shows a card with the name and email);
//   - without: a plain POST, answered with a 303 redirect (Post/Redirect/Get)
//     to /contact/sent or /contact?error=<code>. The page renders per request,
//     so it can show the notice; nothing personal ever goes in the URL.

function secret() {
  const value = process.env.FEEDBACK_SECRET || process.env.BETTER_AUTH_SECRET
  if (!value || value.length < 32) throw new Error("Set BETTER_AUTH_SECRET (32+ characters) to accept messages.")
  return value
}

/** A fresh form token: the page renders one into the form, the server issues another when one expires. */
export async function getContactToken(): Promise<string> {
  return createToken(tokenKey(secret()))
}

const NETWORK = "That didn't send. Check your connection and try again — your text is still here."
const FIELDS: ContactField[] = ["topic", "name", "email", "company", "message"]

function dbError(error: unknown) {
  const e = error as { code?: string; detail?: string; cause?: { code?: string; detail?: string } }
  const seconds = Number(e.cause?.detail ?? e.detail)
  return {
    code: e.cause?.code ?? e.code,
    retryAfter: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined,
  }
}

function text(form: FormData, key: string) {
  const value = form.get(key)
  return typeof value === "string" ? value : ""
}

/** What a no-JavaScript sender is redirected to, by outcome. Codes match noScriptNotices (schema.ts). */
function noScript(outcome: "sent" | "invalid" | "expired" | "fast" | "burst" | "daily" | "closed" | "network"): never {
  redirect(outcome === "sent" ? "/contact/sent" : `/contact?error=${outcome}`)
}

/** useActionState handler; also the target of the form's plain POST without JavaScript. */
export async function sendContact(_previous: ContactFormState, form: FormData): Promise<ContactFormState> {
  const values: ContactValues = {
    topic: text(form, "topic"),
    name: text(form, "name"),
    email: text(form, "email"),
    company: text(form, "company"),
    message: text(form, "message"),
  }
  const submittedToken = text(form, "token")
  const js = text(form, "js") === "1"

  // Honeypot filled: a bot. Pretend it worked so it doesn't adapt.
  if (text(form, "website").trim()) {
    if (!js) noScript("sent")
    return { status: "sent", topic: "other", name: values.name, email: values.email, message: values.message }
  }

  const key = tokenKey(secret())
  const parsed = contactFormInput.safeParse({ ...values, website: "", token: submittedToken })
  if (!parsed.success) {
    if (!js) noScript("invalid")
    const issue = parsed.error.issues[0]
    const keep = verifyToken(submittedToken, key)
    return {
      status: "error",
      values,
      token: keep.ok || keep.reason === "too_fast" ? submittedToken : createToken(key),
      error: issue?.message ?? "Check the form and try again.",
      field: FIELDS.find((f) => f === issue?.path[0]),
    }
  }
  const { topic, name, email, company, message } = parsed.data

  const verdict = verifyToken(submittedToken, key)
  if (!verdict.ok) {
    if (verdict.reason === "too_fast") {
      if (!js) noScript("fast")
      return { status: "error", values, token: submittedToken, error: "That was very quick. Wait a few seconds and send again." }
    }
    if (!js) noScript("expired")
    // The page was open for hours, or the token isn't ours: here's a fresh one, one more press sends.
    return { status: "confirm", values, token: createToken(key) }
  }

  const ipHash = hashIp(clientIp(await headers()), deriveKey(secret(), "ip"))

  let result: { id: string } | { code: string | undefined; retryAfter: number | undefined }
  try {
    const rows = await asPublic((tx) =>
      tx.execute<{ id: string }>(
        sql`select app.submit_contact(${topic}, ${name}, ${email}, ${company}, ${message}, ${ipHash}, ${verdict.nonce}) as id`,
      ),
    )
    result = { id: rows[0]!.id }
  } catch (error) {
    result = dbError(error)
  }

  if ("id" in result) {
    const id = result.id
    // After the response: Telegram can be slow or down without the sender noticing.
    after(() => alertNewContact(id, notificationText({ id, topic, name, email, company, message })))
    if (!js) noScript("sent")
    return { status: "sent", topic, name, email, message }
  }

  const { code, retryAfter } = result
  if (!js) {
    noScript(
      code === "OS429" ? "burst" : code === "OS430" ? "daily" : code === "OS409" ? "expired" : code === "OS001" ? "closed" : code === "22023" ? "invalid" : "network",
    )
  }
  const fail = (error: string, extra: { retryAfter?: number } = {}): ContactFormState => ({
    status: "error",
    values,
    token: createToken(key),
    error,
    ...extra,
  })
  switch (code) {
    case "OS429":
      return fail("You've sent 3 messages in the last 10 minutes — that's the limit for now.", { retryAfter: retryAfter ?? 600 })
    case "OS430":
      return fail("You've sent 10 messages today — that's the daily limit.", { retryAfter: retryAfter ?? 86_400 })
    case "OS409":
      return { status: "confirm", values, token: createToken(key) }
    case "OS001":
      return fail("The contact form isn't open yet. Try again later.")
    case "22023":
      return fail("Check the fields, then send again.")
    default:
      return fail(NETWORK)
  }
}

function notificationText(m: { id: string; topic: ContactTopic; name: string; email: string; company: string; message: string }) {
  const base = process.env.BETTER_AUTH_URL?.replace(/\/+$/, "")
  const from = [m.name, m.company].filter(Boolean).join(" · ")
  const lines = [`New contact message · ${topicLabels[m.topic]}`, "", preview(m.message, 1500), "", `— ${from}`, m.email]
  if (base) lines.push(`${base}/app/feedback/contact/${m.id}`)
  return lines.join("\n")
}
