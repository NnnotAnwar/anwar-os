// Upload rules shared by the browser (early feedback) and the server (the real
// check). Pure: no Node or browser APIs.

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

/** Extension → MIME for everything the knowledge base accepts. */
const TYPES: Record<string, string> = {
  // Documents
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  rtf: "application/rtf",
  epub: "application/epub+zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  pages: "application/vnd.apple.pages",
  numbers: "application/vnd.apple.numbers",
  key: "application/vnd.apple.keynote",
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  svg: "image/svg+xml",
  // Archives
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  tar: "application/x-tar",
  gz: "application/gzip",
  tgz: "application/gzip",
}

const ALLOWED = new Set(Object.values(TYPES))
// Browsers report a few of these under older names.
const ALIASES: Record<string, string> = {
  "application/x-zip-compressed": "application/zip",
  "application/x-rar-compressed": "application/vnd.rar",
  "application/x-gzip": "application/gzip",
  "text/x-markdown": "text/markdown",
}

export function extensionOf(name: string) {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

/**
 * The MIME type to store, or null when the file isn't accepted. The browser's
 * type wins when it is on the allowlist; an empty or generic type falls back to
 * the extension (Safari reports .md as "", many tools send octet-stream).
 */
export function resolveMime(name: string, reported: string): string | null {
  const type = (ALIASES[reported.toLowerCase()] ?? reported.toLowerCase()).split(";")[0]!.trim()
  if (ALLOWED.has(type)) return type
  if (type && type !== "application/octet-stream") return null
  return TYPES[extensionOf(name)] ?? null
}

export function isAllowedMime(mime: string) {
  return ALLOWED.has(mime)
}

/** For the file picker's accept attribute. */
export const ACCEPT = [...Object.keys(TYPES).map((ext) => `.${ext}`), ...ALLOWED].join(",")

/** Strips paths and control characters; never returns an empty name. */
export function cleanFileName(name: string, fallback = "Untitled") {
  const base = name.split(/[/\\]/).pop() ?? ""
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim()
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback
  if (cleaned.length <= 255) return cleaned
  const ext = extensionOf(cleaned)
  return ext && ext.length < 20 ? `${cleaned.slice(0, 254 - ext.length)}.${ext}` : cleaned.slice(0, 255)
}

export type UploadCheck = { ok: true; mime: string } | { ok: false; error: string }

export function checkUpload(file: { name: string; size: number; type: string }): UploadCheck {
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: `${file.name} is over 100 MB — split or compress it first.` }
  const mime = resolveMime(file.name, file.type)
  if (!mime) return { ok: false, error: `${file.name} isn't a type the knowledge base keeps (documents, images, archives).` }
  return { ok: true, mime }
}

/** Tags: trimmed, lower-case, no commas, unique, at most 20 of 40 chars each. */
export function normalizeTags(input: string | string[]) {
  const raw = Array.isArray(input) ? input : input.split(",")
  const tags = raw
    .map((t) => t.replace(/,/g, " ").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 40))
    .filter(Boolean)
  return [...new Set(tags)].slice(0, 20)
}

export type PreviewKind = "image" | "pdf" | null

/** What the browser may show inline. SVG is excluded (it can carry script). */
export function previewKind(mime: string): PreviewKind {
  if (mime === "application/pdf") return "pdf"
  if (["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(mime)) return "image"
  return null
}

/** "1.4 MB", "820 KB", "12 B" — binary units, one decimal from MB up. */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
