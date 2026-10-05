"use client"

import Link from "next/link"
import { AlertTriangleIcon, CalendarClockIcon, CheckCircle2Icon, ClockIcon, FolderKanbanIcon, InboxIcon } from "lucide-react"

import { Attention, type AttentionItem } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { DashboardSkeleton } from "@/components/home/dashboard-skeleton"
import { Panel, PanelLink, StatTile } from "@/components/home/panels"
import { PortalActions } from "@/components/portal/file-issue-dialog"
import { PortalEmpty, WeeksChart } from "@/components/portal/portal-bits"
import { ErrorState } from "@/components/states"
import { solid } from "@/components/work/palette"
import { ProjectAvatar } from "@/components/work/project-avatar"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { formatDay, timeAgo } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { hours, usePortalOverview, type PortalActivityItem, type PortalProject } from "@/lib/portal"
import { useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"

/*
The customer's dashboard (MH-1167): the workspace home, scoped to the customer's own projects
(GET /api/w/portal/overview). Stats, the projects, what's due, the hours and recent activity —
aggregates only; task titles only from projects that share their board.
*/

function greetingKey(): "morning" | "afternoon" | "evening" {
  const h = new Date().getHours()
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening"
}

export default function PortalDashboard() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const base = `/${locale}/w/${ws.slug}/portal`
  useDocumentTitle(`${t("portal.nav.dashboard")} · ${ws.summary.name}`)
  const me = useMe()
  const ov = usePortalOverview(ws.id)

  if (ov.error) return <ErrorState error={ov.error} />
  if (!ov.data || !me.data) return <DashboardSkeleton panels={2} />
  const o = ov.data
  const open = o.projects.filter((p) => !p.archived)
  const name = me.data.email.split("@")[0]

  return (
    <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-6 px-4 py-6 sm:px-6" data-portal-home>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-words text-h2 font-semibold">{t(`home.greeting.${greetingKey()}`, { name })}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("portal.home.subtitle")}</p>
        </div>
        <PortalActions projects={open} onFiled={() => void ov.mutate()} />
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" data-stats>
        <StatTile
          icon={<FolderKanbanIcon />}
          label={t("home.stat.activeProjects")}
          value={o.active_projects}
          sub={t("portal.home.completedProjects", { n: o.completed_projects })}
          href={`${base}/projects`}
          data-stat="projects"
        />
        <StatTile
          icon={<CheckCircle2Icon />}
          label={t("portal.home.openTasks")}
          value={o.open_tasks}
          sub={t("home.stat.completedSub", { n: o.completed_7d })}
          data-stat="tasks"
        />
        <StatTile
          icon={<AlertTriangleIcon />}
          tone={o.overdue_tasks > 0 ? "danger" : undefined}
          label={t("home.stat.overdue")}
          value={o.overdue_tasks}
          sub={o.overdue_tasks === 0 ? t("home.stat.overdueNone") : t("portal.home.overdueSub")}
          data-stat="overdue"
        />
        <StatTile
          icon={<InboxIcon />}
          label={t("nav.requests")}
          value={o.pending_requests}
          sub={t("portal.home.openIssues", { n: o.open_issues })}
          href={`${base}/requests`}
          data-stat="requests"
        />
        <StatTile
          icon={<ClockIcon />}
          label={t("portal.home.monthHours")}
          value={<Ltr>{t("portal.hoursShort", { h: hours(o.month_minutes) })}</Ltr>}
          sub={o.unpaid_invoices ? t("portal.home.unpaid", { n: o.unpaid_invoices }) : t("portal.home.monthSub")}
          href={o.unpaid_invoices ? `${base}/invoices` : `${base}/time`}
          className="col-span-2 sm:col-span-1"
          data-stat="time"
        />
      </div>

      <section className="flex min-w-0 flex-col" aria-label={t("nav.projects")} data-panel="projects">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-label font-semibold">{t("nav.projects")}</h2>
          <PanelLink href={`${base}/projects`}>{t("home.projects.viewAll")}</PanelLink>
        </div>
        {open.length === 0 ? (
          <PortalEmpty icon={<FolderKanbanIcon />} title={t("portal.noProjects")} />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-portal-projects={open.length}>
            {open.slice(0, 8).map((p) => (
              <li key={p.id} className="min-w-0">
                <ProjectCard p={p} href={`${base}/projects/${p.id}`} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DuePanel o={o} base={base} />
        <ActivityPanel items={o.activity} base={base} />
        <Panel title={t("portal.hoursByWeek")} action={<PanelLink href={`${base}/time`}>{t("portal.home.allTime")}</PanelLink>} data-panel="time">
          <WeeksChart weeks={o.weeks} />
        </Panel>
      </div>
    </div>
  )
}

function ProjectCard({ p, href }: { p: PortalProject; href: string }) {
  const { t } = useTranslations()
  const total = p.tasks.todo + p.tasks.doing + p.tasks.done
  const budget = p.budget_minutes ?? 0
  return (
    <Link href={href} className="flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50" data-portal-project={p.id}>
      <div className="flex items-center gap-3">
        <ProjectAvatar project={p} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{p.name}</p>
          <p className="truncate text-caption text-muted-foreground">{p.client_name || p.description || t(`projectStatus.${p.status}`)}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 text-caption">
          <span className="truncate text-muted-foreground">{total ? t("home.projects.tasksDone", { done: p.tasks.done, total }) : t("home.projects.noTasks")}</span>
          <span className="font-medium tabular-nums text-foreground">
            <Ltr>{p.percent_done}%</Ltr>
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent_done} aria-label={p.name}>
          <div className="h-full rounded-full" style={{ width: `${p.percent_done}%`, background: solid(p.color) }} />
        </div>
      </div>
      <div className="flex h-6 items-center justify-between gap-2 text-caption text-muted-foreground">
        <span className="tabular-nums" dir="ltr">
          {budget > 0 ? t("portal.hoursOfBudget", { used: hours(p.used_minutes), budget: hours(budget) }) : t("portal.hoursTracked", { used: hours(p.used_minutes) })}
        </span>
        <span className="shrink-0">· {t(`projectStatus.${p.status}`)}</span>
      </div>
    </Link>
  )
}

function DuePanel({ o, base }: { o: { due_tasks: { key: string; title: string; project_id: string; project: string; due_at: string; overdue: boolean }[] }; base: string }) {
  const { t, locale } = useTranslations()
  const items: AttentionItem[] = o.due_tasks.map((x) => ({
    id: x.key,
    title: x.title,
    description: (
      <span className="flex min-w-0 items-center gap-1.5">
        <Ltr mono>{x.key}</Ltr>
        <span className="truncate">· {x.project}</span>
      </span>
    ),
    tone: x.overdue ? "danger" : "warning",
    icon: x.overdue ? AlertTriangleIcon : CalendarClockIcon,
    time: x.overdue ? t("home.attention.overdue") : t("home.attention.due", { date: formatDay(x.due_at, locale, "short") }),
    dateTime: x.due_at,
    href: `${base}/projects/${x.project_id}?tab=board&task=${encodeURIComponent(x.key)}`,
  }))
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-4" data-panel="due">
      <Attention
        items={items}
        title={t("portal.home.due")}
        headingLevel={2}
        max={6}
        empty={<p className="py-6 text-center text-sm text-muted-foreground">{t("portal.home.dueNone")}</p>}
      />
    </div>
  )
}

function ActivityPanel({ items, base }: { items: PortalActivityItem[]; base: string }) {
  const { t, locale } = useTranslations()
  return (
    <Panel title={t("home.activity.title")} data-panel="activity">
      {items.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-6 text-center text-sm text-muted-foreground">{t("portal.activityEmpty")}</p>
      ) : (
        <ol className="-my-2 divide-y divide-line">
          {items.slice(0, 6).map((it, i) => {
            const tab = it.kind.startsWith("task.") ? `board&task=${encodeURIComponent(it.key)}` : it.kind === "request.filed" ? "requests" : `issues&issue=${encodeURIComponent(it.key)}`
            return (
              <li key={i} className="flex items-start gap-3 py-2.5 text-sm">
                <p className="min-w-0 flex-1 text-nq-fg-body [overflow-wrap:anywhere]">
                  {t(`portal.act.${it.kind}`, { from: it.from ?? "", to: it.to ?? "" })}{" "}
                  <Link href={`${base}/projects/${it.project_id}?tab=${tab}`} className="font-medium text-foreground hover:underline">
                    <Ltr mono>{it.key}</Ltr> {it.title}
                  </Link>
                  {it.project ? <span className="block truncate text-caption text-muted-foreground">{it.project}</span> : null}
                </p>
                <time className="shrink-0 pt-0.5 text-caption text-muted-foreground" dateTime={it.at}>
                  <Ltr>{timeAgo(it.at, locale)}</Ltr>
                </time>
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}
