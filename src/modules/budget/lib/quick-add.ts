// One-line capture: "250 food lunch" → −250 in Food, note "lunch".
//
//   amount      first token that reads as an amount; "+" means money in,
//               "-" money out, a bare number follows the category's kind
//               (expense when there is none)
//   category    the first word (or two) after the amount, matched by name
//               or name prefix, accents and case ignored
//   @account    account by name prefix (default: the one passed in)
//   #tag        tags
//   date        today, yesterday, "16.11.", "16.11.2026" or "2026-11-16"
//   the rest    the note

import { addDaysIso, parseDate } from "./dates"
import { parseAmount } from "./money"

export type QuickCategory = { id: string; name: string; kind: "income" | "expense" }
export type QuickAccount = { id: string; name: string }

/**
 * Where quick add puts a transaction when the text names no account: the
 * caller's choice, else the first CZK account, else the first one.
 */
export function defaultAccountId(accounts: { id: string; currency: string }[], preferred: string | null = null): string | null {
  return preferred ?? accounts.find((x) => x.currency === "CZK")?.id ?? accounts[0]?.id ?? null
}

export type QuickResult =
  | {
      ok: true
      amountMinor: number
      categoryId: string | null
      accountId: string | null
      occurredOn: string
      note: string
      tags: string[]
    }
  | { ok: false; error: string }

/** Lowercase, no accents, no punctuation: "Jídlo & pití" → "jidlo piti". */
export function fold(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

/** Exact name first, then a name that starts with the text (3+ letters), then a word of the name. */
export function matchByName<T extends { name: string }>(items: T[], text: string): T | null {
  const q = fold(text)
  if (!q) return null
  const exact = items.find((i) => fold(i.name) === q)
  if (exact) return exact
  if (q.length < 3) return null
  return (
    items.find((i) => fold(i.name).startsWith(q)) ??
    items.find((i) => fold(i.name).split(" ").some((w) => w.startsWith(q))) ??
    null
  )
}

/** "1 890,50" typed with a space: glue a 1–3 digit token to following 3-digit groups. */
function joinDigitGroups(words: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < words.length; i++) {
    let word = words[i]!
    if (/^[+\-−]?\d{1,3}$/.test(word)) {
      while (i + 1 < words.length && /^\d{3}(?:[.,]\d{1,2})?(?:kč|czk)?$/i.test(words[i + 1]!)) {
        word += ` ${words[++i]}`
        if (/[.,]/.test(word.slice(-3))) break
      }
    }
    out.push(word)
  }
  return out
}

const DATE_WORDS: Record<string, number> = { today: 0, yesterday: -1, dnes: 0, vcera: -1 }

export function parseQuickAdd(
  input: string,
  {
    categories,
    accounts,
    today,
    defaultAccountId = null,
  }: { categories: QuickCategory[]; accounts: QuickAccount[]; today: string; defaultAccountId?: string | null },
): QuickResult {
  const words = joinDigitGroups(input.trim().split(/\s+/).filter(Boolean))
  if (words.length === 0) return { ok: false, error: "Type an amount, e.g. “250 food lunch”." }

  let amount: ReturnType<typeof parseAmount> = null
  let occurredOn = today
  let accountId = defaultAccountId
  const tags: string[] = []
  const rest: string[] = []

  for (const word of words) {
    const folded = fold(word)
    if (word.startsWith("#") && word.length > 1) {
      const tag = word.slice(1).slice(0, 40)
      if (!tags.some((t) => t.toLowerCase() === tag.toLowerCase())) tags.push(tag)
    } else if (word.startsWith("@") && word.length > 1) {
      const account = matchByName(accounts, word.slice(1))
      if (!account) return { ok: false, error: `No account matches “${word.slice(1)}”.` }
      accountId = account.id
    } else if (Object.hasOwn(DATE_WORDS, folded)) {
      occurredOn = addDaysIso(today, DATE_WORDS[folded]!)
    } else if (/^\d{1,2}\.\d{1,2}\.(\d{2}|\d{4})?$|^\d{4}-\d{2}-\d{2}$/.test(word) && parseDate(word, today)) {
      occurredOn = parseDate(word, today)!
    } else if (!amount && parseAmount(word)) {
      amount = parseAmount(word)
    } else {
      rest.push(word)
    }
  }

  if (!amount || amount.minor === 0) return { ok: false, error: "Start with an amount, e.g. “250 food lunch”." }

  // Category: two words first ("eating out"), then one.
  let category: QuickCategory | null = null
  let used = 0
  if (rest.length >= 2) {
    const two = categories.find((c) => fold(c.name) === fold(`${rest[0]} ${rest[1]}`))
    if (two) {
      category = two
      used = 2
    }
  }
  if (!category && rest.length >= 1) {
    category = matchByName(categories, rest[0]!)
    if (category) used = 1
  }

  const sign = amount.sign === "-" ? -1 : amount.sign === "+" ? 1 : category?.kind === "income" ? 1 : -1
  return {
    ok: true,
    amountMinor: sign * amount.minor,
    categoryId: category?.id ?? null,
    accountId,
    occurredOn,
    note: rest.slice(used).join(" ").slice(0, 500),
    tags,
  }
}
