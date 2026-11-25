import { Suspense } from "react"
import { requireViewer } from "@/core/auth"
import { NoteEditor } from "../components/note-editor"
import { EditorSkeleton } from "./detail"
import { Page } from "@/components/motion"

export default function NewNotePage() {
  return (
    <Page>
      <Suspense fallback={<EditorSkeleton />}>
        <NewNote />
      </Suspense>
    </Page>
  )
}

async function NewNote() {
  const viewer = await requireViewer()
  return <NoteEditor mode="create" timezone={viewer.timezone} locale={viewer.locale} />
}
