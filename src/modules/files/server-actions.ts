"use server"

import { refresh, revalidatePath } from "next/cache"
import type { z } from "zod"
import { actions, FilesError } from "./actions"
import { StorageNotConfiguredError } from "./lib/s3"
import {
  confirmUploadInput,
  createDocumentInput,
  createFolderInput,
  idInput,
  moveInput,
  prepareUploadInput,
  renameDocumentInput,
  renameFolderInput,
  updateDocumentInput,
  updateFileInput,
} from "./schema"

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Validates with zod, runs the action, and turns failures into a message the
 * UI can show. FilesError messages are written for people; anything else is
 * logged and replaced with a generic hint.
 */
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
    if (error instanceof FilesError || error instanceof StorageNotConfiguredError) return { ok: false, error: error.message }
    console.error("files action failed", error)
    return { ok: false, error: fallback }
  }
}

function refreshList() {
  revalidatePath("/app/files")
  refresh()
}

export async function createFolder(input: { name: string; parentId: string | null }) {
  const result = await run(createFolderInput, input, (d) => actions.createFolder.handler(d), "The folder wasn't created. Try again.")
  if (result.ok) refreshList()
  return result
}

export async function renameFolder(input: { id: string; name: string }) {
  const result = await run(renameFolderInput, input, (d) => actions.renameFolder.handler(d), "The folder wasn't renamed. Try again.")
  if (result.ok) refreshList()
  return result
}

export async function moveItem(input: { kind: "folder" | "file" | "document"; id: string; folderId: string | null }) {
  const result = await run(moveInput, input, (d) => actions.move.handler(d), "It wasn't moved. Try again.")
  if (result.ok) refreshList()
  return result
}

export async function deleteFolder(input: { id: string }) {
  const result = await run(idInput, input, (d) => actions.deleteFolder.handler(d), "The folder wasn't deleted. Try again.")
  if (result.ok) refreshList()
  return result
}

export async function prepareUpload(input: { name: string; size: number; type: string; folderId: string | null }) {
  return run(prepareUploadInput, input, (d) => actions.prepareUpload.handler(d), "The upload couldn't start. Try again.")
}

/** No refresh here: the uploader refreshes once when its whole batch is done. */
export async function confirmUpload(input: { key: string; name: string; folderId: string | null }) {
  return run(confirmUploadInput, input, (d) => actions.confirmUpload.handler(d), "The file uploaded but wasn't saved. Try again.")
}

export async function finishUploads() {
  refreshList()
}

export async function updateFile(input: { id: string; name: string; description: string; tags: string[] }) {
  const result = await run(updateFileInput, input, (d) => actions.updateFile.handler(d), "Changes weren't saved. Try again.")
  if (result.ok) refreshList()
  return result
}

export async function deleteFile(input: { id: string }) {
  const result = await run(idInput, input, (d) => actions.deleteFile.handler(d), "The file wasn't deleted. Try again.")
  if (result.ok) refreshList()
  return result
}

export type SaveResult = { ok: true; id: string; updatedAt: string } | { ok: false; error: string }

/** Creates without navigating: the editor swaps its URL in place and keeps typing. */
export async function createDocument(input: { title: string; body: string; folderId: string | null }): Promise<SaveResult> {
  const result = await run(createDocumentInput, input, (d) => actions.createDocument.handler(d), "The document wasn't created. It retries on the next edit.")
  return result.ok ? { ok: true, ...result.value } : result
}

export async function saveDocument(input: { id: string; title: string; body: string }): Promise<SaveResult> {
  const result = await run(updateDocumentInput, input, (d) => actions.updateDocument.handler(d), "Changes weren't saved. They'll retry on the next edit.")
  return result.ok ? { ok: true, id: input.id, updatedAt: result.value.updatedAt } : result
}

export async function renameDocument(input: { id: string; title: string }) {
  const result = await run(renameDocumentInput, input, (d) => actions.renameDocument.handler(d), "The document wasn't renamed. Try again.")
  if (result.ok) refreshList()
  return result
}

export async function deleteDocument(input: { id: string }) {
  const result = await run(idInput, input, (d) => actions.deleteDocument.handler(d), "The document wasn't deleted. Try again.")
  if (result.ok) refreshList()
  return result
}
