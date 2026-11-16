import { getServices, loadBadges, type Service } from "@/core/services"
import { cn } from "@/lib/utils"
import { ServiceCard } from "./service-card"

/** Props for a ServiceCard, built on the server (icons become elements). */
function toCard(m: Service, badges: Awaited<ReturnType<typeof loadBadges>>, pinnedIds: string[]) {
  const pinnedIndex = pinnedIds.indexOf(m.id)
  return {
    id: m.id,
    name: m.name,
    tagline: m.tagline,
    description: m.description,
    icon: <m.icon />,
    href: m.nav[0]!.href,
    create: m.create ? { label: m.create.label, href: m.create.href } : undefined,
    options: (m.shortcuts ?? []).map((s) => ({
      label: s.label,
      href: s.href,
      hint: s.hint,
      icon: s.icon ? <s.icon /> : undefined,
    })),
    badge: badges[m.id] ?? null,
    pinned: pinnedIndex !== -1,
    pinnedIndex,
    pinnedCount: pinnedIds.length,
  }
}

/** Grid of service cards. `which` picks the pinned set, the rest, or all. */
export async function ServiceGrid({
  which,
  variant = "card",
  className,
}: {
  which: "pinned" | "rest" | "all"
  variant?: "tile" | "card"
  className?: string
}) {
  const { all, pinned, rest, pinnedIds } = await getServices()
  const list = which === "pinned" ? pinned : which === "rest" ? rest : all
  if (list.length === 0) return null
  const badges = await loadBadges(list)

  return (
    <ul
      className={cn(
        "grid gap-2.5",
        variant === "tile" ? "grid-cols-4 sm:grid-cols-6" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
        className,
      )}
    >
      {list.map((m) => (
        <li key={m.id}>
          <ServiceCard {...toCard(m, badges, pinnedIds)} variant={variant} />
        </li>
      ))}
    </ul>
  )
}
