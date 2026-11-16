/** "React, next.js ,  react" → ["React", "next.js"]: trimmed, de-duplicated case-insensitively. */
export function parseTags(input: string, { max = 20, maxLength = 40 } = {}): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of input.split(",")) {
    const tag = raw.trim().replace(/\s+/g, " ").slice(0, maxLength)
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length === max) break
  }
  return tags
}

export function formatTags(tags: readonly string[]) {
  return tags.join(", ")
}

/** URL-safe slug from any title, Czech and Kazakh/Russian letters included. */
export function slugify(input: string, maxLength = 80): string {
  const cyrillic: Record<string, string> = {
    а: "a", ә: "a", б: "b", в: "v", г: "g", ғ: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i",
    і: "i", к: "k", қ: "q", л: "l", м: "m", н: "n", ң: "n", о: "o", ө: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ұ: "u", ү: "u", ф: "f", х: "h", һ: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
    э: "e", ю: "yu", я: "ya",
  }
  return input
    .toLowerCase()
    .replace(/[Ѐ-ӿ]/g, (ch) => cyrillic[ch] ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "")
}
