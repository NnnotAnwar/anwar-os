// How tool calls look in the chat: small chips ("Searched tasks · 3 found") and
// the confirm cards for writes ("Create task" + its fields). Pure, unit-tested.

const NOUNS: Record<string, [singular: string, plural: string]> = {
  tasks: ["task", "tasks"],
  notes: ["note", "notes"],
  calendar: ["event", "events"],
  budget: ["transaction", "budget"],
  inbox: ["inbox item", "inbox"],
  ideas: ["idea", "ideas"],
  links: ["link", "links"],
  files: ["file", "files"],
  projects: ["project", "projects"],
  feedback: ["feedback", "feedback"],
  cv: ["CV", "CV"],
  bots: ["bot", "bots"],
  ops: ["service", "services"],
  search: ["result", "everything"],
}

const READ_VERBS: [RegExp, string][] = [
  [/^(get|getTransaction|getDocument|getFile|getPlan)$/, "Opened"],
  [/^(overview|counts?|dueCount|silentCount|attentionCount|services|events|dueToday)$/, "Checked"],
  [/^(list|search|view|range|recent|listFolder|allFolders|tags|lists|projects|listAccounts|listCategories|listRecurring|listGoals|listTransactions|everything)/, "Searched"],
]

const WRITE_VERBS: [RegExp, string, string][] = [
  // [action pattern, done label, card title verb]
  [/^quickAdd$/, "Added", "Add"],
  [/^create/, "Created", "Create"],
  [/^capture$/, "Captured", "Capture to inbox"],
  [/^complete$/, "Completed", "Complete"],
  [/^reopen$/, "Reopened", "Reopen"],
  [/^schedule$/, "Rescheduled", "Reschedule"],
  [/^setStatus$/, "Updated", "Change status of"],
  [/^setPinned$/, "Updated", "Pin or unpin"],
  [/^delete/, "Deleted", "Delete"],
  [/^update/, "Updated", "Update"],
]

function noun(module: string, plural: boolean) {
  const n = NOUNS[module] ?? [module, module]
  return plural ? n[1] : n[0]
}

/** "Searched tasks", "Created task", "Opened note". */
export function chipLabel(module: string, action: string, kind: "read" | "write"): string {
  if (kind === "read") {
    const verb = READ_VERBS.find(([re]) => re.test(action))?.[1] ?? "Checked"
    return `${verb} ${noun(module, verb !== "Opened")}`
  }
  const verb = WRITE_VERBS.find(([re]) => re.test(action))?.[1] ?? "Changed"
  return `${verb} ${noun(module, action === "deleteTransactions")}`
}

/** "Create task", "Delete note", "Add transaction". */
export function cardTitle(module: string, action: string): string {
  const verb = WRITE_VERBS.find(([re]) => re.test(action))?.[2] ?? "Change"
  if (module === "inbox" && action === "capture") return verb
  return `${verb} ${noun(module, action === "deleteTransactions")}`
}

function countOf(result: unknown): number | null {
  if (Array.isArray(result)) return result.length
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>
    for (const key of ["items", "tasks", "events", "transactions", "notes", "hits", "results", "files", "rows"]) {
      if (Array.isArray(r[key])) return (r[key] as unknown[]).length
    }
  }
  return null
}

function titleOf(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null
  const r = result as Record<string, unknown>
  for (const key of ["title", "name", "note", "text"]) {
    if (typeof r[key] === "string" && (r[key] as string).trim()) return truncate((r[key] as string).trim(), 48)
  }
  return null
}

/** The chip's second half: "3 found", "none found", or the item's title. */
export function chipSummary(kind: "read" | "write", result: unknown): string | null {
  if (kind === "read") {
    const n = countOf(result)
    if (n !== null) return n === 0 ? "none found" : `${n} found`
    if (result === null) return "not found"
    return titleOf(result)
  }
  return titleOf(result)
}

export function truncate(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

const LABELS: Record<string, string> = {
  dueDate: "Due",
  dueTime: "Time",
  startDate: "Starts",
  startTime: "Time",
  endDate: "Ends",
  endTime: "Ends at",
  occurredOn: "Date",
  amountMinor: "Amount",
  listName: "List",
  categoryId: "Category",
  accountId: "Account",
  rrule: "Repeats",
  allDay: "All day",
  text: "Text",
  body: "Body",
  url: "Link",
}

function humanize(key: string) {
  if (LABELS[key]) return LABELS[key]
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function show(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") {
    if (key.endsWith("Minor")) return (value / 100).toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    return String(value)
  }
  if (typeof value === "string") return truncate(value.replace(/\s+/g, " ").trim(), 160)
  if (Array.isArray(value)) {
    const parts = value.map((v) => (typeof v === "object" ? null : String(v))).filter(Boolean)
    return parts.length ? truncate(parts.join(", "), 160) : null
  }
  return null
}

/** The card's field list: every plain field of the input except ids (those are resolved separately). */
export function cardDetails(input: unknown): { label: string; value: string }[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return []
  const out: { label: string; value: string }[] = []
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key === "id" || key === "ids" || key === "categoryId" || key === "accountId" || key === "listId" || key === "projectId") continue
    const shown = show(key, value)
    if (shown) out.push({ label: humanize(key), value: shown })
  }
  return out.slice(0, 8)
}
