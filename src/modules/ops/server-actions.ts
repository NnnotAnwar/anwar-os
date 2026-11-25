"use server"

import { refresh } from "next/cache"
import type { z } from "zod"
import { actions, type ControlResult, type DeployResult } from "./actions"
import { alertSettingsInput, type AlertSettings } from "./alerts"
import { ErrorNotFound, errorStatusInput, type ErrorStatusResult, type ErrorsView } from "./errors"
import { deleteOrphansInput, type DeleteOrphansResult, type FilesCheckView, type RunResult } from "./files-check"
import type { TagsResult } from "./ghcr"
import type { ServerStatus } from "./host"
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

/** Polled by the Server section (every minute while visible). */
export async function pollServer(): Promise<ServerStatus | null> {
  try {
    return await actions.server.handler({})
  } catch {
    return null
  }
}

export async function updateAlertSettings(input: unknown): Promise<{ ok: true; settings: AlertSettings } | { ok: false; error: string }> {
  const data = await parse(alertSettingsInput, input)
  if (!data) return { ok: false, error: "Those settings aren't valid." }
  try {
    return { ok: true, settings: await actions.updateAlertSettings.handler(data) }
  } catch (e) {
    console.error("ops alert settings failed", e)
    return { ok: false, error: OFFLINE }
  }
}

export async function loadEvents(input: unknown): Promise<OpsEvent[]> {
  const data = await parse(eventsInput, input)
  if (!data) return []
  return actions.events.handler(data)
}

/** Ops → Server → Files storage → Check now (rate-limited). */
export async function checkFilesNow(): Promise<RunResult> {
  try {
    return await actions.runFilesCheck.handler({})
  } catch (e) {
    console.error("ops files check failed", e)
    return { ok: false, error: OFFLINE }
  }
}

export async function loadFilesCheck(): Promise<FilesCheckView | null> {
  try {
    return await actions.filesCheck.handler({})
  } catch {
    return null
  }
}

export async function deleteFileOrphans(input: unknown): Promise<DeleteOrphansResult> {
  const data = await parse(deleteOrphansInput, input)
  if (!data) return { ok: false, error: "Pick orphaned objects from the list." }
  try {
    return await actions.deleteFileOrphans.handler(data)
  } catch (e) {
    console.error("ops delete orphans failed", e)
    return { ok: false, error: OFFLINE }
  }
}

/** Ops → Errors: Resolve (one tap) and its Undo. */
export async function changeErrorStatus(input: unknown): Promise<{ ok: true; result: ErrorStatusResult } | { ok: false; error: string }> {
  const data = await parse(errorStatusInput, input)
  if (!data) return { ok: false, error: "Unknown error group." }
  try {
    const result = await actions.setErrorStatus.handler(data)
    refresh() // the Ops card's badge
    return { ok: true, result }
  } catch (e) {
    if (e instanceof ErrorNotFound) return { ok: false, error: e.message }
    console.error("ops error status failed", e)
    return { ok: false, error: OFFLINE }
  }
}

/** Polled by the Errors section (every minute while visible). */
export async function pollErrors(): Promise<ErrorsView | null> {
  try {
    return await actions.errors.handler({ openLimit: 100, resolvedLimit: 20 })
  } catch {
    return null
  }
}
