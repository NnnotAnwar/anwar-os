import { createCn } from "cn/config"

// The Planuj Glass type styles (globals.css) set font size, weight and tracking.
// Registered as font sizes so `cn("text-meta text-muted-foreground")` keeps both:
// unknown `text-*` classes are otherwise read as colours and dropped.
const typeStyles = [
  "greeting",
  "card-title",
  "heading",
  "body",
  "body-strong",
  "meta",
  "small",
  "caption",
  "eyebrow",
  "micro",
  "metric",
  "metric-sm",
]

export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: typeStyles }] } },
})
