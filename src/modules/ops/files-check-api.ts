import "server-only"
import { osbotRoute, parseInput } from "@/modules/osbot/api"
import { runFilesCheck, runFilesCheckInput } from "./files-check"

// /api/internal/osbot/files-check/run: osbot's weekly files storage check
// (bots/osbot/osbot/files_check.py, Mondays from 04:00). Same signed,
// owner-only wrapper as the rest of osbot's API. The bot sends
// { maxAgeHours }, so its retries and restarts don't list the bucket again;
// problems reach Telegram through the 5-minute ops alert check (kind "files").

/** POST files-check/run { maxAgeHours? } → { ok, ran, check } or { ok: false, error }. */
export const filesCheckRunPOST = osbotRoute(async ({ body }) => runFilesCheck(parseInput(runFilesCheckInput, body ?? {})))
