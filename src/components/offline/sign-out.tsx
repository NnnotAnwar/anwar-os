"use client"

import { useEffect, useState, useTransition } from "react"
import { unstable_rethrow } from "next/navigation"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogConfirm,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { signOut } from "@/core/auth-actions"
import { clearOfflineData, getOutboxState, itemsFor } from "@/lib/offline/client"

const SIGN_OUT_EVENT = "anwar:sign-out-unsynced"

async function signOutNow() {
  if (!navigator.onLine) {
    toast.error("You're offline. Sign out once you're back online.")
    return
  }
  // The saved pages and the outbox hold this account's data: they leave with it.
  await clearOfflineData()
  try {
    await signOut()
  } catch (error) {
    // The redirect to /login travels as an error: let the router have it.
    unstable_rethrow(error)
    toast.error("Couldn't sign out. Check your connection and try again.")
  }
}

/**
 * Signs out, but first asks when captures made offline haven't reached the
 * server yet: signing out deletes them from this device.
 */
export async function signOutSafely() {
  const unsynced = itemsFor(getOutboxState()).length
  if (unsynced > 0) {
    window.dispatchEvent(new CustomEvent(SIGN_OUT_EVENT, { detail: unsynced }))
    return
  }
  await signOutNow()
}

/** The "not synced yet" question, mounted once in the shell (OfflineSync). */
export function SignOutGuard() {
  const [count, setCount] = useState(0)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    const onAsk = (event: Event) => setCount((event as CustomEvent<number>).detail)
    window.addEventListener(SIGN_OUT_EVENT, onAsk)
    return () => window.removeEventListener(SIGN_OUT_EVENT, onAsk)
  }, [])

  return (
    <AlertDialog open={count > 0} onOpenChange={(open) => !open && setCount(0)} busy={pending}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{count === 1 ? "1 capture hasn't synced" : `${count} captures haven't synced`}</AlertDialogTitle>
          <AlertDialogDescription>
            They&apos;re only on this device. Signing out deletes them. Stay signed in and they sync as soon as you&apos;re online.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay signed in</AlertDialogCancel>
          <AlertDialogConfirm
            busyLabel="Signing out…"
            onClick={() =>
              startTransition(async () => {
                await signOutNow()
                setCount(0)
              })
            }
          >
            Sign out and delete
          </AlertDialogConfirm>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
