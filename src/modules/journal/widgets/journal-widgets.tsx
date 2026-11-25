import { actions, viewerToday } from "../actions"
import { EntryEditor } from "../components/entry-editor"

/** Today: "How was today?" — a face and one line, saved in place (the tile links to Journal). */
export async function HowWasToday() {
  const today = await viewerToday()
  const entry = await actions.get.handler({ day: today })
  return <EntryEditor key={today} day={today} entry={entry} dayLabel="today" compact />
}
