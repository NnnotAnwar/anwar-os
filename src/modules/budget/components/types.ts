// What client components get about accounts and categories (no balances needed).
export type AccountOption = { id: string; name: string; currency: string; archived?: boolean }
export type CategoryOption = { id: string; name: string; kind: "income" | "expense"; parentId: string | null; color: string }

/** Categories as <optgroup>s: parents, each followed by its children ("Food › Groceries"). */
export function categoryGroups(categories: CategoryOption[]) {
  const byKind = (kind: "income" | "expense") => {
    const parents = categories.filter((c) => c.kind === kind && !c.parentId)
    const out: { id: string; label: string }[] = []
    for (const p of parents) {
      out.push({ id: p.id, label: p.name })
      for (const child of categories.filter((c) => c.parentId === p.id)) out.push({ id: child.id, label: `${p.name} › ${child.name}` })
    }
    // Children whose parent is archived or missing still need to be pickable.
    for (const orphan of categories.filter((c) => c.kind === kind && c.parentId && !parents.some((p) => p.id === c.parentId))) {
      out.push({ id: orphan.id, label: orphan.name })
    }
    return out
  }
  return { expense: byKind("expense"), income: byKind("income") }
}
