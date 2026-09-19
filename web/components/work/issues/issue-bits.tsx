"use client"
// Small shared pieces of the issue tracker: type icon, priority mark, agent time,
// the human-only marker and the author-kind badge.
import {
  BookmarkIcon,
  BotIcon,
  BugIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  ChevronsDownIcon,
  ChevronsUpIcon,
  ChevronUpIcon,
  EqualIcon,
  HandIcon,
  ShieldIcon,
  SparklesIcon,
  UserIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Ltr } from "@/components/copy-field"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const TYPE_ICON: Record<string, { Icon: LucideIcon; tone: string }> = {
  bug: { Icon: BugIcon, tone: "text-grid-danger" },
  feature: { Icon: SparklesIcon, tone: "text-(--pal-amber)" },
  task: { Icon: CheckSquareIcon, tone: "text-grid-action" },
  story: { Icon: BookmarkIcon, tone: "text-(--pal-green)" },
  epic: { Icon: ZapIcon, tone: "text-(--pal-violet)" },
}

export function IssueTypeIcon({ type, className }: { type: string; className?: string }) {
  const { t } = useTranslations()
  const m = TYPE_ICON[type] ?? TYPE_ICON.task
  return <m.Icon className={cn("size-3.5 shrink-0", m.tone, className)} aria-label={t(`issues.type.${type}`)} role="img" />
}

const PRIORITY_MARK: Record<string, { Icon: LucideIcon; tone: string }> = {
  highest: { Icon: ChevronsUpIcon, tone: "text-grid-danger" },
  urgent: { Icon: ChevronsUpIcon, tone: "text-grid-danger" },
  high: { Icon: ChevronUpIcon, tone: "text-(--pal-orange)" },
  medium: { Icon: EqualIcon, tone: "text-(--pal-amber)" },
  low: { Icon: ChevronDownIcon, tone: "text-grid-action" },
  lowest: { Icon: ChevronsDownIcon, tone: "text-grid-muted" },
}

export function IssuePriorityMark({ priority, withLabel, className }: { priority: string; withLabel?: boolean; className?: string }) {
  const { t } = useTranslations()
  const m = PRIORITY_MARK[priority] ?? PRIORITY_MARK.medium
  const label = t(`issues.priority.${priority}`)
  return (
    <span className={cn("inline-flex items-center gap-1", m.tone, className)} title={label}>
      <m.Icon className="size-3.5 shrink-0" aria-hidden />
      {withLabel ? <span className="text-xs font-medium">{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  )
}

/** 5400 → "1h 30m"; under a minute → "<1m". */
export function agentTime(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return ""
  if (seconds < 60) return "<1m"
  const m = Math.round(seconds / 60)
  const h = Math.floor(m / 60)
  return [h ? `${h}h` : "", m % 60 ? `${m % 60}m` : ""].filter(Boolean).join(" ")
}

export function AgentTime({ seconds, className }: { seconds: number | null | undefined; className?: string }) {
  const { t } = useTranslations()
  const v = agentTime(seconds)
  if (!v) return null
  return (
    <span className={cn("inline-flex items-center gap-1", className)} title={t("issues.agentTime")}>
      <BotIcon className="size-3" aria-hidden />
      <span className="sr-only">{t("issues.agentTime")}</span>
      <Ltr>{v}</Ltr>
    </span>
  )
}

export function HumanOnlyMark({ className }: { className?: string }) {
  const { t } = useTranslations()
  return (
    <span className={cn("inline-flex items-center gap-1 text-(--pal-orange)", className)} title={t("issues.humanOnlyHint")}>
      <HandIcon className="size-3" aria-hidden />
      <span className="text-[10px] font-medium uppercase">{t("issues.humanOnly")}</span>
    </span>
  )
}

const KIND_ICON: Record<string, LucideIcon> = { agent: BotIcon, admin: ShieldIcon, user: UserIcon }

export function AuthorKindBadge({ kind }: { kind: string }) {
  const { t } = useTranslations()
  const Icon = KIND_ICON[kind] ?? UserIcon
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 text-[10px]",
        kind === "agent" && "border-grid-action/40 text-grid-action",
        kind === "admin" && "border-(--pal-orange)/40 text-(--pal-orange)",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {t(`issues.kind.${kind in KIND_ICON ? kind : "user"}`)}
    </Badge>
  )
}
