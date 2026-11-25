"use server"

import { refresh, revalidatePath } from "next/cache"
import { z } from "zod"
import { FilesError } from "@/modules/files/actions"
import { StorageNotConfiguredError } from "@/modules/files/lib/s3"
import { actions, DocumentInputError } from "./actions"
import { confirmScan, findFiles, prepareScan, type PickableFile } from "./scans"
import {
  createDocumentInput,
  documentIdInput,
  renewDocumentInput,
  updateDocumentInput,
  type AttachedFile,
  type DocumentDetail,
} from "./schema"

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Validates with zod, runs the action, and turns failures into a message the
 * UI can show. DocumentInputError / FilesError messages are written for
 * people; anything else is logged and replaced with `fallback`.
 */
async function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (data: z.output<S>) => Promise<T>,
  fallback: string,
  { refreshPage = true } = {},
): Promise<Result<T>> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? fallback }
  try {
    const value = await fn(parsed.data)
    if (refreshPage) {
      revalidatePath("/app/documents")
      refresh()
    }
    return { ok: true, value }
  } catch (error) {
    if (error instanceof DocumentInputError || error instanceof FilesError || error instanceof StorageNotConfiguredError) {
      return { ok: false, error: error.message }
    }
    console.error("documents action failed", error)
    return { ok: false, error: fallback }
  }
}

export async function createDocument(input: unknown): Promise<Result<DocumentDetail>> {
  return run(createDocumentInput, input, (d) => actions.create.handler(d), "The document wasn't added. Try again.")
}

export async function updateDocument(input: unknown): Promise<Result<DocumentDetail>> {
  return run(updateDocumentInput, input, (d) => actions.update.handler(d), "Changes weren't saved. Try again.")
}

export async function renewDocument(input: unknown): Promise<Result<DocumentDetail>> {
  return run(renewDocumentInput, input, (d) => actions.renew.handler(d), "The renewal wasn't saved. Try again.")
}

/** Called once the Undo window is over (removeWithUndo). */
export async function deleteDocument(input: unknown) {
  return run(documentIdInput, input, (d) => actions.delete.handler(d), "The document wasn't deleted. Try again.")
}

const scanInput = z.object({
  name: z.string().min(1).max(1000),
  size: z.number().int().min(0),
  type: z.string().max(200),
})
const confirmScanInput = z.object({ key: z.string().min(1).max(200), name: z.string().min(1).max(1000), folderId: z.uuid() })

/** Step 1 of a scan upload: a presigned PUT into Files → Documents. */
export async function prepareScanUpload(input: unknown) {
  return run(scanInput, input, (d) => prepareScan(d), "The upload couldn't start. Try again.", { refreshPage: false })
}

/** Step 3: records the uploaded file; the form attaches it when saved. */
export async function confirmScanUpload(input: unknown): Promise<Result<AttachedFile>> {
  return run(confirmScanInput, input, (d) => confirmScan(d), "The scan uploaded but wasn't saved. Try again.", { refreshPage: false })
}

/** The "Choose from Files" picker: matching files, or the most recent ones. */
export async function searchFiles(input: unknown): Promise<Result<PickableFile[]>> {
  return run(z.object({ query: z.string().max(100) }), input, (d) => findFiles(d.query), "Files couldn't be listed. Try again.", {
    refreshPage: false,
  })
}
