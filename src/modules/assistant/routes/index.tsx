import { Suspense } from "react"
import { notFound } from "next/navigation"
import { z } from "zod"
import { Page, Reveal, SkeletonExit } from "@/components/motion"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { claudeConfig } from "@/lib/claude"
import { Chat } from "../components/chat"
import { AssistantDisabled } from "../components/disabled"
import { uiItems } from "../lib/history"
import type { UiItem } from "../lib/protocol"
import { getConversation, listConversations } from "../store"

// /app/assistant (a new chat) and /app/assistant/[id] (one conversation).

export default function AssistantPage({ searchParams }: PageProps<"/app/assistant">) {
  return (
    <Page>
      <Suspense fallback={<ChatSkeleton />}>
        <Reveal>
          <NewChat searchParams={searchParams} />
        </Reveal>
      </Suspense>
    </Page>
  )
}

export function ConversationPage({ params }: PageProps<"/app/assistant/[id]">) {
  return (
    <Page>
      <Suspense fallback={<ChatSkeleton />}>
        <Reveal>
          <Existing params={params} />
        </Reveal>
      </Suspense>
    </Page>
  )
}

/** "claude-sonnet-5-5" → "Claude Sonnet 5.5". */
function modelLabel(model: string) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(model)
  if (!m) return model
  return `Claude ${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`
}

async function NewChat({ searchParams }: Pick<PageProps<"/app/assistant">, "searchParams">) {
  await requireViewer()
  const config = claudeConfig()
  if (!config.apiKey) return <AssistantDisabled />
  const [conversations, params] = await Promise.all([listConversations(), searchParams])
  const prefill = typeof params.q === "string" ? params.q.slice(0, 500) : ""
  return <Chat key="new" conversationId={null} title="New chat" initialItems={[]} initialCards={[]} conversations={conversations} prefill={prefill} model={modelLabel(config.chatModel)} />
}

async function Existing({ params }: Pick<PageProps<"/app/assistant/[id]">, "params">) {
  await requireViewer()
  const config = claudeConfig()
  if (!config.apiKey) return <AssistantDisabled />
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()
  const [loaded, conversations] = await Promise.all([getConversation(id), listConversations()])
  if (!loaded) notFound()
  const { conversation, messages } = loaded
  const items: UiItem[] = uiItems(messages)
  if (conversation.pending?.chips.length) items.push({ type: "tools", id: "pending-tools", chips: conversation.pending.chips })
  return (
    <Chat
      key={conversation.id}
      conversationId={conversation.id}
      title={conversation.title}
      initialItems={items}
      initialCards={conversation.pending?.calls.map((c) => c.card) ?? []}
      conversations={conversations}
      prefill=""
      model={modelLabel(conversation.model)}
    />
  )
}

function ChatSkeleton() {
  return (
    <SkeletonExit>
      <div className="mx-auto grid w-full max-w-3xl gap-4" aria-hidden>
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
        <Skeleton className="ml-auto h-10 w-2/3 rounded-xl" />
        <Skeleton className="h-24 w-5/6 rounded-xl" />
        <Skeleton className="mt-8 h-12 w-full rounded-xl" />
      </div>
    </SkeletonExit>
  )
}
