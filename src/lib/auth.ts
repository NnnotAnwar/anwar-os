import "server-only"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { nextCookies } from "better-auth/next-js"
import { twoFactor } from "better-auth/plugins"
import { db } from "@/db"
import { account, session, twoFactor as twoFactorTable, user, verification } from "@/db/schema"

export const auth = betterAuth({
  appName: "anwar.os",
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification, twoFactor: twoFactorTable },
  }),
  emailAndPassword: {
    enabled: true,
    // The owner is created by scripts/create-owner.mts; os_app can't insert users anyway.
    disableSignUp: true,
    minPasswordLength: 12,
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
  },
  // nextCookies must be last: it applies Set-Cookie from server actions.
  plugins: [twoFactor({ issuer: "anwar.os" }), nextCookies()],
})
