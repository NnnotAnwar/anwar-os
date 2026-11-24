// Browser-side: shrink a photo before it is sent to the server for Claude.
// Claude reads images up to ~1568 px on the long side; anything larger is only
// downscaled by the API anyway, so sending less saves upload time on a phone
// and keeps the request under the 1 MB server-action limit. EXIF orientation
// is applied, metadata (location!) is dropped by re-encoding.

export type ResizedImage = {
  /** data:image/jpeg;base64,… for previews. */
  dataUrl: string
  /** The base64 payload alone. */
  base64: string
  mediaType: "image/jpeg"
  width: number
  height: number
}

export async function resizeImage(file: Blob, { maxSide = 1568, maxBytes = 700_000 } = {}): Promise<ResizedImage> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo.")
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("That photo couldn't be opened. Try a JPEG or PNG.")
  })
  try {
    let side = maxSide
    for (let attempt = 0; attempt < 5; attempt++) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
      const width = Math.max(1, Math.round(bitmap.width * scale))
      const height = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("This browser can't prepare photos.")
      ctx.fillStyle = "#fff" // transparent PNGs become white, not black
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(bitmap, 0, 0, width, height)
      const quality = attempt === 0 ? 0.85 : 0.72
      const dataUrl = canvas.toDataURL("image/jpeg", quality)
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1)
      if (base64.length <= maxBytes || attempt === 4) return { dataUrl, base64, mediaType: "image/jpeg", width, height }
      side = Math.round(side * 0.8)
    }
    throw new Error("unreachable")
  } finally {
    bitmap.close()
  }
}
