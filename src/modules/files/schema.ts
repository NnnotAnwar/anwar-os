// Inputs and shared types for the files module. Client-safe.
import { z } from "zod"
import { MAX_UPLOAD_BYTES } from "./lib/validation"

const folderName = z
  .string()
  .trim()
  .min(1, "Give the folder a name.")
  .max(120, "Keep folder names under 120 characters.")
  .refine((v) => !/[/\\]/.test(v), "Folder names can't contain / or \\.")

const parent = z.uuid().nullable()

export const idInput = z.object({ id: z.uuid() })
export const emptyInput = z.object({})
export const downloadInput = z.object({ id: z.uuid(), inline: z.boolean().default(false) })
export const listFolderInput = z.object({ folderId: parent })
export const createFolderInput = z.object({ name: folderName, parentId: parent })
export const renameFolderInput = z.object({ id: z.uuid(), name: folderName })
export const moveInput = z.object({
  kind: z.enum(["folder", "file", "document"]),
  id: z.uuid(),
  folderId: parent,
})

export const prepareUploadInput = z.object({
  name: z.string().min(1).max(1000),
  size: z.number().int().min(0).max(MAX_UPLOAD_BYTES, "Files can be up to 100 MB."),
  type: z.string().max(200),
  folderId: parent,
})
export const confirmUploadInput = z.object({
  key: z.string().min(1).max(200),
  name: z.string().min(1).max(1000),
  folderId: parent,
})

export const updateFileInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Give the file a name.").max(255, "Keep the name under 255 characters."),
  description: z.string().max(2000, "Keep the description under 2,000 characters."),
  tags: z.array(z.string().max(100)).max(50),
})

export const documentFields = {
  title: z.string().trim().min(1, "Give the document a title.").max(200, "Keep the title under 200 characters."),
  body: z.string().max(200_000, "This document is too long to save."),
}
export const createDocumentInput = z.object({ ...documentFields, body: documentFields.body.default(""), folderId: parent })
export const updateDocumentInput = z.object({ id: z.uuid(), ...documentFields })
export const renameDocumentInput = z.object({ id: z.uuid(), title: documentFields.title })

export const searchInput = z.object({
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(100).default(30),
})
export const recentInput = z.object({ limit: z.number().int().min(1).max(50).default(6) })

export type Folder = { id: string; parentId: string | null; name: string; createdAt: string; updatedAt: string }

export type FileItem = {
  kind: "file"
  id: string
  folderId: string | null
  name: string
  size: number
  mime: string
  tags: string[]
  description: string
  createdAt: string
  updatedAt: string
}

export type DocumentItem = {
  kind: "document"
  id: string
  folderId: string | null
  name: string
  /** Body length in bytes, so documents sort by size alongside files. */
  size: number
  excerpt: string
  createdAt: string
  updatedAt: string
}

export type Item = FileItem | DocumentItem

export type DocumentDetail = {
  id: string
  folderId: string | null
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

export type FolderListing = { folder: Folder | null; path: Folder[]; folders: Folder[]; items: Item[] }

export type SearchResult = (Item | (Folder & { kind: "folder" })) & { folderName: string | null }

export const sortKeys = ["name", "date", "size"] as const
export type SortKey = (typeof sortKeys)[number]
export type SortDir = "asc" | "desc"

/** Folders stay on top by name; items follow the chosen order (name ties break the rest). */
export function sortItems<T extends Pick<Item, "name" | "size" | "createdAt">>(items: T[], key: SortKey, dir: SortDir) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
  const sign = dir === "asc" ? 1 : -1
  return [...items].sort((a, b) => {
    const byName = collator.compare(a.name, b.name)
    if (key === "name") return sign * byName
    const diff = key === "size" ? a.size - b.size : Date.parse(a.createdAt) - Date.parse(b.createdAt)
    return diff === 0 ? byName : sign * diff
  })
}

/** Default direction per column: names A→Z, newest and largest first. */
export function defaultDir(key: SortKey): SortDir {
  return key === "name" ? "asc" : "desc"
}
