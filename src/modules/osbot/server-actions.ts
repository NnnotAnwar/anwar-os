"use server"

import { refresh } from "next/cache"
import { requireViewer } from "@/core/auth"
import { briefSettingsInput, saveBriefSettings, type BriefSettings } from "./brief"

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }

/** Settings → Telegram: the morning brief on/off and its time. Only the owner has osbot. */
export async function updateBriefSettings(input: unknown): Promise<Result<BriefSettings>> {
  const viewer = await requireViewer()
  if (viewer.role !== "owner") return { ok: false, error: "Only the owner has osbot." }
  const parsed = briefSettingsInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the time." }
  try {
    const value = await saveBriefSettings(parsed.data)
    refresh()
    return { ok: true, value }
  } catch (error) {
    console.error("brief settings failed", error)
    return { ok: false, error: "The setting wasn't saved. Try again." }
  }
}
