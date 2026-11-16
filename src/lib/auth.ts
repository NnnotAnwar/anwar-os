import "server-only"
import { db } from "@/db"
import { createAuth, isGoogleConfigured, readAuthEnv } from "@/lib/auth-config"

const env = readAuthEnv()

export const auth = createAuth(db, env)

/** Whether "Continue with Google" / "Connect Google" should be shown at all. */
export const googleSignInEnabled = isGoogleConfigured(env)
