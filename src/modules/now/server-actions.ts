"use server"

import { revalidatePath, updateTag } from "next/cache"
import { actions } from "./actions"
import { NOW_PUBLIC_TAG, nowSettingsInput } from "./schema"

export type NowSaveResult = { ok: true; updatedAt: string } | { ok: false; error: string }

/** The settings page's autosave. Drops the public page's cache, so /now shows it on the next visit. */
export async function saveNowSettings(input: unknown): Promise<NowSaveResult> {
  const parsed = nowSettingsInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the fields and try again." }
  try {
    const saved = await actions.save.handler(parsed.data)
    updateTag(NOW_PUBLIC_TAG)
    revalidatePath("/app/now")
    return { ok: true, updatedAt: saved.updatedAt ?? new Date().toISOString() }
  } catch {
    return { ok: false, error: "Changes weren't saved. Check your connection; they retry on the next edit." }
  }
}
