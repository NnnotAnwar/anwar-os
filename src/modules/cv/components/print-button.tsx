"use client"

import { Printer } from "@/components/icons"
import { Button } from "@/components/ui/button"

/** Opens the browser's print dialog; "Save as PDF" there gives the PDF résumé. */
export function PrintButton() {
  return (
    <Button variant="outline" size="lg" onClick={() => window.print()} className="print:hidden">
      <Printer />
      Save as PDF
    </Button>
  )
}
