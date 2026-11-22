import { notFound } from "next/navigation"

// Unmatched /app/* URLs get the app's own 404 inside the shell (../not-found.tsx)
// instead of Next's bare default page.
export default function MissingAppPage(): never {
  notFound()
}
