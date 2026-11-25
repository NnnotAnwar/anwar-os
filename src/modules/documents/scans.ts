import "server-only"
import { and, eq, isNull } from "drizzle-orm"
import { asViewer } from "@/core/auth"
import { filesFolders } from "@/db/schema"
import { actions as files } from "@/modules/files/actions"
import type { FileItem } from "@/modules/files/schema"
import { DOCUMENTS_FOLDER, type AttachedFile } from "./schema"

// Scans uploaded from the document form go through the files module's own
// upload (presigned PUT to the private bucket, then confirm), into the
// top-level "Documents" folder in Files, made on first use. Nothing here is
// public: downloads always go through /app/files/file/<id>/raw (session + RLS).

/** The id of Files → Documents, created on first use. */
export async function documentsFolder(): Promise<string> {
  return asViewer(async (tx) => {
    const top = and(isNull(filesFolders.parentId), eq(filesFolders.name, DOCUMENTS_FOLDER))
    const [found] = await tx.select({ id: filesFolders.id }).from(filesFolders).where(top)
    if (found) return found.id
    // Sibling names are unique (nulls not distinct): a concurrent upload just finds it.
    await tx.insert(filesFolders).values({ name: DOCUMENTS_FOLDER, parentId: null }).onConflictDoNothing()
    const [made] = await tx.select({ id: filesFolders.id }).from(filesFolders).where(top)
    return made!.id
  })
}

export async function prepareScan(input: { name: string; size: number; type: string }) {
  const folderId = await documentsFolder()
  const prepared = await files.prepareUpload.handler({ ...input, folderId })
  return { ...prepared, folderId }
}

export async function confirmScan(input: { key: string; name: string; folderId: string }): Promise<AttachedFile> {
  const file = await files.confirmUpload.handler(input)
  return toAttached(file)
}

const toAttached = (file: FileItem): AttachedFile => ({ id: file.id, name: file.name, size: file.size, mime: file.mime })

export type PickableFile = AttachedFile & { folderName: string | null }

/** Files to attach: matching `query` (name, description, tags), or the most recent ones. */
export async function findFiles(query: string): Promise<PickableFile[]> {
  if (query.trim()) {
    const hits = await files.search.handler({ query, limit: 30 })
    return hits.filter((hit) => hit.kind === "file").map((hit) => ({ ...toAttached(hit as FileItem), folderName: hit.folderName }))
  }
  const recent = await files.recent.handler({ limit: 30 })
  return recent.filter((item): item is FileItem => item.kind === "file").map((file) => ({ ...toAttached(file), folderName: null }))
}
