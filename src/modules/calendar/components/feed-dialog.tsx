"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Copy, Refresh, Rss } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { FeedInfo } from "../schema"
import { disableFeed, rotateFeed } from "../server-actions"

/** Subscribe settings: the private ICS URL, copy, replace (rotate) and turn off. */
export function FeedDialog({ initial }: { initial: FeedInfo }) {
  const [feed, setFeed] = useState<FeedInfo>(initial)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [pending, start] = useTransition()

  function rotate() {
    start(async () => {
      const result = await rotateFeed()
      if (!result.ok) return void toast.error(result.error)
      const replaced = feed !== null
      setFeed(result.value)
      setConfirmRotate(false)
      toast.success(replaced ? "New address ready — the old one stopped working" : "Feed address created")
    })
  }

  function turnOff() {
    start(async () => {
      const result = await disableFeed()
      if (!result.ok) return void toast.error(result.error)
      setFeed(null)
      toast.success("Feed turned off")
    })
  }

  async function copy() {
    if (!feed) return
    try {
      await navigator.clipboard.writeText(feed.url)
      toast.success("Address copied")
    } catch {
      toast.error("Couldn't copy — select the address and copy it by hand.")
    }
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="lg" />}>
        <Rss />
        <span className="max-sm:sr-only">Subscribe</span>
      </DialogTrigger>
      <DialogContent className="glass glass-menu sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-card-title">Subscribe in another calendar</DialogTitle>
          <DialogDescription>
            A private address for Apple Calendar, Google Calendar or Outlook. Anyone with it can read your events, so keep it to
            yourself.
          </DialogDescription>
        </DialogHeader>
        {feed ? (
          <div className="grid gap-3">
            <div className="flex gap-2">
              <Input readOnly value={feed.url} aria-label="Feed address" onFocus={(e) => e.currentTarget.select()} className="text-caption font-mono" />
              <Button type="button" variant="outline" onClick={copy} aria-label="Copy address">
                <Copy />
              </Button>
            </div>
            {confirmRotate ? (
              <div className="grid gap-2 rounded-xl bg-warning-surface p-3">
                <p className="text-meta text-warning-text">
                  Calendars using the current address stop updating until you give them the new one.
                </p>
                <div className="flex gap-2">
                  <Button type="button" onClick={rotate} disabled={pending}>
                    Replace address
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setConfirmRotate(false)}>
                    Keep it
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setConfirmRotate(true)}>
                  <Refresh />
                  New address
                </Button>
                <Button type="button" variant="ghost" onClick={turnOff} disabled={pending} className="text-destructive">
                  Turn off
                </Button>
              </div>
            )}
          </div>
        ) : (
          <Button type="button" onClick={rotate} disabled={pending} className="justify-self-start">
            <Rss />
            Create feed address
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
