import NextLink from "next/link"
import { actions } from "../actions"
import { Favicon } from "../components/favicon"
import { domainOf } from "../schema"

const rowClass =
  "flex items-center gap-2.5 rounded-lg px-2 py-1.5 -mx-2 outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"

export async function ReadLater() {
  const links = await actions.list.handler({ readLater: true, limit: 6 })
  if (links.length === 0) {
    return (
      <p className="text-meta text-muted-foreground">
        All caught up.{" "}
        <NextLink href="/app/links?add=1" className="text-text-accent underline-offset-4 hover:underline">
          Save a link
        </NextLink>{" "}
        and mark it to read later.
      </p>
    )
  }
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
      {links.map((link) => (
        <li key={link.id}>
          <a href={link.url} target="_blank" rel="noopener noreferrer" className={rowClass}>
            <Favicon src={link.favicon_url} />
            <span className="text-body min-w-0 flex-1 truncate">{link.title}</span>
            <span className="text-caption max-w-[40%] shrink-0 truncate text-muted-foreground">
              {domainOf(link.url)}
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}
