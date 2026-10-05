"use client"

// The project header, shown above every project tab: a cover in the project's colour (its logo,
// blurred, when it has one), the avatar over the cover's edge, name and client, the primary
// actions (timer, new task, more) and the key facts as chips (billing, budget, dates, people,
// visibility, GitHub repository).
import Link from "next/link"
import {
  ArchiveIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ClockIcon,
  EllipsisIcon,
  EyeIcon,
  GithubIcon,
  PlayIcon,
  PlusIcon,
  SettingsIcon,
  SquareIcon,
  SquareKanbanIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react"

import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { useTimerActions } from "@/components/time/timer-bar"
import { soft, solid } from "@/components/work/palette"
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

function Chip({ icon, children, className }: { icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 text-caption whitespace-nowrap text-nq-fg-body [&_svg]:size-3.5 [&_svg]:text-muted-foreground",
        className,
      )}
    >
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
    <header className="px-4 pt-4 sm:px-6" data-project-header>
      <div className="overflow-hidden rounded-card border border-border bg-card shadow-xs">
        <div
          className="relative h-24 sm:h-28"
          style={{ background: `linear-gradient(135deg, ${soft(p.color)}, color-mix(in oklab, ${solid(p.color)} 40%, var(--card)))` }}
          data-project-cover
        >
          {p.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.avatar} alt="" aria-hidden className="absolute inset-0 size-full scale-125 object-cover opacity-50 blur-2xl" />
          ) : null}
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] bg-size-[14px_14px] opacity-60" />
          <Link
            href={`${slugBase}/projects`}
            className="absolute start-3 top-3 inline-flex items-center gap-1 rounded-full bg-background/75 px-2.5 py-1 text-caption text-muted-foreground backdrop-blur-sm hover:text-foreground"
          >
            <ChevronLeftIcon className={isRtl ? "size-3.5 rotate-180" : "size-3.5"} />
            {t("nav.projects")}
          </Link>
          <div className="absolute end-3 top-3 flex items-center gap-1.5">
            <StatusPill status={p.status} className="bg-background/75 backdrop-blur-sm" />
            {p.archived_at ? (
              <Badge variant="neutral" className="gap-1">
                <ArchiveIcon />
                {t("project.archivedBadge")}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="px-4 pb-4 sm:px-6">
          <div className="-mt-8 flex flex-wrap items-end gap-x-4 gap-y-3 sm:-mt-10">
            <ProjectAvatar project={p} className="relative size-16 rounded-xl text-lg ring-4 ring-card sm:size-20 sm:text-xl" />
            <div className="min-w-0 flex-1 basis-60">
              <h1 className="text-h2 min-w-0 text-2xl break-words" dir="auto">
                {p.name}
              </h1>
              {p.client_name ? (
                p.client_id ? (
                  <Link href={`${slugBase}/clients/${p.client_id}`} className="text-sm font-medium text-nq-fg-body underline-offset-4 hover:underline">
                    {p.client_name}
                  </Link>
                ) : (
                  <p className="text-sm font-medium text-nq-fg-body">{p.client_name}</p>
                )
              ) : null}
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
                      <SquareKanbanIcon />
                      {t("projectTab.issues")}
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

          {p.description ? (
            <p className="mt-3 line-clamp-2 max-w-3xl text-sm text-muted-foreground" dir="auto">
              {p.description}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
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
                  {p.starts_on && p.ends_on
                    ? `${formatDay(p.starts_on, locale, "short")} → ${formatDay(p.ends_on, locale, "short")}`
                    : formatDay(p.starts_on ?? p.ends_on, locale, "short")}
                </Ltr>
              </Chip>
            ) : null}
            <Chip icon={<UsersIcon />}>{t("po.members", { n: String(p.member_count) })}</Chip>
            <Chip icon={<EyeIcon />}>{t(`visibility.${p.visibility}`)}</Chip>
            {repo ? (
              <a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer" data-project-repo>
                <Chip icon={<GithubIcon />} className="hover:border-nq-action">
                  <Ltr mono>{repo}</Ltr>
                </Chip>
              </a>
            ) : null}
            <span className="ms-auto text-caption text-muted-foreground">
              {t("po.updated")} <Ltr>{timeAgo(p.updated_at, locale)}</Ltr>
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}
