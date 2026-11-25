"use client"

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowUp,
  Check,
  History,
  ImageSquare,
  Loader2Icon,
  Plus,
  Sparkle,
  StopIcon,
  Trash2,
  WarningCircle,
  X,
} from "@/components/icons"
import { NAV_FORWARD } from "@/components/motion"
import { Sheet } from "@/components/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { resizeImage, type ResizedImage } from "@/lib/image-resize"
import { Markdown } from "@/lib/markdown"
import { cn } from "@/lib/utils"
import { MAX_MESSAGE_CHARS, type ChatEvent, type ConfirmCard, type ConversationSummary, type ToolChip, type UiItem } from "../lib/protocol"
import { deleteChat } from "../server-actions"

// The chat, phone-first: messages, tool chips, confirm cards, and a composer
// pinned above the tab bar. Talks to POST /api/assistant/chat (server-sent
// events, lib/protocol.ts); Stop aborts the request and the server keeps what
// was already written.

const SUGGESTIONS = ["What's on today?", "How much did I spend this month?", "Add a task: call the bank tomorrow at 10"]

type Props = {
  conversationId: string | null
  title: string
  initialItems: UiItem[]
  initialCards: ConfirmCard[]
  conversations: ConversationSummary[]
  prefill: string
  model: string
}

let liveCounter = 0
const liveId = (kind: string) => `live-${kind}-${++liveCounter}`

