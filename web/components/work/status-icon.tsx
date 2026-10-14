"use client"

// A board column's label in the current locale and its icon. The icon names are the server's
// allow-list (work.StatusIcons); a column without one shows its workflow stage's default.
import {
  ArchiveIcon,
  BanIcon,
  BugIcon,
  CheckCheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleEllipsisIcon,
  CirclePauseIcon,
  CircleIcon,
  ClipboardListIcon,
  EyeIcon,
  FlagIcon,
  GitPullRequestIcon,
  HourglassIcon,
  InboxIcon,
  ListTodoIcon,
  LoaderIcon,
  MessageSquareIcon,
  PackageIcon,
  PauseIcon,
  RocketIcon,
  SearchCheckIcon,
  ShieldCheckIcon,
  SparklesIcon,
  StarIcon,
  TestTubeIcon,
  TimerIcon,
  type LucideIcon,
} from "lucide-react"

import { solid } from "@/components/work/palette"
import { cn } from "@/lib/utils"
import type { Status } from "@/lib/work"

export const STATUS_ICONS: Record<string, LucideIcon> = {
  inbox: InboxIcon,
  "list-todo": ListTodoIcon,
  circle: CircleIcon,
  "circle-dashed": CircleDashedIcon,
  "circle-dot": CircleDotIcon,
  "circle-pause": CirclePauseIcon,
  "circle-ellipsis": CircleEllipsisIcon,
  loader: LoaderIcon,
  timer: TimerIcon,
  hourglass: HourglassIcon,
  pause: PauseIcon,
  eye: EyeIcon,
  "search-check": SearchCheckIcon,
  "shield-check": ShieldCheckIcon,
  "circle-check": CircleCheckIcon,
  "check-check": CheckCheckIcon,
  flag: FlagIcon,
  rocket: RocketIcon,
  bug: BugIcon,
  sparkles: SparklesIcon,
  star: StarIcon,
  archive: ArchiveIcon,
  ban: BanIcon,
  "clipboard-list": ClipboardListIcon,
  "message-square": MessageSquareIcon,
  "git-pull-request": GitPullRequestIcon,
  "test-tube": TestTubeIcon,
  package: PackageIcon,
}

/** The icon a column shows when it has none of its own. */
export const STAGE_ICON: Record<string, string> = {
  backlog: "circle-dashed",
  todo: "circle",
  in_progress: "circle-dot",
  waiting_approval: "circle-pause",
  in_review: "circle-ellipsis",
  done: "circle-check",
}

type Labelled = Pick<Status, "name"> & Partial<Pick<Status, "labels">>

/** The column's name in this locale, else its name. */
export function statusLabel(s: Labelled, locale: string): string {
  return s.labels?.[locale]?.trim() || s.name
}

type Iconed = Partial<Pick<Status, "icon" | "stage" | "category" | "color">>

/** The column's own icon, else its stage's (a column without a stage goes by its category). */
export function statusIconName(s?: Iconed | null): string {
  if (s?.icon && STATUS_ICONS[s.icon]) return s.icon
  const stage = s?.stage || (s?.category === "doing" ? "in_progress" : s?.category)
  return STAGE_ICON[stage ?? ""] ?? "circle"
}

/** A column's state at a glance, drawn in the column's colour. */
export function StatusIcon({ status, className }: { status?: Iconed | null; className?: string }) {
  const Icon = STATUS_ICONS[statusIconName(status)] ?? CircleIcon
  return (
    <Icon
      aria-hidden
      data-stage={status?.stage ?? ""}
      className={cn("size-4 shrink-0", className)}
      style={status?.color ? { color: solid(status.color) } : undefined}
    />
  )
}
