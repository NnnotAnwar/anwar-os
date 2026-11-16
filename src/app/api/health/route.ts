import { sql } from "drizzle-orm"
import { connection } from "next/server"
import { db } from "@/db"

// Probe for the container HEALTHCHECK, `docker compose up --wait` (the deploy
// gate) and external uptime monitors. 200 `{ ok: true }` when Postgres answers,
// 503 `{ ok: false }` otherwise. Public on purpose: it reveals nothing else.
const DB_TIMEOUT_MS = 3000

async function databaseAnswers(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("database timeout")), DB_TIMEOUT_MS)
  })
  try {
    // Runs as os_app outside withViewer(): touches no table, so RLS is moot.
    await Promise.race([db.execute(sql`select 1`), timeout])
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function GET() {
  // Never prerender: the answer must come from the running server.
  await connection()

  const ok = await databaseAnswers()
  return Response.json(
    { ok },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  )
}