export function Chat(props: Props) {
  const [conversationId, setConversationId] = useState(props.conversationId)
  const [title, setTitle] = useState(props.title)
  const [items, setItems] = useState<UiItem[]>(props.initialItems)
  const [cards, setCards] = useState<ConfirmCard[]>(props.initialCards)
  const [decisions, setDecisions] = useState<Record<string, "approve" | "reject">>({})
  const [conversations, setConversations] = useState(props.conversations)
  const [streaming, setStreaming] = useState(false)
  const [text, setText] = useState(props.prefill)
  const [image, setImage] = useState<ResizedImage | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const live = useRef<{ assistant: string | null; tools: string | null }>({ assistant: null, tools: null })
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  // Follow new content while the reader is at the bottom; leave them alone when they scrolled up.
  useEffect(() => {
    const onScroll = () => {
      pinned.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])
  useLayoutEffect(() => {
    if (pinned.current) bottom.current?.scrollIntoView({ block: "end" })
  }, [items, cards])

  useEffect(() => () => abort.current?.abort(), [])

  function handle(event: ChatEvent) {
    switch (event.type) {
      case "conversation":
        setConversationId(event.id)
        setTitle(event.title)
        setConversations((list) => [{ id: event.id, title: event.title, updatedAt: new Date().toISOString() }, ...list.filter((c) => c.id !== event.id)])
        window.history.replaceState(null, "", `/app/assistant/${event.id}`)
        break
      // Which item a delta or chip belongs to is decided here, outside the state
      // updaters (React may run an updater twice; they must stay pure).
      case "text": {
        const id = live.current.assistant
        if (id) {
          setItems((list) => list.map((it) => (it.id === id && it.type === "assistant" ? { ...it, text: it.text + event.delta } : it)))
        } else {
          const fresh = liveId("assistant")
          live.current = { assistant: fresh, tools: null }
          setItems((list) => [...list, { type: "assistant", id: fresh, text: event.delta }])
        }
        break
      }
      case "tool": {
        const id = live.current.tools
        if (id) {
          setItems((list) =>
            list.map((it) => {
              if (it.id !== id || it.type !== "tools") return it
              const known = it.chips.some((c) => c.id === event.chip.id)
              return { ...it, chips: known ? it.chips.map((c) => (c.id === event.chip.id ? event.chip : c)) : [...it.chips, event.chip] }
            }),
          )
        } else {
          const fresh = liveId("tools")
          live.current = { assistant: null, tools: fresh }
          setItems((list) => [...list, { type: "tools", id: fresh, chips: [event.chip] }])
        }
        break
      }
      case "confirm":
        setCards(event.cards)
        setDecisions({})
        break
      case "notice":
        live.current = { assistant: null, tools: null }
        {
          const notice: UiItem = { type: "notice", id: liveId("notice"), tone: event.tone, text: event.text }
          setItems((list) => [...list, notice])
        }
        break
      case "done":
        break
    }
  }

  async function send(payload: { text?: string; image?: string; decisions?: Record<string, "approve" | "reject"> }) {
    const controller = new AbortController()
    abort.current = controller
    live.current = { assistant: null, tools: null }
    setStreaming(true)
    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, conversationId: conversationId ?? undefined }),
        signal: controller.signal,
      })
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null
        handle({ type: "notice", tone: "error", text: body?.message ?? "The assistant didn't answer. Try again." })
        return
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ""
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        let cut = buffer.indexOf("\n\n")
        while (cut !== -1) {
          const frame = buffer.slice(0, cut)
          buffer = buffer.slice(cut + 2)
          for (const line of frame.split("\n")) {
            if (line.startsWith("data: ")) handle(JSON.parse(line.slice(6)) as ChatEvent)
          }
          cut = buffer.indexOf("\n\n")
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) handle({ type: "notice", tone: "error", text: "The connection dropped. What arrived so far is saved." })
      else console.info("assistant: stopped", error instanceof Error ? error.message : error)
    } finally {
      abort.current = null
      setStreaming(false)
    }
  }

  function submit(e?: FormEvent) {
    e?.preventDefault()
    const value = text.trim()
    if ((!value && !image) || streaming) return
    if (value.length > MAX_MESSAGE_CHARS) {
      toast.error("That message is too long.")
      return
    }
    // A new message instead of tapping the cards declines them (the server says so to Claude).
    setCards([])
    const mine: UiItem = { type: "user", id: liveId("user"), text: value, image: image?.dataUrl ?? null }
    setItems((list) => [...list, mine])
    setText("")
    setImage(null)
    pinned.current = true
    void send({ text: value, image: image?.base64 })
  }

  function decide(card: ConfirmCard, decision: "approve" | "reject") {
    const next = { ...decisions, [card.id]: decision }
    setDecisions(next)
    if (cards.every((c) => next[c.id])) {
      setCards([])
      pinned.current = true
      void send({ decisions: next })
    }
  }

  async function attach(file: File | undefined) {
    if (!file) return
    setAttaching(true)
    try {
      setImage(await resizeImage(file))
      textarea.current?.focus()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That photo couldn't be opened.")
    } finally {
      setAttaching(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on a keyboard; on touch screens Enter is a new line and the button sends.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
      e.preventDefault()
      submit()
    }
  }

  // Grow the field with its text, up to ~6 lines.
  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`
  }, [text])

  const empty = items.length === 0 && cards.length === 0

  return (
    <div className="mx-auto flex min-h-[calc(100svh-14rem)] w-full max-w-3xl flex-col gap-4 md:min-h-[calc(100svh-8rem)]">
      <header className="flex items-center gap-2">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="text-eyebrow text-text-accent">Assistant</p>
          <h1 className="text-heading truncate">{title}</h1>
        </div>
        <Button variant="ghost" size="lg" onClick={() => setHistoryOpen(true)} aria-label="Chat history" className="size-10 px-0 md:h-9 md:w-auto md:px-2.5">
          <History />
          <span className="hidden md:inline">History</span>
        </Button>
        <Link
          href="/app/assistant"
          transitionTypes={NAV_FORWARD}
          aria-label="New chat"
          className={cn(buttonVariants({ variant: "outline", size: "lg" }), "size-10 px-0 md:h-9 md:w-auto md:px-2.5", !conversationId && "pointer-events-none opacity-50")}
          aria-disabled={!conversationId}
        >
          <Plus />
          <span className="hidden md:inline">New chat</span>
        </Link>
      </header>

      <section aria-label="Messages" aria-live="polite" aria-busy={streaming} className="grid flex-1 content-start gap-3">
        {empty && <EmptyState model={props.model} onPick={(s) => {
              setText(s)
              textarea.current?.focus()
            }} />}
        {items.map((item) => (
          <Item key={item.id} item={item} />
        ))}
        {cards.length > 0 && (
          <div className="grid gap-2">
            {cards.map((card) => (
              <Card key={card.id} card={card} decision={decisions[card.id]} disabled={streaming} onDecide={(d) => decide(card, d)} />
            ))}
          </div>
        )}
        {streaming && items.at(-1)?.type !== "assistant" && (
          <p className="text-meta flex items-center gap-2 text-muted-foreground" role="status">
            <Loader2Icon className="size-3.5 animate-spin" />
            Thinking…
          </p>
        )}
        <div ref={bottom} />
      </section>

      <form
        onSubmit={submit}
        className="glass glass-menu sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 grid gap-2 rounded-xl p-2 md:bottom-4"
        aria-label="Message the assistant"
      >
        {image && (
          <div className="flex items-center gap-2 px-1 pt-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local data: preview */}
            <img src={image.dataUrl} alt="Attached photo" className="size-12 rounded-lg object-cover" />
            <span className="text-caption flex-1 text-muted-foreground">Photo attached</span>
            <Button type="button" variant="ghost" size="icon-lg" onClick={() => setImage(null)} aria-label="Remove the photo">
              <X />
            </Button>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <input ref={fileInput} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void attach(e.target.files?.[0])} />
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="size-11 shrink-0 md:size-9"
            onClick={() => fileInput.current?.click()}
            disabled={attaching || streaming}
            aria-label="Attach a photo"
            title="Attach a photo"
          >
            {attaching ? <Loader2Icon className="animate-spin" /> : <ImageSquare />}
          </Button>
          <label htmlFor="assistant-input" className="sr-only">
            Message
          </label>
          <textarea
            ref={textarea}
            id="assistant-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder={cards.length ? "Or type something else…" : "Ask anything…"}
            enterKeyHint="send"
            className="min-h-11 flex-1 resize-none bg-transparent px-1 py-2.5 text-base outline-none placeholder:text-muted-foreground md:min-h-9 md:py-1.5 md:text-sm"
          />
          {streaming ? (
            <Button type="button" size="icon-lg" className="size-11 shrink-0 md:size-9" onClick={() => abort.current?.abort()} aria-label="Stop">
              <StopIcon />
            </Button>
          ) : (
            <Button type="submit" size="icon-lg" className="size-11 shrink-0 md:size-9" disabled={!text.trim() && !image} aria-label="Send">
              <ArrowUp />
            </Button>
          )}
        </div>
      </form>

      <HistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        conversations={conversations}
        current={conversationId}
        onDeleted={(id) => setConversations((list) => list.filter((c) => c.id !== id))}
      />
    </div>
  )
}

function EmptyState({ model, onPick }: { model: string; onPick: (text: string) => void }) {
  return (
    <div className="grid justify-items-start gap-3 py-6">
      <span className="grid size-10 place-items-center rounded-lg bg-accent-500/12 text-text-accent">
        <Sparkle className="size-5" />
      </span>
      <div className="grid gap-1">
        <h2 className="text-card-title">Ask about your day, money or notes</h2>
        <p className="text-meta text-muted-foreground">It reads your tasks, calendar, budget and more. Anything it wants to change waits for your confirm.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="glass press text-small min-h-11 rounded-lg px-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-9"
          >
            {s}
          </button>
        ))}
      </div>
      <p className="text-caption text-muted-foreground">{model} · answers can be wrong; check what matters.</p>
    </div>
  )
}

function Item({ item }: { item: UiItem }) {
  switch (item.type) {
    case "user":
      return (
        <div className="ml-auto grid max-w-[85%] justify-items-end gap-1.5">
          {item.image && (
            // eslint-disable-next-line @next/next/no-img-element -- the attached photo, inline
            <img src={item.image} alt="Attached photo" className="max-h-56 rounded-xl object-cover" />
          )}
          {item.text && <p className="text-body rounded-xl bg-primary px-3.5 py-2 whitespace-pre-wrap text-primary-foreground">{item.text}</p>}
        </div>
      )
    case "assistant":
      return (
        <div className="grid max-w-full gap-1">
          <Markdown source={item.text} images={false} className="text-body grid gap-2 break-words [&_a]:text-text-accent [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc" />
          {item.interrupted && <p className="text-caption text-muted-foreground">Stopped.</p>}
        </div>
      )
    case "tools":
      return (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tools used">
          {item.chips.map((chip) => (
            <Chip key={chip.id} chip={chip} />
          ))}
        </ul>
      )
    case "notice":
      return (
        <p className={cn("text-meta flex items-start gap-1.5", item.tone === "error" ? "text-destructive" : "text-muted-foreground")} role={item.tone === "error" ? "alert" : undefined}>
          {item.tone === "error" && <WarningCircle className="mt-0.5 size-3.5 shrink-0" />}
          {item.text}
        </p>
      )
  }
}

function Chip({ chip }: { chip: ToolChip }) {
  const icon =
    chip.status === "error" ? <WarningCircle className="size-3" /> : chip.status === "declined" ? <X className="size-3" /> : <Check className="size-3" />
  return (
    <li
      className={cn(
        "text-caption inline-flex max-w-full items-center gap-1 rounded-full border border-hairline px-2 py-0.5 text-muted-foreground",
        chip.status === "error" && "border-destructive/30 text-destructive",
      )}
    >
      {icon}
      <span className="truncate">
        {chip.status === "declined" ? `Cancelled: ${chip.summary ?? chip.label}` : chip.label}
        {chip.status !== "declined" && chip.summary ? ` · ${chip.summary}` : ""}
      </span>
    </li>
  )
}

function Card({
  card,
  decision,
  disabled,
  onDecide,
}: {
  card: ConfirmCard
  decision: "approve" | "reject" | undefined
  disabled: boolean
  onDecide: (d: "approve" | "reject") => void
}) {
  return (
    <div
      className={cn("glass grid gap-3 rounded-xl p-4 [--glass-shadow:var(--shadow-glass-lg)]", card.destructive && "ring-1 ring-destructive/30")}
      role="group"
      aria-label={card.title}
    >
      <p className={cn("text-body-strong", card.destructive && "text-destructive")}>{card.title}</p>
      {card.details.length > 0 && (
        <dl className="text-meta grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {card.details.map((d, i) => (
            <div key={i} className="contents">
              <dt className="text-muted-foreground">{d.label}</dt>
              <dd className="min-w-0 break-words">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {decision ? (
        <p className="text-caption text-muted-foreground">{decision === "approve" ? "Confirmed — waiting for the other cards." : "Cancelled — waiting for the other cards."}</p>
      ) : (
        <div className="flex gap-2">
          <Button size="lg" variant={card.destructive ? "destructive" : "default"} className="h-11 flex-1 md:h-9 md:flex-none" disabled={disabled} onClick={() => onDecide("approve")}>
            <Check />
            {card.destructive ? "Delete" : "Confirm"}
          </Button>
          <Button size="lg" variant="ghost" className="h-11 flex-1 md:h-9 md:flex-none" disabled={disabled} onClick={() => onDecide("reject")}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

function HistorySheet({
  open,
  onOpenChange,
  conversations,
  current,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversations: ConversationSummary[]
  current: string | null
  onDeleted: (id: string) => void
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState<ConversationSummary | null>(null)

  async function remove(c: ConversationSummary) {
    const { ok } = await deleteChat(c.id)
    if (!ok) {
      toast.error("That chat wasn't deleted. Try again.")
      return
    }
    onDeleted(c.id)
    toast.success("Chat deleted")
    if (c.id === current) router.push("/app/assistant")
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title="Chats" description="Stored in your database; deleting one removes its messages.">
        <div className="grid gap-1 p-2 pb-4">
          {conversations.length === 0 && <p className="text-meta px-2 py-3 text-muted-foreground">No chats yet.</p>}
          {conversations.map((c) => (
            <div key={c.id} className={cn("flex items-center gap-1 rounded-lg", c.id === current && "bg-muted")}>
              <Link
                href={`/app/assistant/${c.id}`}
                onClick={() => onOpenChange(false)}
                className="text-body min-h-11 min-w-0 flex-1 truncate rounded-lg px-3 py-2.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {c.title}
              </Link>
              <Button variant="ghost" size="icon-lg" className="size-11 shrink-0 text-muted-foreground md:size-9" aria-label={`Delete “${c.title}”`} onClick={() => setConfirming(c)}>
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      </Sheet>
      <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>“{confirming?.title}” and its messages are deleted for good. Nothing it saved elsewhere changes.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirming) void remove(confirming)
                setConfirming(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
