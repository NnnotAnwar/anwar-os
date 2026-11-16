// Object keys and download headers. Keys never contain the file name: the name
// lives in the database row and is applied with Content-Disposition on download.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** `<owner_id>/<uuid>` — the owner prefix is also enforced by a CHECK constraint. */
export function buildStorageKey(ownerId: string, objectId: string) {
  if (!ownerId || /[/\\]/.test(ownerId)) throw new Error("Invalid owner id for a storage key")
  if (!UUID.test(objectId)) throw new Error("Invalid object id for a storage key")
  return `${ownerId}/${objectId}`
}

/** True only for a key this owner could have been issued. */
export function isOwnedKey(ownerId: string, key: string) {
  const prefix = `${ownerId}/`
  return key.startsWith(prefix) && UUID.test(key.slice(prefix.length))
}

/**
 * RFC 6266 Content-Disposition with an ASCII fallback and the UTF-8 name in
 * filename*, so "Daňové přiznání.pdf" downloads with its real name.
 */
export function contentDisposition(name: string, disposition: "inline" | "attachment") {
  const ascii = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
