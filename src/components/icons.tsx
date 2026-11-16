// The app's icon set: Phosphor, bold weight (Planuj Glass). The SSR build has no
// React context, so these work in Server and Client Components alike.
// Names mirror the ones the code already used, so call sites stay readable.
import type { ComponentType, SVGProps } from "react"
import * as P from "@phosphor-icons/react/ssr"
import type { IconProps } from "@phosphor-icons/react"

export type AppIcon = ComponentType<{ className?: string } & Omit<SVGProps<SVGSVGElement>, "ref">>

function bold(Icon: ComponentType<IconProps>, weight: IconProps["weight"] = "bold"): AppIcon {
  function AppIconComponent(props: { className?: string } & Omit<SVGProps<SVGSVGElement>, "ref">) {
    return <Icon weight={weight} aria-hidden={props["aria-label"] ? undefined : true} {...(props as IconProps)} />
  }
  AppIconComponent.displayName = `Icon(${Icon.displayName ?? "Phosphor"})`
  return AppIconComponent
}

export const ArrowLeft = bold(P.ArrowLeft)
export const ArrowUpRight = bold(P.ArrowUpRight)
export const Calculator = bold(P.Calculator)
export const CalendarDays = bold(P.CalendarBlank)
export const Check = bold(P.Check)
export const CheckIcon = Check
export const ChevronRightIcon = bold(P.CaretRight)
export const CircleCheckIcon = bold(P.CheckCircle, "fill")
export const CornerDownLeft = bold(P.ArrowElbowDownLeft)
export const Delete = bold(P.Backspace)
export const FileText = bold(P.FileText)
export const Flame = bold(P.Fire)
export const InfoIcon = bold(P.Info, "fill")
export const Loader2Icon = bold(P.CircleNotch)
export const LogOut = bold(P.SignOut)
export const Monitor = bold(P.Monitor)
export const Moon = bold(P.Moon)
export const NotebookPen = bold(P.NotePencil)
export const OctagonXIcon = bold(P.WarningOctagon, "fill")
export const Pin = bold(P.PushPin)
export const PinOff = bold(P.PushPinSlash)
export const Plus = bold(P.Plus)
export const RotateCcw = bold(P.ArrowCounterClockwise)
export const Search = bold(P.MagnifyingGlass)
export const SearchIcon = Search
export const Settings = bold(P.GearSix)
export const Sigma = bold(P.Sigma)
export const Sun = bold(P.Sun)
export const Trash2 = bold(P.Trash)
export const TrendingUp = bold(P.TrendUp)
export const TriangleAlertIcon = bold(P.Warning, "fill")
export const X = bold(P.X)
export const XIcon = X

// links + feedback
export const LinkIcon = bold(P.LinkSimple)
export const Globe = bold(P.Globe)
export const Lock = bold(P.LockSimple)
export const Bookmark = bold(P.BookmarkSimple)
export const BookmarkFilled = bold(P.BookmarkSimple, "fill")
export const Pencil = bold(P.PencilSimple)
export const ExternalLink = bold(P.ArrowSquareOut)
export const Tag = bold(P.Tag)
export const Refresh = bold(P.ArrowClockwise)
export const MessageSquare = bold(P.ChatCircleText)
export const Inbox = bold(P.Tray)
export const ShieldWarning = bold(P.ShieldWarning)
export const Send = bold(P.PaperPlaneTilt)
export const CheckCircle = bold(P.CheckCircle, "fill")
