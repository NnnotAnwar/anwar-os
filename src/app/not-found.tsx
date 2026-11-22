import PublicLayout from "./(public)/layout"
import PublicNotFound from "./(public)/not-found"

export const metadata = { title: "Not found" }

// URLs that match no route at all: the site's own 404 inside the public frame,
// with a real 404 status, instead of Next's bare default page. (Unmatched
// /app/* URLs render the app's 404 inside the shell: app/[...missing].)
export default function NotFound() {
  return (
    <PublicLayout>
      <PublicNotFound />
    </PublicLayout>
  )
}
