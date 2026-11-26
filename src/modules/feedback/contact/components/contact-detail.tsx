"use client"

import { useState, useTransition } from "react"
import NextLink from "next/link"
import { toast } from "sonner"
import { Archive, ArrowBendUpLeft, ArrowLeft, Check, RotateCcw, Trash2 } from "@/components/icons"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogConfirm,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { contactStatusLabels, mailtoHref, replyHref, type ContactMessage, type ContactStatus } from "../schema"
import { deleteContact, setContactStatus } from "../server-actions"
import { ContactStatusBadge, TopicBadge } from "./badges"

const toastText: Record<ContactStatus, string> = {
  new: "Marked as waiting for a reply",
  replied: "Marked replied",
  archived: "Archived",
}

export function ContactDetail({ message, timezone, locale }: { message: ContactMessage; timezone: string; locale: string }) {
  const [status, setStatus] = useState<ContactStatus>(message.status)
  const [, startTransition] = useTransition()
  const [deleting, startDeleting] = useTransition()

  function changeStatus(next: ContactStatus) {
    if (next === status) return
    const previous = status
    setStatus(next)
    startTransition(async () => {
      const result = await setContactStatus({ id: message.id, status: next })
      if (!result.ok) {
        setStatus(previous)
        return void toast.error(result.error)
      }
      toast.success(toastText[next], {
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              setStatus(previous)
              const back = await setContactStatus({ id: message.id, status: previous })
              if (!back.ok) toast.error(back.error)
            }),
        },
      })
    })
  }

  const received = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(message.created_at))

  return (
    <article className="grid w-full max-w-3xl gap-3">
      <div className="flex min-h-9 items-center gap-2">
        <NextLink
          href="/app/feedback/contact"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 text-muted-foreground max-sm:h-11")}
        >
          <ArrowLeft />
          Contact
        </NextLink>
        <div className="ml-auto flex items-center gap-1">
          {status === "archived" ? (
            <Button variant="ghost" size="sm" className="max-sm:h-11" onClick={() => changeStatus("new")}>
              <RotateCcw />
              Unarchive
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="max-sm:h-11" onClick={() => changeStatus("archived")}>
              <Archive />
              Archive
            </Button>
          )}
          <AlertDialog busy={deleting}>
            <AlertDialogTrigger
              render={<Button variant="ghost" size="sm" className="hover:text-destructive max-sm:h-11" />}
            >
              <Trash2 />
              Delete
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this message?</AlertDialogTitle>
                <AlertDialogDescription>
                  {message.name}’s message and email address are removed for good. This can’t be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogConfirm
                  busyLabel="Deleting…"
                  onClick={() =>
                    startDeleting(async () => {
                      await deleteContact({ id: message.id })
                      toast.success("Message deleted")
                    })
                  }
                >
                  Delete message
                </AlertDialogConfirm>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <section aria-label="Message" className="glass grid gap-4 rounded-xl p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <TopicBadge topic={message.topic} />
          <ContactStatusBadge status={status} />
          <time dateTime={message.created_at} className="text-caption ml-auto text-muted-foreground tabular-nums">
            {received}
          </time>
        </div>
        <dl className="text-meta grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">From</dt>
          <dd className="font-semibold">{message.name}</dd>
          {message.company && (
            <>
              <dt className="text-muted-foreground">Company</dt>
              <dd>{message.company}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Email</dt>
          <dd className="[overflow-wrap:anywhere]">
            <a href={mailtoHref(message.email)} className="text-text-accent hover:underline">
              {message.email}
            </a>
          </dd>
        </dl>
        <p className="text-sm leading-6 font-medium whitespace-pre-wrap [overflow-wrap:anywhere]">{message.message}</p>
        <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
          <a
            href={replyHref(message)}
            onClick={() => {
              // Opening the mail app is the reply for most messages; one tap less afterwards.
              if (status === "new") changeStatus("replied")
            }}
            className={cn(buttonVariants({ size: "lg" }), "max-sm:h-11 max-sm:flex-1")}
          >
            <ArrowBendUpLeft />
            Reply by email
          </a>
          {status === "replied" ? (
            <Button variant="outline" size="lg" className="max-sm:h-11" onClick={() => changeStatus("new")}>
              Not replied yet
            </Button>
          ) : (
            status === "new" && (
              <Button variant="outline" size="lg" className="max-sm:h-11" onClick={() => changeStatus("replied")}>
                <Check />
                Mark replied
              </Button>
            )
          )}
        </div>
        <p className="text-caption text-muted-foreground">
          Status: {contactStatusLabels[status]}. Reply by email opens your mail app with the message quoted and marks it
          replied.
        </p>
      </section>
    </article>
  )
}
