"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Sheet } from "@/components/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { Bot } from "../schema"
import { createBot, updateBot } from "../server-actions"

/** Add or edit a bot in the registry. `bot` null = closed, "new" = add. */
export function BotFormSheet({ bot, onOpenChange }: { bot: Bot | "new" | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet
      open={bot !== null}
      onOpenChange={onOpenChange}
      title={bot === "new" ? "Add a bot" : "Edit bot"}
      description="Stats come from the bot's own schema (its stats views) or, for osbot, from its heartbeat."
    >
      {bot !== null && <BotForm key={bot === "new" ? "new" : bot.id} bot={bot === "new" ? null : bot} onDone={() => onOpenChange(false)} />}
    </Sheet>
  )
}

function BotForm({ bot, onDone }: { bot: Bot | null; onDone: () => void }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit(form: FormData) {
    const input = {
      name: String(form.get("name") ?? ""),
      telegramUsername: String(form.get("telegramUsername") ?? ""),
      serviceName: String(form.get("serviceName") ?? ""),
      statsSource: String(form.get("statsSource") ?? ""),
      description: String(form.get("description") ?? ""),
    }
    start(async () => {
      const res = bot ? await updateBot({ id: bot.id, ...input }) : await createBot(input)
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.success(bot ? "Bot saved" : `${input.name.trim()} added`)
      onDone()
    })
  }

  return (
    <form action={submit} className="grid gap-3 p-4">
      <Field label="Name" htmlFor="bot-name">
        <Input id="bot-name" name="name" defaultValue={bot?.name ?? ""} required maxLength={60} autoFocus={!bot} />
      </Field>
      <Field label="Telegram username" htmlFor="bot-username" hint="Without the @. Links the card to t.me.">
        <Input
          id="bot-username"
          name="telegramUsername"
          defaultValue={bot?.telegramUsername ?? ""}
          placeholder="expenses_bot"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>
      <Field label="Service" htmlFor="bot-service" hint="The compose service in Ops, e.g. bot-expenses.">
        <Input
          id="bot-service"
          name="serviceName"
          defaultValue={bot?.serviceName ?? ""}
          placeholder="bot-expenses"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>
      <Field label="Stats from" htmlFor="bot-stats" hint="The bot's schema (bot_expenses), osbot, or empty for none.">
        <Input
          id="bot-stats"
          name="statsSource"
          defaultValue={bot?.statsSource ?? ""}
          placeholder="bot_expenses"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>
      <Field label="Description" htmlFor="bot-description">
        <Textarea id="bot-description" name="description" defaultValue={bot?.description ?? ""} maxLength={300} rows={2} />
      </Field>
      {error && (
        <p role="alert" className="text-meta text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {bot ? "Save" : "Add bot"}
      </Button>
    </form>
  )
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-caption text-muted-foreground">{hint}</p>}
    </div>
  )
}
