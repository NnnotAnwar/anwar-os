"use server"

import { refresh } from "next/cache"
import type { z } from "zod"
import { actions, type ControlResult, type DeployResult } from "./actions"
import type { TagsResult } from "./ghcr"
import { controlInput, deployInput, eventsInput, logsInput, tagsInput, type LogLine, type OpsEvent, type ServicesResult } from "./schema"

const OFFLINE = "That didn't reach the server. Check your connection and try again."

async function parse<S extends z.ZodType>(schema: S, input: unknown): Promise<z.output<S> | null> {
  const parsed = schema.safeParse(input)
  return parsed.success ? parsed.data : null
}

/** Polled by the panel (every 10 s while visible). No re-render: the client swaps the data. */
export async function pollServices(): Promise<ServicesResult> {
  try {
    return await actions.services.handler({ stats: true })
  } catch {
    return { connected: false, reason: "error", message: OFFLINE }
  }
}

export async function pollLogs(input: unknown): Promise<{ ok: true; lines: LogLine[] } | { ok: false; error: string }> {
  const data = await parse(logsInput, input)
  if (!data) return { ok: false, error: "Unknown service." }
  try {
    return await actions.logs.handler(data)
  } catch {
    return { ok: false, error: OFFLINE }
  }
}

export async function controlService(input: unknown): Promise<ControlResult> {
  const data = await parse(controlInput, input)
  if (!data) return { ok: false, error: "Unknown service or action." }
  try {
    const result = await actions.control.handler(data)
    refresh() // the activity list and Today's "Systems" tile
    return result
  } catch (e) {
    console.error("ops control failed", e)
    return { ok: false, error: OFFLINE }
  }
}

export async function deployService(input: unknown): Promise<DeployResult> {
  const data = await parse(deployInput, input)
  if (!data) return { ok: false, error: "Pick a tag from the list or type a valid one." }
  try {
    const result = await actions.deploy.handler(data)
    refresh()
    return result
  } catch (e) {
    console.error("ops deploy failed", e)
    return { ok: false, error: OFFLINE }
  }
}

export async function loadTags(input: unknown): Promise<TagsResult> {
  const data = await parse(tagsInput, input)
  if (!data) return { ok: false, error: "Unknown service." }
  try {
    return await actions.tags.handler(data)
  } catch {
    return { ok: false, error: OFFLINE }
  }
}

export async function loadEvents(input: unknown): Promise<OpsEvent[]> {
  const data = await parse(eventsInput, input)
  if (!data) return []
  return actions.events.handler(data)
}
