// Category colour tokens. The database stores the token name; classes are
// literal so Tailwind sees them. The dot is a hint only: the category name is
// always written next to it, so colour is never the only signal.

export const categoryColors = {
  "accent-500": "bg-accent-500",
  "accent-300": "bg-accent-300 dark:bg-accent-400",
  "accent-700": "bg-accent-700 dark:bg-accent-300",
  sky: "bg-sky-500",
  teal: "bg-teal-500",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  fuchsia: "bg-fuchsia-500",
  slate: "bg-slate-400",
} as const

export type CategoryColor = keyof typeof categoryColors
export const categoryColorNames = Object.keys(categoryColors) as CategoryColor[]

export const colorLabels: Record<CategoryColor, string> = {
  "accent-500": "Indigo",
  "accent-300": "Lavender",
  "accent-700": "Deep indigo",
  sky: "Sky",
  teal: "Teal",
  amber: "Amber",
  orange: "Orange",
  fuchsia: "Fuchsia",
  slate: "Slate",
}

export function colorClass(token: string) {
  return categoryColors[token as CategoryColor] ?? categoryColors["accent-500"]
}
