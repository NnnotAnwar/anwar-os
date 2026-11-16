import { getAuthenticatorName, passkey } from "@better-auth/passkey"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api"
import { deleteSessionCookie } from "better-auth/cookies"
import { generateRandomString } from "better-auth/crypto"
import { nextCookies } from "better-auth/next-js"
import { twoFactor } from "better-auth/plugins"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"
import * as schema from "@/db/schema"
import { safeNext } from "@/lib/safe-next"

/**
 * The Better Auth instance, built from explicit inputs so integration tests can
 * run the real configuration against a test database. The app uses `auth` from
 * `@/lib/auth`.
 *
 * Sign-in methods and how each one is guarded:
 * - email + password: sign-ups disabled; TOTP afterwards when 2FA is on.
 * - Google: only for a Google account the owner linked while signed in (no
 *   implicit linking by email, no sign-up); TOTP afterwards when 2FA is on.
 * - passkey: WebAuthn with user verification required. It is already two
 *   factors (the device + its PIN/biometric), so it skips the TOTP step.
 * Adding a sign-in method (passkey, Google) needs a session younger than
 * FRESH_AGE_SECONDS, otherwise the owner signs in again first.
 */

/** How recent the sign-in must be to add or remove a sign-in method. */
export const FRESH_AGE_SECONDS = 60 * 60

export type AuthEnv = {
  secret?: string
  baseURL?: string
  googleClientId?: string
  googleClientSecret?: string
}

export function readAuthEnv(env: Record<string, string | undefined> = process.env): AuthEnv {
  return {
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    googleClientId: env.GOOGLE_CLIENT_ID || undefined,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || undefined,
  }
}

/** Google buttons are shown only when both credentials are configured. */
export function isGoogleConfigured(env: AuthEnv) {
  return Boolean(env.googleClientId && env.googleClientSecret)
}

// Better Auth's two-factor plugin names (plugins/two-factor/constant).
const TWO_FACTOR_COOKIE = "two_factor"
const TWO_FACTOR_CHALLENGE_SECONDS = 600

/** A readable default label for a new passkey: the provider, else the device. */
export function defaultPasskeyName(aaguid: string | undefined, userAgent: string | null | undefined) {
  const provider = getAuthenticatorName(aaguid)
  if (provider) return provider
  const ua = userAgent ?? ""
  if (/iPhone/.test(ua)) return "iPhone"
  if (/iPad/.test(ua)) return "iPad"
  if (/Android/.test(ua)) return "Android"
  if (/Mac OS X|Macintosh/.test(ua)) return "Mac"
  if (/Windows/.test(ua)) return "Windows"
  if (/Linux/.test(ua)) return "Linux"
  return "Passkey"
}

/** Only paths inside the private zone survive as a post-sign-in target. */
export function privateNext(location: string | null | undefined, baseURL: string) {
  if (!location) return "/app"
  try {
    const url = new URL(location, baseURL)
    if (url.origin !== new URL(baseURL).origin) return "/app"
    return safeNext(url.pathname)
  } catch {
    return "/app"
  }
}

