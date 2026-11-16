import type { SortDir, SortKey } from "../schema"

type Linkable = { kind: "folder" | "file" | "document"; id: string }

export function folderHref(folderId: string | null, extra?: { sort?: SortKey; dir?: SortDir }) {
  const params = new URLSearchParams()
  if (folderId) params.set("folder", folderId)
  if (extra?.sort) params.set("sort", extra.sort)
  if (extra?.dir) params.set("dir", extra.dir)
  const qs = params.toString()
  return `/app/files${qs ? `?${qs}` : ""}`
}

export function itemHref(item: Linkable) {
  switch (item.kind) {
    case "folder":
      return folderHref(item.id)
    case "document":
      return `/app/files/doc/${item.id}`
    case "file":
      return `/app/files/file/${item.id}`
  }
}

/** Same-origin route that checks the session and RLS, then redirects to a presigned URL. */
export function rawHref(fileId: string, mode: "inline" | "download") {
  return `/app/files/file/${fileId}/raw${mode === "download" ? "?download=1" : ""}`
}
