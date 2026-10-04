"use client"

// The project page header: avatar, name and description, status pill and key facts, primary
// actions (new task, timer, more) and the meta row (client, visibility, GitHub repository).
import Link from "next/link"
import { ArchiveIcon, CalendarIcon, ChevronLeftIcon, ClockIcon, EllipsisIcon, EyeIcon, GlobeIcon, LayoutGridIcon, PlayIcon, PlusIcon, SettingsIcon, SquareIcon, UsersIcon, WalletIcon } from "lucide-react"

import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { useTimerActions } from "@/components/time/timer-bar"
import { NewTaskDialog } from "@/components/work/project/new-task-dialog"
import { ProjectAvatar } from "@/components/work/project-avatar"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { formatDay, minutes, money, timeAgo } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useIntegrations } from "@/lib/integrations"
import { clock, entrySeconds, useNow } from "@/lib/time"
import type { ProjectDetail, ProjectStatus } from "@/lib/work"
import { cn } from "@/lib/utils"

const STATUS_DOT: Record<ProjectStatus, string> = {
  planned: "bg-muted-foreground",
  active: "bg-nq-ok",
  on_hold: "bg-nq-warn",
  completed: "bg-nq-action",
  cancelled: "bg-nq-danger",
}

export function StatusPill({ status, className }: { status: ProjectStatus; className?: string }) {
  const { t } = useTranslations()
  return (
    <Badge variant="outline" className={cn("gap-1.5 whitespace-nowrap", className)} data-project-status={status}>
      <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {t(`projectStatus.${status}`)}
    </Badge>
  )
}

function Chip({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap border border-border bg-card px-2.5 text-caption text-nq-fg-body [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
      {icon}
      {children}
    </span>
  )
}

function TimerButton({ p }: { p: ProjectDetail }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const { timer, busy, start, stop } = useTimerActions()
  const here = !!timer && timer.project_id === p.id
  const now = useNow(1000, here)
  if (!ws.can("time:track") || p.archived_at) return null
  return (
    <Button variant={here ? "primary" : "secondary"} disabled={busy} onClick={() => (here ? void stop() : void start({ project: p.id }))} data-project-timer={here ? "running" : "idle"}>
      {here ? <SquareIcon /> : <PlayIcon />}
      {here ? t("timer.stopHere") : t("timer.startHere")}
      {here && timer ? (
        <Ltr mono className="tabular-nums">
          {clock(entrySeconds(timer, now))}
        </Ltr>
      ) : null}
    </Button>
  )
}

export function ProjectHeader({ p, base, slugBase }: { p: ProjectDetail; base: string; slugBase: string }) {
  const { t, locale, isRtl } = useTranslations()
  const ws = useWorkspace()
  const integrations = useIntegrations(ws.id, p.id, ws.can("integrations:read"))
  const gh = (integrations.data?.integrations ?? []).find((i) => i.provider === "github")
  const repo = gh?.config.repo && gh.status !== "disabled" ? gh.config.repo : null
  const canWrite = p.can_write && !p.archived_at

  return (
    <header className="px-4 pt-5 sm:px-6">
      <Link href={`${slugBase}/projects`} className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className={isRtl ? "size-3.5 rotate-180" : "size-3.5"} />
        {t("nav.projects")}
      </Link>

      <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-3">
        <ProjectAvatar project={p} className="size-14 text-base sm:size-16 sm:text-lg" />
        <div className="min-w-0 flex-1 basis-60">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-h2 min-w-0 break-words text-2xl">{p.name}</h1>
            <StatusPill status={p.status} />
            {p.archived_at ? (
              <Badge variant="neutral" className="gap-1">
                <ArchiveIcon />
                {t("project.archivedBadge")}
              </Badge>
            ) : null}
          </div>
          {p.client_name ? <p className="mt-0.5 text-sm font-medium text-nq-fg-body">{p.client_name}</p> : null}
          {p.description ? <p className="mt-0.5 line-clamp-2 max-w-3xl text-sm text-muted-foreground">{p.description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TimerButton p={p} />
          {canWrite ? (
            <NewTaskDialog
              trigger={(open) => (
                <Button onClick={open} data-new-task>
                  <PlusIcon />
                  {t("po.newTask")}
                </Button>
              )}
            />
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="secondary" size="icon" aria-label={t("po.more")} />}>
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuGroup>
                <DropdownMenuItem render={<Link href={`${base}/board`} />}>
                  <LayoutGridIcon />
                  {t("projectTab.board")}
                </DropdownMenuItem>
                {p.can_manage ? (
                  <DropdownMenuItem render={<Link href={`${base}/settings`} />}>
                    <SettingsIcon />
                    {t("projectTab.settings")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Chip icon={<WalletIcon />}>{t(`billing.${p.billing_mode}`)}</Chip>
        {p.budget_minutes ? (
          <Chip icon={<ClockIcon />}>
            <Ltr>{minutes(p.budget_minutes)}</Ltr>
          </Chip>
        ) : null}
        {p.budget_minor ? (
          <Chip>
            <Ltr>{money(p.budget_minor, p.currency, locale)}</Ltr>
          </Chip>
        ) : null}
        {p.starts_on || p.ends_on ? (
          <Chip icon={<CalendarIcon />}>
            <Ltr>
              {p.starts_on && p.ends_on ? `${formatDay(p.starts_on, locale, "short")} → ${formatDay(p.ends_on, locale, "short")}` : formatDay(p.starts_on ?? p.ends_on, locale, "short")}
            </Ltr>
          </Chip>
        ) : null}
        <Chip icon={<UsersIcon />}>{t("po.members", { n: String(p.member_count) })}</Chip>
        <span className="text-caption text-muted-foreground">
          {t("po.updated")} <Ltr>{timeAgo(p.updated_at, locale)}</Ltr>
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-border py-2.5 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {t("project.client")}:
          {p.client_id ? (
            <Link href={`${slugBase}/clients/${p.client_id}`} className="text-nq-fg-body underline-offset-4 hover:underline">
              {p.client_name}
            </Link>
          ) : (
            <span className="text-nq-fg-body">{t("project.noClient")}</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <EyeIcon className="size-3.5" />
          {t(`visibility.${p.visibility}`)}
        </span>
        {repo ? (
          <a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer" className="ms-auto inline-flex items-center gap-1.5 text-nq-fg-body underline-offset-4 hover:underline" data-project-repo>
            <GlobeIcon className="size-3.5" />
            GitHub
            <Ltr mono>{repo}</Ltr>
          </a>
        ) : null}
      </div>
    </header>
  )
}
