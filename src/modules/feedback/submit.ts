"use server"

import { sql } from "drizzle-orm"
import { headers } from "next/headers"
import { after } from "next/server"
import { asPublic } from "@/db"
import { kindLabels, preview, submitFeedbackInput, type SubmitFeedbackInput } from "./schema"
import { clientIp, createChallenge, deriveKey, hashIp, verifySolution, type Challenge } from "./pow"
import { alertNewFeedback } from "@/modules/osbot/feedback-alerts"

// The public form's two server functions. No session is involved: the database
// function app.submit_feedback() is the only way in, and it re-validates
// everything and enforces the rate limits itself.

function secret() {
  const value = process.env.FEEDBACK_SECRET || process.env.BETTER_AUTH_SECRET
  if (!value || value.length < 32) throw new Error("Set BETTER_AUTH_SECRET (32+ characters) to accept feedback.")
  return value
}

export async function getFeedbackChallenge(): Promise<Challenge> {
  return createChallenge(deriveKey(secret(), "pow"))
}

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: string; field?: "kind" | "message" | "name" | "contact" }
  | { ok: false; retry: "challenge" }

const NETWORK = "That didn't send. Check your connection and try again — your text is still here."

function dbCode(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } }
  return e.cause?.code ?? e.code
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<SubmitResult> {
  const parsed = submitFeedbackInput.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path[0]
    if (field === "solution") return { ok: false, retry: "challenge" }
    return {
      ok: false,
      error: issue?.message ?? "Check the form and try again.",
      field: field === "kind" || field === "message" || field === "name" || field === "contact" ? field : undefined,
    }
  }
  const { kind, message, name, contact, website, solution } = parsed.data

  // Honeypot filled: a bot. Pretend it worked so it doesn't adapt.
  if (website.trim()) return { ok: true }

  const verdict = verifySolution(solution, deriveKey(secret(), "pow"))
  if (!verdict.ok) {
    if (verdict.reason === "too_fast") {
      return { ok: false, error: "That was very quick. Wait a few seconds and send again." }
    }
    // Expired or not ours: the form fetches a fresh challenge and retries once.
    return { ok: false, retry: "challenge" }
  }

  const ipHash = hashIp(clientIp(await headers()), deriveKey(secret(), "ip"))

  let id: string
  try {
    const rows = await asPublic((tx) =>
      tx.execute<{ id: string }>(
        sql`select app.submit_feedback(${kind}, ${message}, ${name}, ${contact}, ${ipHash}, ${solution.challenge}) as id`,
      ),
    )
    id = rows[0]!.id
  } catch (error) {
    switch (dbCode(error)) {
      case "OS429":
        return { ok: false, error: "You've sent 3 messages in the last 10 minutes. Wait a few minutes, then try again." }
      case "OS430":
        return { ok: false, error: "You've reached today's limit of 20 messages. Try again tomorrow." }
      case "OS409":
        return { ok: false, retry: "challenge" }
      case "OS001":
        return { ok: false, error: "Feedback isn't open yet. Try again later." }
      case "22023":
        return { ok: false, error: "Check the message and the optional fields, then send again." }
      default:
        return { ok: false, error: NETWORK }
    }
  }

  // After the response: Telegram can be slow or down without the visitor noticing.
  // osbot sends the alert when it is connected; otherwise the web notifies directly.
  after(() => alertNewFeedback(id, notificationText({ id, kind, message, name, contact })))
  return { ok: true }
}

function notificationText(f: { id: string; kind: keyof typeof kindLabels; message: string; name: string; contact: string }) {
  const from = [f.name || "Anonymous", f.contact].filter(Boolean).join(" · ")
  const base = process.env.BETTER_AUTH_URL?.replace(/\/+$/, "")
  const lines = [`New feedback · ${kindLabels[f.kind]}`, "", preview(f.message, 1500), "", `— ${from}`]
  if (base) lines.push(`${base}/app/feedback/${f.id}`)
  return lines.join("\n")
}