export function createAuth(db: PostgresJsDatabase<typeof schema>, env: AuthEnv) {
  const baseURL = env.baseURL
  const rpID = baseURL ? new URL(baseURL).hostname : "localhost"
  const google = isGoogleConfigured(env)

  return betterAuth({
    appName: "anwar.os",
    secret: env.secret,
    baseURL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        twoFactor: schema.twoFactor,
        passkey: schema.passkey,
      },
    }),
    emailAndPassword: {
      enabled: true,
      // The owner is created by scripts/create-owner.mts; os_app can't insert users anyway.
      disableSignUp: true,
      minPasswordLength: 12,
    },
    socialProviders: google
      ? {
          google: {
            clientId: env.googleClientId!,
            clientSecret: env.googleClientSecret!,
            // Never create a user from a Google sign-in, even if asked to.
            disableSignUp: true,
            disableImplicitSignUp: true,
            prompt: "select_account",
          },
        }
      : {},
    account: {
      // Access/refresh tokens are encrypted at rest; we only need the identity.
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        // A Google sign-in never attaches itself to a user by matching email:
        // the link is made from Settings, while signed in.
        disableImplicitLinking: true,
        // Google is not trusted blindly: its email must be verified to link.
        trustedProviders: [],
        // The owner may link a Google account under another address.
        allowDifferentEmails: true,
      },
    },
    user: {
      additionalFields: {
        // input: false — never settable from a request body.
        role: { type: "string", input: false, defaultValue: "user" },
        timezone: { type: "string", input: false, defaultValue: "Europe/Prague" },
        locale: { type: "string", input: false, defaultValue: "en" },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      freshAge: FRESH_AGE_SECONDS,
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = ctx.body as { idToken?: unknown } | undefined
        // ID-token sign-in (One Tap) would bypass the redirect flow and the 2FA
        // step enforced below; it isn't used here, so it's closed.
        if ((ctx.path === "/sign-in/social" || ctx.path === "/link-social") && body?.idToken) {
          throw new APIError("BAD_REQUEST", { code: "ID_TOKEN_DISABLED", message: "ID token sign-in is disabled." })
        }
        // Linking an account is a sign-in method change: it needs a recent sign-in.
        // (No session at all is left to the endpoint, which answers 401.)
        if (ctx.path === "/link-social") {
          const current = await getSessionFromCtx(ctx)
          const age = current ? Date.now() - new Date(current.session.createdAt).getTime() : 0
          if (age >= FRESH_AGE_SECONDS * 1000) {
            throw new APIError("FORBIDDEN", { code: "SESSION_NOT_FRESH", message: "Sign in again to continue." })
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        // Better Auth's two-factor plugin only guards the password sign-in
        // routes. An OAuth callback that signed someone in (not a link, which
        // creates no session) gets the same treatment: drop the new session and
        // hand out a short-lived 2FA challenge instead.
        if (ctx.path !== "/callback/:id") return
        const created = ctx.context.newSession
        if (!created?.user.twoFactorEnabled) return

        deleteSessionCookie(ctx, true)
        await ctx.context.internalAdapter.deleteSession(created.session.token)
        ctx.context.setNewSession(null)

        const identifier = `2fa-${generateRandomString(20)}`
        const expiresAt = new Date(Date.now() + TWO_FACTOR_CHALLENGE_SECONDS * 1000)
        await ctx.context.internalAdapter.createVerificationValue({
          value: created.user.id,
          identifier,
          expiresAt,
        })
        await ctx.context.internalAdapter.createVerificationValue({
          value: "0",
          identifier: `2fa-attempts-${identifier}`,
          expiresAt,
        })
        const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE, { maxAge: TWO_FACTOR_CHALLENGE_SECONDS })
        await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes)

        // Where the callback meant to send the browser (the sign-in's callbackURL).
        const location = ctx.context.responseHeaders?.get("location")
        const next = privateNext(location, ctx.context.baseURL)
        throw ctx.redirect(`/login/mfa?next=${encodeURIComponent(next)}`)
      }),
    },
    // nextCookies must be last: it applies Set-Cookie from server actions.
    plugins: [
      twoFactor({ issuer: "anwar.os" }),
      passkey({
        rpID,
        rpName: "anwar.os",
        authenticatorSelection: {
          // Discoverable credentials (sign in without typing an email) and a
          // PIN/biometric on every use: that's what makes a passkey two factors.
          residentKey: "required",
          userVerification: "required",
        },
        registration: {
          afterVerification: ({ ctx, verification }) => ({
            name: defaultPasskeyName(verification.registrationInfo?.aaguid, ctx.request?.headers.get("user-agent")),
          }),
        },
      }),
      nextCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
