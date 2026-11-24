"use server"

import { z } from "zod"
import { ClaudeDisabledError, describeClaudeError } from "@/lib/claude"
import { actions } from "../actions"
import type { CategoryOption } from "../components/types"
import { ReceiptError } from "./lib"
import { scanReceipt, type ReceiptDraft } from "./service"

// Budget quick add → "Scan receipt": the photo (resized in the browser) is read
// by Claude on the server and comes back as a draft the owner confirms in a
// sheet; saving goes through the normal createTransaction action.

export type ScanReceiptResult =
  | { ok: true; draft: ReceiptDraft; categories: CategoryOption[] }
  | { ok: false; error: string; disabled?: boolean }

// Server actions take bodies up to 1 MB; the browser sends a resized JPEG well under that.
const input = z.object({ image: z.string().min(16).max(1_000_000) })

export async function scanReceiptPhoto(raw: unknown): Promise<ScanReceiptResult> {
  const parsed = input.safeParse(raw)
  if (!parsed.success) return { ok: false, error: "That photo didn't come through. Try again." }
  try {
    const result = await scanReceipt(parsed.data.image)
    if (result.status !== "ok") return { ok: false, error: result.message }
    const categories = await actions.listCategories.handler({ includeArchived: false })
    return {
      ok: true,
      draft: result.draft,
      categories: categories.map(({ id, name, kind, parentId, color }) => ({ id, name, kind, parentId, color })),
    }
  } catch (error) {
    if (error instanceof ClaudeDisabledError) return { ok: false, disabled: true, error: "Receipt reading is off: add ANTHROPIC_API_KEY on the server." }
    if (error instanceof ReceiptError) return { ok: false, error: error.message }
    console.error("budget: receipt scan failed", error)
    return { ok: false, error: describeClaudeError(error) }
  }
}
