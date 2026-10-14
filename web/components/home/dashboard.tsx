"use client"

// The workspace home: greeting, five real stats, the projects grid, what needs attention, recent
// activity and this week's time. Everything is computed from existing endpoints plus
// GET /api/w/overview; nothing here is a placeholder or a made-up trend.
import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { AlertTriangleIcon, CalendarClockIcon, CheckCircle2Icon, CircleDotIcon, FolderKanbanIcon, HistoryIcon, ListChecksIcon, PlusIcon, SearchIcon, UsersIcon } from "lucide-react"

import { Attention, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, type AttentionItem } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { DashboardSkeleton } from "@/components/home/dashboard-skeleton"
import { Panel, PanelLink, StatTile } from "@/components/home/panels"
import { PersonAvatar, AvatarStack, useDirectory, type Directory } from "@/components/work/people"
import { ColorDot, solid } from "@/components/work/palette"
import { ProjectAvatar } from "@/components/work/project-avatar"
import { ProjectForm } from "@/components/work/project-form"
import { TaskSheet } from "@/components/work/task-sheet"
import { TimePanel } from "@/components/home/time-panel"
import { useActivitySentence } from "@/components/work/activity-feed"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { useTimesheet } from "@/lib/time"
import { formatDateTime, formatDay, timeAgo } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useMe, useMembers } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { PROJECT_STATUSES, useOverview, useProjects, useWorkspaceActivity, type Activity, type Project, type Task } from "@/lib/work"

const DAY = 86_400_000

function greetingKey(): "morning" | "afternoon" | "evening" {
  const h = new Date().getHours()
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening"
}

