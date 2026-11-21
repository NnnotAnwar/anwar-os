"use server"

import { refresh } from "next/cache"
import type { z } from "zod"
import { actions, BotInputError } from "./actions"
import { botIdInput, botInput, updateBotInput, type Bot } from "./schema"

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }

async function run<S extends z.ZodType, T>(schema: S, input: unknown, fn: (data: z.output<S>) => Promise<T>, fallback: string): Promise<Result<T>> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? fallback }
  try {
    const value = await fn(parsed.data)
    refresh()
    return { ok: true, value }
  } catch (e) {
    if (e instanceof BotInputError) return { ok: false, error: e.message }
    console.error("bots action failed", e)
    return { ok: false, error: fallback }
  }
}

const SAVE_FAILED = "That didn't save. Check your connection and try again."

export async function createBot(input: unknown): Promise<Result<Bot>> {
  return run(botInput, input, (d) => actions.create.handler(d), SAVE_FAILED)
}

export async function updateBot(input: unknown): Promise<Result<Bot | null>> {
  return run(updateBotInput, input, (d) => actions.update.handler(d), SAVE_FAILED)
}

export async function deleteBot(input: unknown): Promise<Result> {
  return run(botIdInput, input, (d) => actions.delete.handler(d), "The bot wasn't removed. Try again.")
}

export async function addKnownBots(): Promise<Result<number>> {
  try {
    const n = await actions.addKnown.handler({})
    refresh()
    return { ok: true, value: n }
  } catch (e) {
    console.error("bots addKnown failed", e)
    return { ok: false, error: SAVE_FAILED }
  }
}
