// The card's two sides among a document's attached files (client-safe).
import { isCardPhoto, type AttachedFile, type DocumentSide } from "../schema"

/** The attached photos of the card's front and back. */
export function cardSides(files: AttachedFile[]) {
  return {
    front: files.find((f) => f.side === "front") ?? null,
    back: files.find((f) => f.side === "back") ?? null,
  }
}

/** What the forms send: the ids of the front and back photos (null = none). */
export function sideIds(files: AttachedFile[]) {
  const { front, back } = cardSides(files)
  return { frontFileId: front?.id ?? null, backFileId: back?.id ?? null }
}

/**
 * Adds a file (once). A photo takes the first free side: the first one is
 * the front, the next the back, which is how people photograph a card.
 */
export function attach(files: AttachedFile[], file: AttachedFile): AttachedFile[] {
  if (files.some((f) => f.id === file.id)) return files
  const { front, back } = cardSides(files)
  const side: DocumentSide | null = !isCardPhoto(file.mime) ? null : !front ? "front" : !back ? "back" : null
  return [...files, { ...file, side }]
}

/** Makes `id` the `side` (taking it from whichever file had it), or clears its side (null). */
export function markSide(files: AttachedFile[], id: string, side: DocumentSide | null): AttachedFile[] {
  return files.map((f) => {
    if (f.id === id) return { ...f, side }
    return side && f.side === side ? { ...f, side: null } : f
  })
}
