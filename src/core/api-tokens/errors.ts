import "server-only"
import { z } from "zod"
import { InternalApiError } from "@/core/internal-api"
import { BudgetInputError } from "@/modules/budget/schema"
import { EventInputError } from "@/modules/calendar/schema"
import { FilesError } from "@/modules/files/actions"
import { StorageNotConfiguredError } from "@/modules/files/lib/s3"
import { InboxInputError } from "@/modules/inbox/actions"
import { BlockedUrlError } from "@/modules/links/url-guard"
import { CaptureError } from "@/modules/osbot/capture"
import { SlugTakenError } from "@/modules/projects/actions"
import { TaskInputError } from "@/modules/tasks/actions"

// Errors a module action throws on purpose, with a message meant for the
// person (or model) that sent the input. Anything else is a bug or an outage:
// logged, and answered with a generic message.

const PUBLIC_ERRORS = [
  BudgetInputError,
  BlockedUrlError,
  CaptureError,
  EventInputError,
  FilesError,
  InboxInputError,
  InternalApiError,
  SlugTakenError,
  StorageNotConfiguredError,
  TaskInputError,
]

/** Postgres: "cannot execute … in a read-only transaction". */
const READ_ONLY_TRANSACTION = "25006"

/** The message to show for an expected error, or null for anything else. */
export function publicErrorMessage(error: unknown): string | null {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0]
    return issue ? (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message) : "Invalid input."
  }
  if (PUBLIC_ERRORS.some((type) => error instanceof type)) return (error as Error).message
  if ((error as { code?: string } | null)?.code === READ_ONLY_TRANSACTION) return "This token is read-only."
  return null
}
