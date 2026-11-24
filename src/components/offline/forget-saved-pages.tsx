"use client"

import { useEffect } from "react"
import { forgetCachedPages } from "@/lib/offline/client"

/**
 * On the sign-in page, signed out: the app pages the service worker saved for
 * offline use show the last account's data, so they go. (Sign-out from the app
 * already deletes them; this covers an expired session or a sign-out elsewhere.)
 * The outbox stays: signing back in as the same user sends it.
 */
export function ForgetSavedPages() {
  useEffect(() => {
    void forgetCachedPages()
  }, [])
  return null
}
