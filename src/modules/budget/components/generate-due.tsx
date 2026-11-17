"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { Repeat } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { generateDue } from "../server-actions"

/** "Generate due": turns every owed recurring payment into transactions, once. */
export function GenerateDueButton({ count, variant = "default" }: { count: number; variant?: "default" | "outline" }) {
  const [pending, start] = useTransition()
  return (
    <Button
      size="lg"
      variant={variant}
      disabled={pending || count === 0}
      onClick={() =>
        start(async () => {
          const result = await generateDue()
          if (!result.ok) {
            toast.error(result.error)
            return
          }
          const n = result.value.created
          toast.success(n === 0 ? "Nothing was due" : `${n} ${n === 1 ? "transaction" : "transactions"} added`)
        })
      }
    >
      <Repeat />
      {pending ? "Generating…" : count > 0 ? `Generate due (${count})` : "Nothing due"}
    </Button>
  )
}
