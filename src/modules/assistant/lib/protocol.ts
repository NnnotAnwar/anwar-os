// What the chat page and POST /api/assistant/chat say to each other. Client-safe.
//
// Request (JSON): { conversationId?, text?, image?, decisions? }
//   text/image  a new user message (image: base64 JPEG/PNG/WebP/GIF, resized in the browser)
//   decisions   answers to the confirm cards: { [toolUseId]: "approve" | "reject" }
// Response: text/event-stream, one `data: <ChatEvent JSON>` per event.

export type ToolChipStatus = "done" | "error" | "declined" | "pending" | "approved"

export type ToolChip = {
  id: string
  /** The tool's API name, e.g. tasks_search. */
  name: string
  /** "Searched tasks", "Created task". */
  label: string
  /** "3 found", "Buy milk", an error message. */
  summary: string | null
  status: ToolChipStatus
}

export type ConfirmCard = {
  id: string
  name: string
  /** "Create task", "Delete note". */
  title: string
  details: { label: string; value: string }[]
  destructive: boolean
}

export type ChatEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "text"; delta: string }
  | { type: "tool"; chip: ToolChip }
  | { type: "confirm"; cards: ConfirmCard[] }
  | { type: "notice"; tone: "info" | "error"; text: string }
  | { type: "done" }

/** A conversation as the page renders it. */
export type UiItem =
  | { type: "user"; id: string; text: string; image: string | null }
  | { type: "assistant"; id: string; text: string; interrupted?: boolean }
  | { type: "tools"; id: string; chips: ToolChip[] }
  | { type: "notice"; id: string; tone: "info" | "error"; text: string }

export type ConversationSummary = { id: string; title: string; updatedAt: string }

export const MAX_MESSAGE_CHARS = 8000
/** base64 characters of one attached image (≈ 3 MB of JPEG). */
export const MAX_IMAGE_BASE64 = 4_000_000
