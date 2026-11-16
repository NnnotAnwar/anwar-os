"use client"

import { RotateCcw } from "@/components/icons"
import { Button } from "@/components/ui/button"

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto grid w-full max-w-xl justify-items-start gap-4 py-12">
      <p className="font-mono text-xs tracking-wider text-destructive uppercase">Couldn’t load this page</p>
      <h1 className="font-display text-2xl font-semibold tracking-tight">The server didn’t answer as expected</h1>
      <p className="text-muted-foreground">
        Your data is safe. This is usually a dropped connection or the database restarting. Try again; if it
        keeps happening, check that Supabase is running.
      </p>
      <Button onClick={reset}>
        <RotateCcw />
        Try again
      </Button>
      {error.digest && <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
    </div>
  )
}
