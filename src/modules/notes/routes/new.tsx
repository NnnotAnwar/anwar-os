import { Suspense } from "react"
import { requireViewer } from "@/core/auth"
import { NoteEditor } from "../components/note-editor"
import { EditorSkeleton } from "./detail"

export default function NewNotePage() {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <NewNote />
    </Suspense>
  )
}

async function NewNote() {
  const viewer = await requireViewer()
  return <NoteEditor mode="create" timezone={viewer.timezone} locale={viewer.locale} />
}
