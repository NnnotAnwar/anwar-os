// Images sent to Claude (receipt photos, chat attachments): base64 from the
// browser or a bot, checked by their first bytes, never trusted by a claimed
// type. Pure (Node Buffer only), unit-tested in image-data.test.ts.

export const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number]

/** The Claude API takes images up to 5 MB each. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export class ImageDataError extends Error {}

/** The image type from its first bytes. */
export function sniffImage(b: Uint8Array): ImageMediaType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg"
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png"
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif"
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp"
  }
  return null
}

export type ImageData = { data: string; mediaType: ImageMediaType; bytes: number }

/** base64 (optionally a data: URL) → a checked image. Throws ImageDataError with a message for the user. */
export function decodeImage(input: string, maxBytes = MAX_IMAGE_BYTES): ImageData {
  const base64 = input.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "")
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new ImageDataError("That isn't an image.")
  const bytes = Buffer.from(base64, "base64")
  if (bytes.length > maxBytes) throw new ImageDataError(`That photo is too large (over ${Math.floor(maxBytes / 1024 / 1024)} MB).`)
  const mediaType = sniffImage(bytes)
  if (!mediaType) throw new ImageDataError("Send a JPEG, PNG, WebP or GIF photo.")
  return { data: bytes.toString("base64"), mediaType, bytes: bytes.length }
}
