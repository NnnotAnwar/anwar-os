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

// Public face: cv, projects, ideas, public site.
export const ArrowDown = bold(P.ArrowDown)
export const ArrowRight = bold(P.ArrowRight)
export const ArrowUp = bold(P.ArrowUp)
export const Briefcase = bold(P.Briefcase)
export const ChatText = bold(P.ChatText)
export const Code = bold(P.Code)
export const Eye = bold(P.Eye)
export const EyeSlash = bold(P.EyeSlash)
export const IdCard = bold(P.IdentificationCard)
export const Lightbulb = bold(P.Lightbulb)
export const PlayCircle = bold(P.PlayCircle)
export const Printer = bold(P.Printer)
export const StarFill = bold(P.Star, "fill")

// files module
export const Folder = bold(P.Folder)
export const FolderOpen = bold(P.FolderOpen)
export const FolderPlus = bold(P.FolderPlus)
export const FolderDuo = bold(P.Folder, "duotone")
export const Upload = bold(P.UploadSimple)
export const CloudUpload = bold(P.CloudArrowUp, "duotone")
export const Download = bold(P.DownloadSimple)
export const FileIcon = bold(P.File)
export const FileImage = bold(P.FileImage)
export const FilePdf = bold(P.FilePdf)
export const FileZip = bold(P.FileZip)
export const FileDoc = bold(P.FileDoc)
export const FileXls = bold(P.FileXls)
export const FilePpt = bold(P.FilePpt)
export const FileCsv = bold(P.FileCsv)
export const FileTxt = bold(P.FileTxt)
export const FileMd = bold(P.FileMd)
export const MoreHorizontal = bold(P.DotsThree)
export const House = bold(P.HouseSimple)

// calendar module
export const ChevronLeft = bold(P.CaretLeft)
export const ChevronRight = ChevronRightIcon
export const ChevronDown = bold(P.CaretDown)
export const MapPin = bold(P.MapPin)
export const Bell = bold(P.Bell)
export const Repeat = bold(P.Repeat)
export const Copy = bold(P.Copy)
export const Gift = bold(P.Gift)
export const Flag = bold(P.Flag)
export const Rss = bold(P.Rss)
export const CalendarPlus = bold(P.CalendarPlus)
export const CalendarDuo = bold(P.CalendarBlank, "duotone")
export const Clock = bold(P.Clock)

// shell
export const SunHorizon = bold(P.SunHorizon)
export const DotsGrid = bold(P.DotsNine)

// services
export const SquaresFour = bold(P.SquaresFour)
export const Star = bold(P.Star)
export const Hammer = bold(P.Hammer)
export const Compass = bold(P.Compass)
export const ListBullets = bold(P.ListBullets)
export const Rows = bold(P.Rows)
export const SignIn = bold(P.SignIn)

// sign-in methods
export const Fingerprint = bold(P.Fingerprint)
export const KeyIcon = bold(P.Key)
export const PasswordIcon = bold(P.Password)
export const ShieldCheck = bold(P.ShieldCheck)
// tasks + inbox
export const ListChecks = bold(P.ListChecks)
export const TrayArrowDown = bold(P.TrayArrowDown)
export const GripVertical = bold(P.DotsSixVertical)
export const TextAlignLeft = bold(P.TextAlignLeft)
export const CalendarX = bold(P.CalendarX)
export const CalendarCheck = bold(P.CalendarCheck)
export const Keyboard = bold(P.Keyboard)
export const Couch = bold(P.Couch)
export const ArrowBendUpRight = bold(P.ArrowBendUpRight)
// daily modules: lists, board, editor, empty states
export const Kanban = bold(P.Kanban)
export const TextBold = bold(P.TextB)
export const TextItalic = bold(P.TextItalic)
export const CheckSquare = bold(P.CheckSquare)
export const NotePencilDuo = bold(P.NotePencil, "duotone")
export const LinkDuo = bold(P.LinkSimple, "duotone")
export const LightbulbDuo = bold(P.Lightbulb, "duotone")
export const SearchDuo = bold(P.MagnifyingGlass, "duotone")
// budget
export const Wallet = bold(P.Wallet)
export const PiggyBank = bold(P.PiggyBank)
export const Bank = bold(P.Bank)
export const Target = bold(P.Target)
export const ArrowsLeftRight = bold(P.ArrowsLeftRight)
export const Receipt = bold(P.Receipt)
export const ChartLineUp = bold(P.ChartLineUp)
export const Coins = bold(P.Coins)
export const Pause = bold(P.Pause)
export const Play = bold(P.Play)
// osbot
export const TelegramLogo = bold(P.TelegramLogo)
