import { markdownToText } from "./markdown"

/** Minutes to read a markdown body at about 220 words a minute; 0 for an empty body, never "0 min" otherwise. */
export function readingMinutes(source: string) {
  const words = markdownToText(source).split(/\s+/).filter(Boolean).length
  return words === 0 ? 0 : Math.max(1, Math.round(words / 220))
}
