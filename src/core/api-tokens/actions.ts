"use server"

import { z } from "zod"
import { ApiTokenError, createApiToken, isSessionFresh, revokeApiToken, type createTokenInput } from "./server"

// Settings → API tokens. Server actions run with the session cookie only (a
// Bearer token never reaches them), and server.ts refuses inside a token
// request anyway.

export type CreatedToken = {
  token: string
  name: string
  prefix: string
  write: boolean
  expiresAt: string | null
}

export type TokenResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string; reauth?: boolean }

export async function createToken(input: z.input<typeof createTokenInput>): Promise<TokenResult<CreatedToken>> {
  if (!(await isSessionFresh())) {
    return { ok: false, reauth: true, error: "For your security, sign in again before creating a token." }
  }
  try {
    const created = await createApiToken(input)
    return {
      ok: true,
      value: {
        token: created.token,
        name: created.name,
        prefix: created.prefix,
        write: created.scopes.includes("write"),
        expiresAt: created.expiresAt,
      },
    }
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "Check the name and try again." }
    if (error instanceof ApiTokenError) return { ok: false, error: error.message }
    console.error("create api token failed", error)
    return { ok: false, error: "Couldn't create the token. Try again." }
  }
}

export async function revokeToken(id: string): Promise<TokenResult> {
  try {
    await revokeApiToken(id)
    return { ok: true, value: undefined }
  } catch (error) {
    if (error instanceof ApiTokenError) return { ok: false, error: error.message }
    console.error("revoke api token failed", error)
    return { ok: false, error: "Couldn't revoke the token. Try again." }
  }
}
