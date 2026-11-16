import "server-only"
import { randomUUID } from "node:crypto"
import { desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm"
import { asViewer, requireViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import type { Tx } from "@/db"
import { filesDocuments, filesFiles, filesFolders } from "@/db/schema"
import { likeContains } from "@/lib/sql-like"
import { buildStorageKey, isOwnedKey } from "./lib/keys"
import { markdownToText } from "./lib/markdown"
import { presignDownload, presignUpload, removeObjects, statObject } from "./lib/s3"
import { checkUpload, cleanFileName, isAllowedMime, MAX_UPLOAD_BYTES, normalizeTags, previewKind } from "./lib/validation"
import {
  confirmUploadInput,
  createDocumentInput,
  createFolderInput,
  downloadInput,
  emptyInput,
  idInput,
  listFolderInput,
  moveInput,
  prepareUploadInput,
  recentInput,
  renameDocumentInput,
  renameFolderInput,
  searchInput,
  updateDocumentInput,
  updateFileInput,
  type DocumentDetail,
  type DocumentItem,
  type FileItem,
  type Folder,
  type FolderListing,
  type Item,
  type SearchResult,
} from "./schema"

/** An error whose message is safe and useful to show the user. */
export class FilesError extends Error {}

const folderColumns = {
  id: filesFolders.id,
  parentId: filesFolders.parentId,
  name: filesFolders.name,
  createdAt: filesFolders.createdAt,
  updatedAt: filesFolders.updatedAt,
}
const fileColumns = {
  id: filesFiles.id,
  folderId: filesFiles.folderId,
  name: filesFiles.name,
  size: filesFiles.sizeBytes,
  mime: filesFiles.mime,
  tags: filesFiles.tags,
  description: filesFiles.description,
  createdAt: filesFiles.createdAt,
  updatedAt: filesFiles.updatedAt,
}
const documentColumns = {
  id: filesDocuments.id,
  folderId: filesDocuments.folderId,
  name: filesDocuments.title,
  size: sql<number>`octet_length(${filesDocuments.body})`.mapWith(Number),
  head: sql<string>`left(${filesDocuments.body}, 400)`,
  createdAt: filesDocuments.createdAt,
  updatedAt: filesDocuments.updatedAt,
}

type Stamped = { createdAt: Date; updatedAt: Date }
const stamps = (row: Stamped) => ({ createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })

const toFolder = (row: typeof filesFolders.$inferSelect | ({ id: string; parentId: string | null; name: string } & Stamped)): Folder => ({
  id: row.id,
  parentId: row.parentId,
  name: row.name,
  ...stamps(row),
})
const toFile = (row: Omit<FileItem, "kind" | "createdAt" | "updatedAt"> & Stamped): FileItem => ({
  kind: "file",
  id: row.id,
  folderId: row.folderId,
  name: row.name,
  size: row.size,
  mime: row.mime,
  tags: row.tags,
  description: row.description,
  ...stamps(row),
})
const toDocument = (row: { id: string; folderId: string | null; name: string; size: number; head: string } & Stamped): DocumentItem => ({
  kind: "document",
  id: row.id,
  folderId: row.folderId,
  name: row.name,
  size: row.size,
  excerpt: markdownToText(row.head).slice(0, 160),
  ...stamps(row),
})

const inFolder = (column: typeof filesFiles.folderId | typeof filesDocuments.folderId | typeof filesFolders.parentId, id: string | null) =>
  id ? eq(column, id) : isNull(column)

/** Root first, the folder itself last. RLS applies inside the CTE too. */
async function folderPath(tx: Tx, id: string): Promise<Folder[]> {
  const rows = await tx.execute<{ id: string; parent_id: string | null; name: string; created_at: string; updated_at: string }>(sql`
    with recursive chain as (
      select id, parent_id, name, created_at, updated_at, 0 as depth from files_folders where id = ${id}
      union all
      select f.id, f.parent_id, f.name, f.created_at, f.updated_at, c.depth + 1
      from files_folders f join chain c on f.id = c.parent_id
      where c.depth < 64
    )
    select id, parent_id, name, created_at, updated_at from chain order by depth desc`)
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    name: r.name,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  }))
}

async function assertFolder(tx: Tx, id: string | null) {
  if (!id) return
  const [row] = await tx.select({ id: filesFolders.id }).from(filesFolders).where(eq(filesFolders.id, id))
  if (!row) throw new FilesError("That folder no longer exists.")
}

function isUniqueViolation(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } }
  return e.code === "23505" || e.cause?.code === "23505"
}

