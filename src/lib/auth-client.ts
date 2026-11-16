import { passkeyClient } from "@better-auth/passkey/client"
import { createAuthClient } from "better-auth/client"

/**
 * Browser-side Better Auth client, only for flows that must run in the browser:
 * WebAuthn ceremonies (passkeys) and the redirect to Google. Everything else
 * goes through server actions in src/core/auth-actions.ts.
 */
export const authClient = createAuthClient({ plugins: [passkeyClient()] })

/** Whether this browser can use passkeys at all, and whether the device itself can (Touch ID, Windows Hello…). */
export async function passkeySupport(): Promise<{ supported: boolean; platform: boolean; autofill: boolean }> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    return { supported: false, platform: false, autofill: false }
  }
  const [platform, autofill] = await Promise.all([
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false),
    PublicKeyCredential.isConditionalMediationAvailable?.().catch(() => false) ?? Promise.resolve(false),
  ])
  return { supported: true, platform, autofill }
}
