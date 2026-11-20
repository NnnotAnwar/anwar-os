"use client"

import { DownloadLine } from "@/components/icons"
import { Button } from "@/components/ui/button"

/**
 * "Download PDF": opens the print dialog, where every browser offers Save as
 * PDF. print.css turns the page into a plain A4 résumé (no chrome, black on
 * white, no dark theme), so there is no separate PDF to keep in sync.
 */
export function PrintButton() {
  return (
    <div className="grid justify-items-end gap-1 print:hidden">
      <Button size="lg" onClick={() => window.print()} className="max-sm:h-11">
        <DownloadLine />
        Download PDF
      </Button>
      <p className="text-caption text-muted-foreground">Choose “Save as PDF” in the dialog</p>
    </div>
  )
}
