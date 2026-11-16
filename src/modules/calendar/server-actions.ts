"use server"

import { refresh, revalidatePath } from "next/cache"
import type { z } from "zod"
import { actions } from "./actions"
import { createEventInput, EventInputError, eventIdInput, updateEventInput, type EventDetail, type FeedInfo } from "./schema"

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }

async function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (data: z.output<S>) => Promise<T>,
  fallback: string,
): Promise<Result<T>> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? fallback }
  try {
    return { ok: true, value: await fn(parsed.data) }
  } catch (error) {
    if (error instanceof EventInputError) return { ok: false, error: error.message }
    console.error("calendar action failed", error)
    return { ok: false, error: fallback }
  }
}

function refreshCalendar() {
  revalidatePath("/app/calendar")
  revalidatePath("/app")
  refresh()
}

export async function createEvent(input: unknown) {
  const result = await run(createEventInput, input, (d) => actions.create.handler(d), "The event wasn't saved. Try again.")
  if (result.ok) refreshCalendar()
  return result
}

export async function updateEvent(input: unknown) {
  const result = await run(updateEventInput, input, (d) => actions.update.handler(d), "Changes weren't saved. Try again.")
  if (result.ok) refreshCalendar()
  return result
}

export async function deleteEvent(input: { id: string }) {
  const result = await run(eventIdInput, input, (d) => actions.delete.handler(d), "The event wasn't deleted. Try again.")
  if (result.ok) refreshCalendar()
  return result
}

export async function getEvent(input: { id: string }): Promise<Result<EventDetail | null>> {
  return run(eventIdInput, input, (d) => actions.get.handler(d), "The event couldn't be loaded.")
}

export async function rotateFeed(): Promise<Result<FeedInfo>> {
  try {
    return { ok: true, value: await actions.rotateFeed.handler({}) }
  } catch (error) {
    console.error("calendar feed rotation failed", error)
    return { ok: false, error: "The feed address wasn't changed. Try again." }
  }
}

export async function disableFeed(): Promise<Result> {
  try {
    await actions.disableFeed.handler({})
    return { ok: true, value: undefined }
  } catch (error) {
    console.error("calendar feed disable failed", error)
    return { ok: false, error: "The feed wasn't turned off. Try again." }
  }
}