// Every action runs through asViewer(), so RLS scopes it to the signed-in user.
export const actions = {
  listFolder: defineAction({
    description:
      "List one folder of the user's knowledge base: its breadcrumb path, subfolders, files and markdown documents. folderId null means the top level. Returns null if the folder doesn't exist.",
    kind: "read",
    input: listFolderInput,
    handler: ({ folderId }): Promise<FolderListing | null> =>
      asViewer(async (tx) => {
        const path = folderId ? await folderPath(tx, folderId) : []
        if (folderId && path.length === 0) return null
        const [folders, files, documents] = await Promise.all([
          tx.select(folderColumns).from(filesFolders).where(inFolder(filesFolders.parentId, folderId)).orderBy(filesFolders.name),
          tx.select(fileColumns).from(filesFiles).where(inFolder(filesFiles.folderId, folderId)),
          tx.select(documentColumns).from(filesDocuments).where(inFolder(filesDocuments.folderId, folderId)),
        ])
        const items: Item[] = [...files.map(toFile), ...documents.map(toDocument)]
        return { folder: path.at(-1) ?? null, path, folders: folders.map(toFolder), items }
      }),
  }),
  allFolders: defineAction({
    description: "Every folder the user has, flat with parent ids, for building a tree.",
    kind: "read",
    input: emptyInput,
    handler: (): Promise<Folder[]> =>
      asViewer(async (tx) => (await tx.select(folderColumns).from(filesFolders).orderBy(filesFolders.name)).map(toFolder)),
  }),
  createFolder: defineAction({
    description: "Create a folder, at the top level (parentId null) or inside another folder.",
    kind: "write",
    input: createFolderInput,
    handler: ({ name, parentId }): Promise<Folder> =>
      asViewer(async (tx) => {
        await assertFolder(tx, parentId)
        try {
          const [row] = await tx.insert(filesFolders).values({ name, parentId }).returning()
          return toFolder(row!)
        } catch (error) {
          if (isUniqueViolation(error)) throw new FilesError(`There's already a folder called “${name}” here.`)
          throw error
        }
      }),
  }),
  renameFolder: defineAction({
    description: "Rename a folder.",
    kind: "write",
    input: renameFolderInput,
    handler: ({ id, name }): Promise<void> =>
      asViewer(async (tx) => {
        try {
          const rows = await tx.update(filesFolders).set({ name }).where(eq(filesFolders.id, id)).returning({ id: filesFolders.id })
          if (!rows.length) throw new FilesError("That folder no longer exists.")
        } catch (error) {
          if (isUniqueViolation(error)) throw new FilesError(`There's already a folder called “${name}” next to it.`)
          throw error
        }
      }),
  }),
  move: defineAction({
    description:
      "Move a folder, file or document into another folder (folderId null = top level). A folder can't move into itself or its own subfolders.",
    kind: "write",
    input: moveInput,
    handler: ({ kind, id, folderId }): Promise<void> =>
      asViewer(async (tx) => {
        await assertFolder(tx, folderId)
        if (kind === "folder") {
          if (folderId) {
            const path = await folderPath(tx, folderId)
            if (path.some((f) => f.id === id)) throw new FilesError("A folder can't go inside itself.")
          }
          try {
            const rows = await tx.update(filesFolders).set({ parentId: folderId }).where(eq(filesFolders.id, id)).returning({ id: filesFolders.id })
            if (!rows.length) throw new FilesError("That folder no longer exists.")
          } catch (error) {
            if (isUniqueViolation(error)) throw new FilesError("The destination already has a folder with that name.")
            throw error
          }
          return
        }
        const table = kind === "file" ? filesFiles : filesDocuments
        const rows = await tx.update(table).set({ folderId }).where(eq(table.id, id)).returning({ id: table.id })
        if (!rows.length) throw new FilesError(`That ${kind} no longer exists.`)
      }),
  }),
  deleteFolder: defineAction({
    description:
      "Permanently delete a folder with everything inside it: subfolders, documents, and files (their stored objects too).",
    kind: "write",
    input: idInput,
    handler: async ({ id }): Promise<{ files: number }> => {
      const keys = await asViewer(async (tx) => {
        const rows = await tx.execute<{ storage_key: string }>(sql`
          with recursive tree as (
            select id from files_folders where id = ${id}
            union all
            select f.id from files_folders f join tree t on f.parent_id = t.id
          )
          select storage_key from files_files where folder_id in (select id from tree)`)
        await tx.delete(filesFolders).where(eq(filesFolders.id, id))
        return rows.map((r) => r.storage_key)
      })
      // After commit: the rows are the source of truth, objects follow.
      await removeObjects(keys)
      return { files: keys.length }
    },
  }),

  prepareUpload: defineAction({
    description:
      "Start an upload: checks size (≤ 100 MB) and type, and returns a short-lived presigned PUT URL plus the object key to confirm afterwards.",
    kind: "write",
    input: prepareUploadInput,
    handler: async ({ name, size, type, folderId }) => {
      const viewer = await requireViewer()
      const check = checkUpload({ name, size, type })
      if (!check.ok) throw new FilesError(check.error)
      await asViewer((tx) => assertFolder(tx, folderId))
      const key = buildStorageKey(viewer.id, randomUUID())
      const url = await presignUpload(key, check.mime, size)
      return { key, url, mime: check.mime }
    },
  }),
  confirmUpload: defineAction({
    description:
      "Finish an upload: verifies the object arrived with an allowed size and type, then records the file. Removes the object if it can't be recorded.",
    kind: "write",
    input: confirmUploadInput,
    handler: async ({ key, name, folderId }): Promise<FileItem> => {
      const viewer = await requireViewer()
      if (!isOwnedKey(viewer.id, key)) throw new FilesError("That upload doesn't belong to you.")
      const existing = await asViewer((tx) => tx.select(fileColumns).from(filesFiles).where(eq(filesFiles.storageKey, key)))
      if (existing[0]) return toFile(existing[0])

      const stat = await statObject(key)
      if (!stat) throw new FilesError("The upload didn't arrive. Try again.")
      if (stat.size > MAX_UPLOAD_BYTES || !isAllowedMime(stat.mime)) {
        await removeObjects([key])
        throw new FilesError("The uploaded file isn't allowed (over 100 MB or an unsupported type).")
      }
      try {
        return await asViewer(async (tx) => {
          await assertFolder(tx, folderId)
          const [row] = await tx
            .insert(filesFiles)
            .values({ name: cleanFileName(name), sizeBytes: stat.size, mime: stat.mime, storageKey: key, folderId })
            .returning(fileColumns)
          return toFile(row!)
        })
      } catch (error) {
        await removeObjects([key])
        throw error
      }
    },
  }),
  getFile: defineAction({
    description: "Get one file's metadata (name, size, type, tags, description, folder). Null if it doesn't exist.",
    kind: "read",
    input: idInput,
    handler: ({ id }): Promise<(FileItem & { path: Folder[] }) | null> =>
      asViewer(async (tx) => {
        const [row] = await tx.select(fileColumns).from(filesFiles).where(eq(filesFiles.id, id))
        if (!row) return null
        return { ...toFile(row), path: row.folderId ? await folderPath(tx, row.folderId) : [] }
      }),
  }),
  updateFile: defineAction({
    description: "Rename a file and replace its description and tags.",
    kind: "write",
    input: updateFileInput,
    handler: ({ id, name, description, tags }): Promise<FileItem> =>
      asViewer(async (tx) => {
        const [row] = await tx
          .update(filesFiles)
          .set({ name: cleanFileName(name), description, tags: normalizeTags(tags) })
          .where(eq(filesFiles.id, id))
          .returning(fileColumns)
        if (!row) throw new FilesError("That file no longer exists.")
        return toFile(row)
      }),
  }),
  deleteFile: defineAction({
    description: "Permanently delete a file and its stored object.",
    kind: "write",
    input: idInput,
    handler: async ({ id }): Promise<void> => {
      const rows = await asViewer((tx) =>
        tx.delete(filesFiles).where(eq(filesFiles.id, id)).returning({ key: filesFiles.storageKey }),
      )
      await removeObjects(rows.map((r) => r.key))
    },
  }),
  downloadUrl: defineAction({
    description:
      "A presigned download URL valid for 60 seconds. Inline display is only allowed for images and PDFs; everything else downloads.",
    kind: "read",
    input: downloadInput,
    handler: async ({ id, inline }): Promise<string | null> => {
      const [row] = await asViewer((tx) =>
        tx.select({ key: filesFiles.storageKey, name: filesFiles.name, mime: filesFiles.mime }).from(filesFiles).where(eq(filesFiles.id, id)),
      )
      if (!row) return null
      const disposition = inline && previewKind(row.mime) ? "inline" : "attachment"
      return presignDownload(row.key, { name: row.name, mime: row.mime, disposition })
    },
  }),

  createDocument: defineAction({
    description: "Create a markdown document in a folder (folderId null = top level).",
    kind: "write",
    input: createDocumentInput,
    handler: ({ title, body, folderId }): Promise<{ id: string; updatedAt: string }> =>
      asViewer(async (tx) => {
        await assertFolder(tx, folderId)
        const [row] = await tx
          .insert(filesDocuments)
          .values({ title, body, folderId })
          .returning({ id: filesDocuments.id, updatedAt: filesDocuments.updatedAt })
        return { id: row!.id, updatedAt: row!.updatedAt.toISOString() }
      }),
  }),
  getDocument: defineAction({
    description: "Get one markdown document with its full body and folder path. Null if it doesn't exist.",
    kind: "read",
    input: idInput,
    handler: ({ id }): Promise<(DocumentDetail & { path: Folder[] }) | null> =>
      asViewer(async (tx) => {
        const [row] = await tx.select().from(filesDocuments).where(eq(filesDocuments.id, id))
        if (!row) return null
        return {
          id: row.id,
          folderId: row.folderId,
          title: row.title,
          body: row.body,
          ...stamps(row),
          path: row.folderId ? await folderPath(tx, row.folderId) : [],
        }
      }),
  }),
  updateDocument: defineAction({
    description: "Replace a markdown document's title and body.",
    kind: "write",
    input: updateDocumentInput,
    handler: ({ id, title, body }): Promise<{ updatedAt: string }> =>
      asViewer(async (tx) => {
        const [row] = await tx
          .update(filesDocuments)
          .set({ title, body })
          .where(eq(filesDocuments.id, id))
          .returning({ updatedAt: filesDocuments.updatedAt })
        if (!row) throw new FilesError("That document no longer exists.")
        return { updatedAt: row.updatedAt.toISOString() }
      }),
  }),
  renameDocument: defineAction({
    description: "Change a markdown document's title, leaving its body as is.",
    kind: "write",
    input: renameDocumentInput,
    handler: ({ id, title }): Promise<void> =>
      asViewer(async (tx) => {
        const rows = await tx.update(filesDocuments).set({ title }).where(eq(filesDocuments.id, id)).returning({ id: filesDocuments.id })
        if (!rows.length) throw new FilesError("That document no longer exists.")
      }),
  }),
  deleteDocument: defineAction({
    description: "Permanently delete a markdown document.",
    kind: "write",
    input: idInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.delete(filesDocuments).where(eq(filesDocuments.id, id))
      }),
  }),

  search: defineAction({
    description:
      "Search the knowledge base: folder names, file names, descriptions and tags, and document titles and text. Case-insensitive substring match.",
    kind: "read",
    input: searchInput,
    handler: ({ query, limit }): Promise<SearchResult[]> =>
      asViewer(async (tx) => {
        const pattern = likeContains(query)
        const tag = query.toLowerCase()
        const fileMatch: SQL = or(
          ilike(filesFiles.name, pattern),
          ilike(filesFiles.description, pattern),
          sql`${tag} = any(${filesFiles.tags})`,
        )!
        const [folders, files, documents, allFolders] = await Promise.all([
          tx.select(folderColumns).from(filesFolders).where(ilike(filesFolders.name, pattern)).limit(limit),
          tx.select(fileColumns).from(filesFiles).where(fileMatch).orderBy(desc(filesFiles.createdAt)).limit(limit),
          tx
            .select({
              ...documentColumns,
              // Centre the snippet on the match when it's in the body.
              head: sql<string>`substr(${filesDocuments.body}, greatest(1, strpos(lower(${filesDocuments.body}), lower(${query})) - 60), 400)`,
            })
            .from(filesDocuments)
            .where(or(ilike(filesDocuments.title, pattern), ilike(filesDocuments.body, pattern)))
            .orderBy(desc(filesDocuments.updatedAt))
            .limit(limit),
          tx.select({ id: filesFolders.id, name: filesFolders.name }).from(filesFolders),
        ])
        const names = new Map(allFolders.map((f) => [f.id, f.name]))
        const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null)
        return [
          ...folders.map((f) => ({ ...toFolder(f), kind: "folder" as const, folderName: nameOf(f.parentId) })),
          ...documents.map((d) => ({ ...toDocument(d), folderName: nameOf(d.folderId) })),
          ...files.map((f) => ({ ...toFile(f), folderName: nameOf(f.folderId) })),
        ].slice(0, limit)
      }),
  }),
  recent: defineAction({
    description: "The most recently added files and documents, newest first.",
    kind: "read",
    input: recentInput,
    handler: ({ limit }): Promise<Item[]> =>
      asViewer(async (tx) => {
        const [files, documents] = await Promise.all([
          tx.select(fileColumns).from(filesFiles).orderBy(desc(filesFiles.createdAt)).limit(limit),
          tx.select(documentColumns).from(filesDocuments).orderBy(desc(filesDocuments.createdAt)).limit(limit),
        ])
        return [...files.map(toFile), ...documents.map(toDocument)]
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .slice(0, limit)
      }),
  }),
}

