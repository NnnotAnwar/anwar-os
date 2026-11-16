import type { NextRequest } from "next/server"
import { z } from "zod"
import { getViewer } from "@/core/auth"
import { actions } from "../actions"
import { StorageNotConfiguredError } from "../lib/s3"

/**
 * GET /app/files/file/<id>/raw[?download=1]: checks the session, looks the
 * file up through RLS, then redirects to a presigned URL valid for 60 s.
 * Inline only for images and PDFs; everything else downloads.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/app/files/file/[id]/raw">) {
  const { id } = await ctx.params
  const viewer = await getViewer()
  if (!viewer) return new Response("Sign in to open files.", { status: 401 })
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 })

  try {
    const url = await actions.downloadUrl.handler({ id, inline: request.nextUrl.searchParams.get("download") !== "1" })
    if (!url) return new Response("Not found", { status: 404 })
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
    })
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) return new Response(error.message, { status: 503 })
    throw error
  }
}
