import "server-only"
import { connection } from "next/server"
import { getSiteUrl } from "@/lib/site"
import { atomFeed, rssFeed } from "./feed"
import { getPublishedNotes } from "./public"

// GET handlers behind /writing/feed.xml (also /feed.xml) and /writing/atom.xml.
// Never prerendered: connection() keeps them out of the build, where there is
// no database and the origin is the http://localhost:3000 placeholder. Every
// URL inside is absolute, from the runtime origin (BETTER_AUTH_URL). The notes
// read is cached and dropped on publish / unpublish / edit / delete.

async function feed(build: typeof rssFeed, contentType: string) {
  await connection()
  try {
    const notes = await getPublishedNotes()
    return new Response(build({ notes, site: getSiteUrl() }), {
      headers: {
        "Content-Type": `${contentType}; charset=utf-8`,
        // Readers poll; an unpublished note must not linger in a cache.
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch {
    return new Response("The feed is unavailable right now.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "300" },
    })
  }
}

export const rssGET = () => feed(rssFeed, "application/rss+xml")
export const atomGET = () => feed(atomFeed, "application/atom+xml")
