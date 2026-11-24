"use client"

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react"
import { toast } from "sonner"
import { Camera, Loader2Icon, WarningCircle } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { resizeImage } from "@/lib/image-resize"
import { cn } from "@/lib/utils"
import { formatDay } from "../lib/dates"
import { amountToInput, formatMoney, parseAmount } from "../lib/money"
import type { ReceiptDraft } from "../receipts/service"
import { scanReceiptPhoto } from "../receipts/server-actions"
import { createTransaction, deleteTransactions } from "../server-actions"
import { Field, FormError, Sheet, selectClass } from "./bits"
import { categoryGroups, type AccountOption, type CategoryOption } from "./types"

// Quick add → camera: photo of a receipt → Claude reads total, merchant, date
// and a category on the server → the owner checks it in a sheet → saved as a
// normal expense. The photo is resized here and never stored.

export function ReceiptScanButton({ accounts, locale, className }: { accounts: AccountOption[]; locale: string; className?: string }) {
  const file = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const [draft, setDraft] = useState<{ draft: ReceiptDraft; categories: CategoryOption[] } | null>(null)

  async function onFile(picked: File | undefined) {
    if (!picked) return
    setScanning(true)
    const id = toast.loading("Reading the receipt…")
    try {
      const image = await resizeImage(picked)
      const result = await scanReceiptPhoto({ image: image.base64 })
      if (!result.ok) {
        toast.error(result.error, { id })
        return
      }
      toast.dismiss(id)
      setDraft({ draft: result.draft, categories: result.categories })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That photo couldn't be read.", { id })
    } finally {
      setScanning(false)
      if (file.current) file.current.value = ""
    }
  }

  return (
    <>
      <input
        ref={file}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={scanning || accounts.length === 0}
        onClick={() => file.current?.click()}
        aria-label="Scan a receipt"
        title="Scan a receipt"
        className={cn("h-10 w-10 shrink-0 px-0 md:h-9 md:w-auto md:px-2.5", className)}
      >
        {scanning ? <Loader2Icon className="animate-spin" /> : <Camera />}
        <span className="hidden md:inline">Receipt</span>
      </Button>
      <Sheet
        open={draft !== null}
        onOpenChange={(open) => !open && setDraft(null)}
        title="Check the receipt"
        description="Claude read this from the photo. Fix anything that's off, then save."
      >
        {draft && (
          <ReceiptForm
            key={`${draft.draft.amountMinor}-${draft.draft.occurredOn}-${draft.draft.note}`}
            draft={draft.draft}
            categories={draft.categories}
            accounts={accounts}
            locale={locale}
            onDone={() => setDraft(null)}
          />
        )}
      </Sheet>
    </>
  )
}

function ReceiptForm({
  draft,
  categories,
  accounts,
  locale,
  onDone,
}: {
  draft: ReceiptDraft
  categories: CategoryOption[]
  accounts: AccountOption[]
  locale: string
  onDone: () => void
}) {
  const [amount, setAmount] = useState(amountToInput(draft.amountMinor))
  const [accountId, setAccountId] = useState(draft.accountId ?? accounts[0]?.id ?? "")
  const [categoryId, setCategoryId] = useState(draft.categoryId ?? "")
  const [occurredOn, setOccurredOn] = useState(draft.occurredOn)
  const [note, setNote] = useState(draft.note)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const groups = categoryGroups(categories)
  const currency = accounts.find((a) => a.id === accountId)?.currency ?? draft.accountCurrency ?? draft.currency
  const mismatch = currency !== draft.currency

  function submit(e: FormEvent) {
    e.preventDefault()
    // The sheet is portalled, but React events still bubble to the quick-add form around it.
    e.stopPropagation()
    const parsed = parseAmount(amount)
    if (!parsed || parsed.minor <= 0) {
      setError("Enter the amount spent, e.g. 312 or 312,50.")
      return
    }
    start(async () => {
      const result = await createTransaction({
        accountId,
        categoryId: categoryId || null,
        amountMinor: -parsed.minor,
        occurredOn,
        note: note.trim(),
        tags: [],
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      const id = result.value.id
      const what = [categories.find((c) => c.id === categoryId)?.name ?? "Uncategorised", note.trim()].filter(Boolean).join(" · ")
      toast.success(`${formatMoney(-parsed.minor, currency, locale, { signed: true })} ${what}`, {
        description: formatDay(occurredOn, locale),
        action: { label: "Undo", onClick: () => void deleteTransactions({ ids: [id] }) },
      })
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {draft.summary && <p className="text-meta text-muted-foreground">{draft.summary}</p>}
      {(mismatch || draft.dateAssumed) && (
        <ul className="grid gap-1.5">
          {mismatch && (
            <Warning>
              The receipt is in {draft.currency}; this account is in {currency}. Convert the amount or pick a {draft.currency} account.
            </Warning>
          )}
          {draft.dateAssumed && <Warning>No date on the receipt, so it&apos;s set to today.</Warning>}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Amount (${currency})`} htmlFor="rc-amount">
          <Input
            id="rc-amount"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setError(null)
            }}
            inputMode="decimal"
            autoComplete="off"
            required
            className="h-10 text-base tabular-nums md:h-9 md:text-sm"
          />
        </Field>
        <Field label="Date" htmlFor="rc-date">
          <Input id="rc-date" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} required className="h-10 md:h-9 dark:[color-scheme:dark]" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category" htmlFor="rc-category">
          <select id="rc-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={cn(selectClass, "h-10 md:h-9")}>
            <option value="">Uncategorised</option>
            {groups.expense.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Account" htmlFor="rc-account">
          <select id="rc-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={cn(selectClass, "h-10 md:h-9")} required>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Note" htmlFor="rc-note">
        <Input id="rc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Albert" autoComplete="off" className="h-10 text-base md:h-9 md:text-sm" />
      </Field>
      <FormError>{error}</FormError>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="lg" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="lg" disabled={pending}>
          Save expense
        </Button>
      </div>
    </form>
  )
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <li className="text-caption flex items-start gap-1.5 text-muted-foreground">
      <WarningCircle className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span>{children}</span>
    </li>
  )
}
