"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { FolderPlus, Loader2Icon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { saveReportToFiles } from "../server-actions"

/** Saves the month's PDF into Files → Reports, with a toast that opens it. */
export function SavePdfButton({ month }: { month: string }) {
  const [pending, start] = useTransition()
  const router = useRouter()

  function save() {
    start(async () => {
      const result = await saveReportToFiles({ month })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const { saved, url, name } = result.value
      if (!saved) {
        toast.info("File storage isn't set up, so here's the PDF to download instead.", {
          action: { label: "Download", onClick: () => window.location.assign(url) },
        })
        return
      }
      toast.success(`Saved to Files → Reports as “${name}”`, {
        action: { label: "Open", onClick: () => router.push(new URL(url, window.location.href).pathname as never) },
      })
    })
  }

  return (
    <Button variant="outline" size="lg" onClick={save} disabled={pending} className="pointer-coarse:h-11">
      {pending ? <Loader2Icon className="animate-spin" /> : <FolderPlus />}
      Save to Files
    </Button>
  )
}
