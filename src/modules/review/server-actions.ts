"use server"

import { revalidatePath } from "next/cache"
import { actions } from "./actions"
import { savePdfInput, type SavedReport } from "./schema"

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** The page's "Save to Files" button. */
export async function saveReportToFiles(input: { month: string }): Promise<Result<SavedReport>> {
  const parsed = savePdfInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Pick a month." }
  try {
    const value = await actions.savePdf.handler(parsed.data)
    if (value.saved) revalidatePath("/app/files")
    return { ok: true, value }
  } catch (error) {
    console.error("review: saving the report failed", error)
    return { ok: false, error: "The report wasn't saved. Try again." }
  }
}