export function HomeDashboard() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const base = `/${locale}/w/${ws.slug}`
  const me = useMe()
  const meId = me.data ? String(me.data.id) : undefined
  const dir = useDirectory(meId)
  const [creating, setCreating] = useState(false)
  // Tasks open in their side-over right here; the dashboard never navigates away for one.
  const [taskKey, setTaskKey] = useState<string | null>(null)

  const projects = useProjects(ws.id)
  const overview = useOverview(ws.id)
  const members = useMembers(ws.id)
  const mine = useSWR<{ tasks: Task[] | null }>(
    meId ? [`/api/w/tasks?assignee=${encodeURIComponent(meId)}&limit=200`, ws.id] : null,
    ([p, id]: [string, string]) => api<{ tasks: Task[] | null }>(p, { workspaceId: id }),
  )

  const list = useMemo(() => projects.data?.projects ?? [], [projects.data])
  const open = useMemo(() => (mine.data?.tasks ?? []).filter((x) => !x.completed_at), [mine.data])
  const now = Date.now()
  const myOverdue = open.filter((x) => x.due_at && new Date(x.due_at).getTime() < now).length
  const myDueSoon = open.filter((x) => x.due_at && new Date(x.due_at).getTime() >= now && new Date(x.due_at).getTime() < now + 7 * DAY).length
  const activeCount = list.filter((p) => p.status === "active").length
  const teamCount = (members.data?.members ?? []).filter((m) => m.status === "active").length
  const ov = overview.data
  const name = me.data ? me.data.email.split("@")[0] : ""
  const loadingStats = projects.isLoading || overview.isLoading
  // The panels' own queries, on the same SWR keys (no extra requests), so the page shows whole.
  const showActivity = ws.can("activity:read")
  const showTime = ws.can("time:track")
  const activity = useWorkspaceActivity(ws.id, showActivity)
  const sheet = useTimesheet(showTime ? ws.id : "")
  const settled = (q: { data?: unknown; error?: unknown }) => q.data !== undefined || !!q.error
  // One shimmer of the whole page until everything it shows has arrived (or failed).
  const ready =
    settled(me) &&
    settled(projects) &&
    settled(overview) &&
    settled(members) &&
    (!meId || settled(mine)) &&
    (!showActivity || settled(activity)) &&
    (!showTime || settled(sheet))
  if (!ready) return <DashboardSkeleton panels={1 + Number(showActivity) + Number(showTime)} />

  return (
    <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-6 px-4 py-6 sm:px-6" data-home>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-words text-h2 font-semibold" data-greeting>
            {t(`home.greeting.${greetingKey()}`, { name })}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("home.subtitle")}</p>
        </div>
        {ws.can("projects:create") ? (
          <Button variant="primary" onClick={() => setCreating(true)} data-new-project>
            <PlusIcon />
            {t("home.newProject")}
          </Button>
        ) : null}
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" data-stats>
        <StatTile
          icon={<FolderKanbanIcon />}
          label={t("home.stat.activeProjects")}
          value={loadingStats ? "—" : activeCount}
          sub={t("home.stat.activeProjectsSub", { n: list.length })}
          href={`${base}/projects`}
          data-stat="projects"
        />
        <StatTile
          icon={<CheckCircle2Icon />}
          label={t("home.stat.completed")}
          value={ov ? ov.completed_total : "—"}
          sub={t("home.stat.completedSub", { n: ov?.completed_week ?? 0 })}
          data-stat="completed"
        />
        <StatTile
          icon={<AlertTriangleIcon />}
          tone={ov && ov.overdue > 0 ? "danger" : undefined}
          label={t("home.stat.overdue")}
          value={ov ? ov.overdue : "—"}
          sub={ov && ov.overdue === 0 ? t("home.stat.overdueNone") : t("home.stat.overdueMine", { n: myOverdue })}
          data-stat="overdue"
        />
        <StatTile
          icon={<ListChecksIcon />}
          label={t("home.stat.myTasks")}
          value={mine.data ? open.length : "—"}
          sub={myDueSoon ? t("home.stat.myTasksSub", { n: myDueSoon }) : t("home.stat.myTasksNone")}
          data-stat="mine"
        />
        <StatTile
          icon={<UsersIcon />}
          label={t("home.stat.team")}
          value={members.data ? teamCount : "—"}
          sub={t("home.stat.teamSub")}
          href={`${base}/members`}
          className="col-span-2 sm:col-span-1"
          data-stat="team"
        />
      </div>

      <ProjectsPanel projects={list} loading={projects.isLoading} memberIds={ov?.project_members ?? {}} dir={dir} base={base} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AttentionPanel onOpen={setTaskKey} />
        {showActivity ? <ActivityPanel dir={dir} base={base} onOpen={setTaskKey} /> : null}
        {showTime ? <TimePanel base={base} dir={dir} meId={meId} /> : null}
      </div>

      <TaskSheet
        taskKey={taskKey}
        onClose={() => setTaskKey(null)}
        onOpen={setTaskKey}
        onChanged={() => {
          void overview.mutate()
          void mine.mutate()
          void projects.mutate()
        }}
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("project.new")}</DialogTitle>
            <DialogDescription>{t("project.newHint")}</DialogDescription>
          </DialogHeader>
          <ProjectForm
            onCancel={() => setCreating(false)}
            onSaved={(p) => {
              setCreating(false)
              void projects.mutate()
              router.push(`${base}/projects/${p.id}/board`)
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── projects ──────────────────────────────────────────────────────────────

function ProjectsPanel({ projects, loading, memberIds, dir, base }: { projects: Project[]; loading: boolean; memberIds: Record<string, string[]>; dir: Directory; base: string }) {
  const { t } = useTranslations()
  const [status, setStatus] = useState<string>("all")
  const [q, setQ] = useState("")

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const p of projects) c[p.status] = (c[p.status] ?? 0) + 1
    return c
  }, [projects])
  const chips = [["all", t("home.projects.all"), projects.length] as const, ...PROJECT_STATUSES.filter((s) => counts[s]).map((s) => [s, t(`projectStatus.${s}`), counts[s]] as const)]
  // Most recently active first; a project with no activity yet falls back to when it was last edited.
  const last = (p: Project) => p.last_activity_at ?? p.updated_at
  const shown = [...projects]
    .sort((a, b) => Date.parse(last(b)) - Date.parse(last(a)))
    .filter((p) => status === "all" || p.status === status)
    .filter((p) => !q.trim() || `${p.name} ${p.client_name ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 8)

  return (
    // No panel frame or title: the filters and the cards sit straight on the page, like the stat tiles above.
    <section className="flex min-w-0 flex-col" aria-label={t("home.projects.title")} data-panel="projects">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("home.projects.filterLabel")}>
          {chips.map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              aria-pressed={status === key}
              onClick={() => setStatus(key)}
              data-chip={key}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                status === key ? "border-nq-action bg-nq-action text-nq-action-fg" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {label}
              <span className="text-caption tabular-nums opacity-80">{n}</span>
            </button>
          ))}
        </div>
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <PanelLink href={`${base}/projects`}>{t("home.projects.viewAll")}</PanelLink>
          <div className="relative w-full sm:w-64">
            <SearchIcon className="pointer-events-none absolute inset-y-0 start-2.5 my-auto size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("home.projects.search")} aria-label={t("home.projects.search")} className="ps-8" />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg bg-card" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("home.projects.noMatch")}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-project-grid>
          {shown.map((p) => (
            <li key={p.id} className="min-w-0">
              <ProjectCard project={p} ids={memberIds[p.id] ?? []} dir={dir} base={base} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ProjectCard({ project: p, ids, dir, base }: { project: Project; ids: string[]; dir: Directory; base: string }) {
  const { t, locale } = useTranslations()
  const total = p.tasks.todo + p.tasks.doing + p.tasks.done
  const active = p.last_activity_at ?? p.updated_at
  const pct = total ? Math.round((p.tasks.done / total) * 100) : 0
  return (
    <Link
      href={`${base}/projects/${p.id}/board`}
      className="flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50"
      data-project-card
    >
      <div className="flex items-center gap-3">
        <ProjectAvatar project={p} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{p.name}</p>
          <p className="truncate text-caption text-muted-foreground">{p.client_name || p.description || t("home.projects.noClient")}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 text-caption">
          <span className="truncate text-muted-foreground">{total ? t("home.projects.tasksDone", { done: p.tasks.done, total }) : t("home.projects.noTasks")}</span>
          <span className="font-medium tabular-nums text-foreground">
            <Ltr>{pct}%</Ltr>
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={p.name}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: solid(p.color) }} />
        </div>
      </div>
      <div className="flex h-6 items-center justify-between gap-2">
        <AvatarStack ids={ids} dir={dir} max={4} />
        <time
          dateTime={active}
          title={formatDateTime(active, locale)}
          className="ms-auto inline-flex min-w-0 items-center gap-1 text-caption text-muted-foreground"
          data-last-activity
        >
          <HistoryIcon className="size-3.5 shrink-0" />
          <span className="truncate">{t("home.projects.lastActivity", { when: timeAgo(active, locale) })}</span>
        </time>
        <span className="shrink-0 text-caption text-muted-foreground">· {t(`projectStatus.${p.status}`)}</span>
      </div>
    </Link>
  )
}

// ── needs attention ───────────────────────────────────────────────────────

function AttentionPanel({ onOpen }: { onOpen: (key: string) => void }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const ov = useOverview(ws.id)
  const items: AttentionItem[] = (ov.data?.attention ?? []).map((x) => ({
    id: x.id,
    title: x.title,
    description: (
      <span className="flex min-w-0 items-center gap-1.5">
        <ColorDot color={x.project_color} className="shrink-0" />
        <Ltr mono>{x.key}</Ltr>
        <span className="truncate">· {x.project_name}</span>
      </span>
    ),
    tone: x.overdue ? "danger" : x.due_at ? "warning" : x.priority === "urgent" || x.priority === "high" ? "info" : "neutral",
    icon: x.overdue ? AlertTriangleIcon : x.due_at ? CalendarClockIcon : CircleDotIcon,
    time: x.overdue ? t("home.attention.overdue") : x.due_at ? t("home.attention.due", { date: formatDay(x.due_at, locale, "short") }) : t(`priority.${x.priority}`),
    dateTime: x.due_at ?? undefined,
    onSelect: () => onOpen(x.key),
  }))
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-4" data-panel="attention">
      <Attention
        items={items}
        title={t("home.attention.title")}
        headingLevel={2}
        max={6}
        loading={ov.isLoading}
        empty={<p className="py-6 text-center text-sm text-muted-foreground">{t("home.attention.empty")}</p>}
      />
    </div>
  )
}

// ── recent activity ───────────────────────────────────────────────────────

function ActivityPanel({ dir, base, onOpen }: { dir: Directory; base: string; onOpen: (key: string) => void }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const activity = useWorkspaceActivity(ws.id, true)
  const sentence = useActivitySentence(dir, true)
  const items: Activity[] = (activity.data?.activity ?? []).slice(0, 6)
  return (
    <Panel title={t("home.activity.title")} action={<PanelLink href={`${base}/projects`}>{t("home.activity.viewAll")}</PanelLink>} data-panel="activity">
      {items.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-6 text-center text-sm text-muted-foreground">{activity.isLoading ? "…" : t("activity.empty")}</p>
      ) : (
        <ol className="-my-2 divide-y divide-line">
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-3 py-2.5 text-sm">
              <PersonAvatar id={a.actor_id} dir={dir} className="mt-0.5 shrink-0" />
              <p className="min-w-0 flex-1 text-nq-fg-body [overflow-wrap:anywhere]">
                <span className="font-medium text-foreground" dir="ltr">
                  {dir.name(a.actor_id).split("@")[0]}
                </span>{" "}
                <Linked text={sentence(a)} taskKey={typeof a.changes.key === "string" && a.task_id ? a.changes.key : ""} onOpen={onOpen} />
              </p>
              <time className="shrink-0 pt-0.5 text-caption text-muted-foreground" dateTime={a.created_at}>
                <Ltr>{timeAgo(a.created_at, locale)}</Ltr>
              </time>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

/** The sentence with its task key turned into a button that opens the task's side-over. */
function Linked({ text, taskKey, onOpen }: { text: string; taskKey: string; onOpen: (key: string) => void }) {
  const at = taskKey ? text.indexOf(taskKey) : -1
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <button
        type="button"
        onClick={() => onOpen(taskKey)}
        dir="ltr"
        className="rounded-sm font-mono text-[0.92em] font-medium text-nq-accent-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-nq-focus"
        data-activity-task={taskKey}
      >
        {taskKey}
      </button>
      {text.slice(at + taskKey.length)}
    </>
  )
}
