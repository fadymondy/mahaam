"use client"

import { useState, type FormEvent, type ReactNode } from "react"
import Link from "next/link"
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  ActivityIcon,
  CalendarIcon,
  CheckCircle2Icon,
  CheckIcon,
  CheckSquareIcon,
  ChevronLeftIcon,
  CircleDotIcon,
  ClockIcon,
  InboxIcon,
  KanbanSquareIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MessageSquareIcon,
  ReceiptTextIcon,
  RotateCcwIcon,
  SendIcon,
  SquareIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Ltr } from "@/components/copy-field"
import { NotFoundState } from "@/components/not-found-state"
import { ErrorState, LoadingRows } from "@/components/states"
import {
  AuthImage,
  Meter,
  NewRequestDialog,
  PersonBadge,
  PortalEmpty,
  ProgressRing,
  RequestStateBadge,
  ScrollTabs,
  StatTile,
  WeeksChart,
} from "@/components/portal/portal-bits"
import { PriorityIcon } from "@/components/work/fields"
import { IssuePriorityMark, IssueTypeIcon } from "@/components/work/issues/issue-bits"
import { ColorChip, ColorDot } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { ApiError } from "@/lib/api"
import { formatDay, isOverdue, money, timeAgo } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import {
  hours,
  portalApi,
  usePortalActivity,
  usePortalBoard,
  usePortalIssue,
  usePortalProject,
  usePortalTask,
  usePortalTime,
  type CustomerRequest,
  type PortalIssue,
  type PortalProjectPage,
  type PortalTask,
} from "@/lib/portal"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"
import { ISSUE_PRIORITIES, errorText, type Priority } from "@/lib/work"

/*
One project as its customer sees it (roadmap 5, extended in P8.5): header with progress, and
horizontal tabs (?tab=) — Overview · Board · Issues · Requests · Time · Invoices · Activity. What
appears follows the project's "Share with customer" settings (the API enforces them: the board and
task detail are 404 when not shared, the team and money budget are simply absent). Tasks are read
only and never show the team's comments; issues keep the customer's four actions (comment, accept,
reopen, re-prioritise).
*/
const TABS = ["overview", "board", "issues", "requests", "time", "invoices", "activity"] as const
type Tab = (typeof TABS)[number]

export default function PortalProjectPage() {
  const { id } = useParams<{ id: string }>()
  const search = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { t, locale, isRtl } = useTranslations()
  const ws = useWorkspace()
  const page = usePortalProject(ws.id, id)
  const p = page.data
  const [requesting, setRequesting] = useState(false)
  const back = `/${locale}/w/${ws.slug}/portal`
  useDocumentTitle(`${p?.name ?? t("portal.title")} · ${ws.summary.name}`)

  const setParam = (k: string, v: string | null) => {
    const q = new URLSearchParams(search.toString())
    if (v) q.set(k, v)
    else q.delete(k)
    router.replace(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false })
  }
  const rawTab = (search.get("tab") ?? "overview") as Tab
  const issueKey = search.get("issue")
  const taskKey = search.get("task")

  if (page.error) {
    return page.error instanceof ApiError && page.error.status === 404 ? (
      <NotFoundState title={t("portal.notFound")} body={t("portal.notFoundBody")} backHref={back} backLabel={t("portal.back")} />
    ) : (
      <ErrorState error={page.error} />
    )
  }
  if (!p) return <LoadingRows rows={6} />

  const tabs = TABS.filter((x) => x !== "board" || p.share.board)
  const tab: Tab = tabs.includes(rawTab) ? rawTab : "overview"
  const counts: Partial<Record<Tab, number>> = {
    board: p.columns.reduce((n, c) => n + c.task_count, 0),
    issues: p.issues.length,
    requests: p.requests.length,
    invoices: p.invoices_visible ? p.invoices.length : undefined,
  }
  const icons: Record<Tab, ReactNode> = {
    overview: <LayoutDashboardIcon className="size-4" />,
    board: <KanbanSquareIcon className="size-4" />,
    issues: <CircleDotIcon className="size-4" />,
    requests: <InboxIcon className="size-4" />,
    time: <ClockIcon className="size-4" />,
    invoices: <ReceiptTextIcon className="size-4" />,
    activity: <ActivityIcon className="size-4" />,
  }
  const openIssue = (key: string) => setParam("issue", key)
  const openTask = (key: string) => setParam("task", key)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6" data-portal-project-page={p.id}>
      <Link href={back} className="inline-flex items-center gap-1 text-xs text-grid-muted hover:text-grid-fg">
        <ChevronLeftIcon className={isRtl ? "size-3.5 rotate-180" : "size-3.5"} />
        {t("portal.back")}
      </Link>

      <header className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-5 sm:flex-row sm:items-center">
        <ProgressRing value={p.percent_done} label={t("portal.progress")} size={72} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            <ColorDot color={p.color} />
            <span className="min-w-0 break-words">{p.name}</span>
            <Badge variant="secondary">{p.archived ? t("portal.archived") : t(`projectStatus.${p.status}`)}</Badge>
          </h1>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-grid-muted">
            {p.client_name ? (
              <span className="flex items-center gap-1.5">
                <UsersIcon className="size-3.5" /> {p.client_name}
              </span>
            ) : null}
            <span className="flex items-center gap-1.5">
              <CalendarIcon className="size-3.5" />
              {p.starts_on || p.ends_on ? `${formatDay(p.starts_on, locale)} – ${formatDay(p.ends_on, locale)}` : t("portal.noDates")}
            </span>
            <span>{t("portal.tasks", { todo: p.tasks.todo, doing: p.tasks.doing, done: p.tasks.done })}</span>
          </p>
        </div>
        {!p.archived ? (
          <Button onClick={() => setRequesting(true)} className="w-full sm:w-auto" data-action="new-request">
            <InboxIcon /> {t("portal.newRequest")}
          </Button>
        ) : null}
      </header>

      <ScrollTabs
        value={tab}
        onChange={(v) => setParam("tab", v === "overview" ? null : v)}
        label={p.name}
        items={tabs.map((x) => ({ value: x, label: t(`portal.tab.${x}`), count: counts[x], icon: icons[x] }))}
      />

      <div role="tabpanel" data-tab-panel={tab}>
        {tab === "overview" ? <Overview p={p} onTab={(v) => setParam("tab", v)} /> : null}
        {tab === "board" ? <Board projectId={p.id} onOpen={openTask} /> : null}
        {tab === "issues" ? <Issues p={p} onOpen={openIssue} /> : null}
        {tab === "requests" ? (
          <Requests p={p} onOpenIssue={openIssue} onOpenTask={p.share.board ? openTask : undefined} onNew={() => setRequesting(true)} />
        ) : null}
        {tab === "time" ? <Time projectId={p.id} board={p.share.board} onOpen={openTask} /> : null}
        {tab === "invoices" ? <Invoices p={p} /> : null}
        {tab === "activity" ? <Activity projectId={p.id} onOpenIssue={openIssue} onOpenTask={p.share.board ? openTask : undefined} /> : null}
      </div>

      {issueKey ? <IssueSheet issueKey={issueKey} onClose={() => setParam("issue", null)} onChanged={() => page.mutate()} /> : null}
      {taskKey && p.share.board ? <TaskSheet projectId={p.id} taskKey={taskKey} onClose={() => setParam("task", null)} /> : null}
      {requesting ? (
        <NewRequestDialog
          projects={[{ id: p.id, name: p.name }]}
          defaultProject={p.id}
          onClose={() => setRequesting(false)}
          onFiled={() => {
            setRequesting(false)
            setParam("tab", "requests")
            page.mutate()
          }}
        />
      ) : null}
    </div>
  )
}

function Section({ title, icon, action, children }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-card">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        {icon ? <span className="text-grid-muted [&_svg]:size-4">{icon}</span> : null}
        <h2 className="flex-1 text-sm font-medium">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Overview({ p, onTab }: { p: PortalProjectPage; onTab: (t: string) => void }) {
  const { t, locale } = useTranslations()
  const budget = p.budget_minutes ?? 0
  const used = hours(p.used_minutes)
  const totalTasks = p.tasks.todo + p.tasks.doing + p.tasks.done
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t("portal.progress")} icon={<CheckCircle2Icon className="size-3.5" />} value={t("portal.done", { percent: p.percent_done })}>
          <Meter value={p.percent_done} label={t("portal.progress")} />
          <p className="text-xs text-grid-muted">{t("portal.tasksDone", { done: p.tasks.done, total: totalTasks })}</p>
        </StatTile>
        <StatTile
          label={t("portal.budget")}
          icon={<ClockIcon className="size-3.5" />}
          value={<Ltr>{budget > 0 ? t("portal.hoursOfBudget", { used, budget: hours(budget) }) : t("portal.hoursTracked", { used })}</Ltr>}
        >
          {budget > 0 ? <Meter value={(p.used_minutes / budget) * 100} warn={p.used_minutes > budget} label={t("portal.budget")} /> : null}
          {budget > 0 && p.used_minutes > budget ? <p className="text-xs text-destructive">{t("portal.overBudget")}</p> : null}
        </StatTile>
        <button type="button" onClick={() => onTab("issues")} className="h-full rounded-xl text-start outline-none focus-visible:ring-2 focus-visible:ring-grid-action">
          <StatTile label={t("portal.tab.issues")} icon={<CircleDotIcon className="size-3.5" />} value={p.open_issues}>
            <p className="text-xs text-grid-muted">{t("portal.openIssues", { count: p.open_issues })}</p>
          </StatTile>
        </button>
        <button type="button" onClick={() => onTab("requests")} className="h-full rounded-xl text-start outline-none focus-visible:ring-2 focus-visible:ring-grid-action">
          <StatTile label={t("portal.tab.requests")} icon={<InboxIcon className="size-3.5" />} value={p.pending_requests}>
            <p className="text-xs text-grid-muted">{t("portal.pendingRequests", { count: p.pending_requests })}</p>
          </StatTile>
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title={t("portal.about")} icon={<LayoutDashboardIcon />}>
            {p.description ? (
              <p className="text-sm whitespace-pre-wrap" dir="auto">
                {p.description}
              </p>
            ) : (
              <p className="text-sm text-grid-muted">{t("portal.noDescription")}</p>
            )}
            {p.budget_amount_minor != null ? (
              <p className="mt-3 flex items-center gap-2 text-sm">
                <WalletIcon className="size-4 text-grid-muted" />
                {t("portal.moneyBudget")}:{" "}
                <span className="font-medium tabular-nums" dir="ltr">
                  {money(p.budget_amount_minor, p.budget_currency, locale)}
                </span>
              </p>
            ) : null}
          </Section>

          {p.share.board && p.columns.length ? (
            <Section
              title={t("portal.milestones")}
              icon={<ListChecksIcon />}
              action={
                <Button size="sm" variant="ghost" onClick={() => onTab("board")}>
                  {t("portal.openBoard")}
                </Button>
              }
            >
              <ul className="space-y-3">
                {p.columns.map((c) => (
                  <li key={c.id} className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <ColorDot color={c.color} />
                      <span className="flex-1">{c.name}</span>
                      <span className="text-xs text-grid-muted tabular-nums">{c.task_count}</span>
                    </div>
                    <Meter value={totalTasks ? (c.task_count / totalTasks) * 100 : 0} label={c.name} />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title={t("portal.hoursByWeek")} icon={<ClockIcon />}>
            <p className="mb-3 text-xs text-grid-muted">{t("portal.hoursByWeekHint")}</p>
            <WeeksChart weeks={p.weeks} />
          </Section>
        </div>

        <div className="space-y-6">
          {p.share.team ? (
            <Section title={t("portal.teamTitle")} icon={<UsersIcon />}>
              {p.team.length === 0 ? (
                <p className="text-sm text-grid-muted">{t("portal.noTeam")}</p>
              ) : (
                <ul className="space-y-2.5" data-portal-team={p.team.length}>
                  {p.team.map((m, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <PersonBadge name={m.name} initials={m.initials} />
                      <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                      {m.role === "lead" ? <Badge variant="secondary">{t("portal.lead")}</Badge> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ) : null}
          <Section title={t("portal.activity")} icon={<ActivityIcon />}>
            <ul className="space-y-1.5 text-sm">
              <li className="flex items-center gap-2">
                <CheckCircle2Icon className="size-4 text-grid-action" /> {t("portal.completed7", { count: p.completed_7d })}
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2Icon className="size-4 text-grid-muted" /> {t("portal.completed30", { count: p.completed_30d })}
              </li>
            </ul>
            <Button size="sm" variant="ghost" className="mt-2 -ms-2" onClick={() => onTab("activity")}>
              {t("portal.seeActivity")}
            </Button>
          </Section>
        </div>
      </div>
    </div>
  )
}

function Board({ projectId, onOpen }: { projectId: string; onOpen: (key: string) => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const board = usePortalBoard(ws.id, projectId)
  if (board.error) return <ErrorState error={board.error} />
  if (!board.data) return <LoadingRows rows={4} />
  const { columns, tasks } = board.data
  if (tasks.length === 0) return <PortalEmpty icon={<KanbanSquareIcon />} title={t("portal.board.empty")} body={t("portal.board.emptyBody")} />
  return (
    <div className="space-y-2">
      <p className="text-xs text-grid-muted">{t("portal.board.readOnly")}</p>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0" data-portal-board={tasks.length}>
        {columns.map((c) => {
          const col = tasks.filter((x) => x.status_id === c.id)
          return (
            <section key={c.id} className="flex w-72 shrink-0 flex-col border border-line bg-grid-soft" aria-label={c.name} data-category={c.category}>
              <header className="flex items-center gap-2 border-b border-line px-3 py-2">
                <ColorDot color={c.color} />
                <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</h3>
                <span className="text-xs text-grid-muted">
                  <Ltr>{col.length}</Ltr>
                </span>
              </header>
              <div className="flex min-h-24 flex-col gap-2 p-2">
                {col.map((task) => (
                  <TaskCard key={task.key} task={task} onOpen={() => onOpen(task.key)} />
                ))}
                {col.length === 0 ? <p className="px-1 py-4 text-center text-xs text-grid-muted">{t("board.emptyColumn")}</p> : null}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** The staff board's card visuals, read-only (no drag, no timer, no comment count). */
function TaskCard({ task, onOpen }: { task: PortalTask; onOpen: () => void }) {
  const { t, locale } = useTranslations()
  const overdue = isOverdue(task.due_at, task.completed_at)
  return (
    <button
      type="button"
      onClick={onOpen}
      data-task-key={task.key}
      className="w-full border border-line bg-grid-card p-3 text-start transition-colors outline-none hover:border-grid-muted focus-visible:ring-2 focus-visible:ring-grid-action"
    >
      <span className="flex items-center gap-2 text-xs text-grid-muted">
        <Ltr mono>{task.key}</Ltr>
        {task.priority !== "none" ? <PriorityIcon priority={task.priority as Priority} /> : null}
      </span>
      <span className={cn("mt-1 block text-sm font-medium break-words text-grid-fg", task.completed_at && "text-grid-muted line-through")}>{task.title}</span>
      {task.labels.length ? (
        <span className="mt-2 flex flex-wrap gap-1">
          {task.labels.map((l) => (
            <ColorChip key={l.name} color={l.color}>
              {l.name}
            </ColorChip>
          ))}
        </span>
      ) : null}
      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-grid-muted">
        {task.due_at ? (
          <span className={cn("flex items-center gap-1", overdue && "text-grid-danger-text")}>
            <CalendarIcon className="size-3" />
            <Ltr>{formatDay(task.due_at, locale, "short")}</Ltr>
          </span>
        ) : null}
        {task.checklist_total ? (
          <span className="flex items-center gap-1" aria-label={t("task.checklistProgress", { done: task.checklist_done, total: task.checklist_total })}>
            <CheckSquareIcon className="size-3" />
            <Ltr>
              {task.checklist_done}/{task.checklist_total}
            </Ltr>
          </span>
        ) : null}
        <span className="ms-auto flex -space-x-1.5 rtl:space-x-reverse">
          {task.assignees.slice(0, 3).map((a, i) => (
            <PersonBadge key={i} name={a.name} initials={a.initials} size="sm" ring />
          ))}
        </span>
      </span>
    </button>
  )
}

function TaskSheet({ projectId, taskKey, onClose }: { projectId: string; taskKey: string; onClose: () => void }) {
  const { t, locale, isRtl } = useTranslations()
  const ws = useWorkspace()
  const task = usePortalTask(ws.id, projectId, taskKey)
  const d = task.data
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={isRtl ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-lg" data-portal-task={taskKey}>
        {!d ? (
          <div className="p-5">
            {task.error ? (
              task.error instanceof ApiError && task.error.status === 404 ? (
                <p className="text-sm text-grid-muted">{t("portal.task.notFound")}</p>
              ) : (
                <ErrorState error={task.error} />
              )
            ) : (
              <LoadingRows rows={4} />
            )}
          </div>
        ) : (
          <div className="space-y-5 p-5">
            <div className="space-y-2 pe-8">
              <span className="flex items-center gap-2 text-xs text-grid-muted">
                <Ltr mono>{d.key}</Ltr>
                <Badge variant="outline">{t("portal.task.readOnly")}</Badge>
              </span>
              <SheetTitle className="text-lg leading-snug">{d.title}</SheetTitle>
              <SheetDescription className="sr-only">{t("portal.task.readOnly")}</SheetDescription>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-grid-muted">{t("portal.task.column")}</dt>
              <dd>
                <Badge variant="secondary">{d.status_name}</Badge>
              </dd>
              <dt className="text-grid-muted">{t("portal.priority")}</dt>
              <dd className="flex items-center gap-1.5">
                <PriorityIcon priority={d.priority as Priority} /> {t(`priority.${d.priority}`)}
              </dd>
              <dt className="text-grid-muted">{t("portal.task.due")}</dt>
              <dd className={cn(isOverdue(d.due_at, d.completed_at) && "text-grid-danger-text")}>{d.due_at ? formatDay(d.due_at, locale) : "—"}</dd>
              <dt className="text-grid-muted">{t("portal.task.assignees")}</dt>
              <dd className="flex flex-wrap gap-2">
                {d.assignees.length === 0
                  ? "—"
                  : d.assignees.map((a, i) => (
                      <span key={i} className="flex items-center gap-1.5">
                        <PersonBadge name={a.name} initials={a.initials} size="sm" /> {a.name}
                      </span>
                    ))}
              </dd>
              {d.labels.length ? (
                <>
                  <dt className="text-grid-muted">{t("portal.task.labels")}</dt>
                  <dd className="flex flex-wrap gap-1">
                    {d.labels.map((l) => (
                      <ColorChip key={l.name} color={l.color}>
                        {l.name}
                      </ColorChip>
                    ))}
                  </dd>
                </>
              ) : null}
            </dl>
            <section className="space-y-1.5">
              <h3 className="grid-micro">{t("portal.task.description")}</h3>
              {d.description ? (
                <p className="text-sm whitespace-pre-wrap" dir="auto">
                  {d.description}
                </p>
              ) : (
                <p className="text-sm text-grid-muted">{t("portal.task.noDescription")}</p>
              )}
            </section>
            {d.checklist.length ? (
              <section className="space-y-2">
                <h3 className="grid-micro flex items-center gap-2">
                  {t("portal.task.checklist")}
                  <span className="tabular-nums">
                    <Ltr>
                      {d.checklist_done}/{d.checklist_total}
                    </Ltr>
                  </span>
                </h3>
                <Meter value={(d.checklist_done / Math.max(1, d.checklist_total)) * 100} label={t("portal.task.checklist")} />
                <ul className="space-y-1.5">
                  {d.checklist.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      {c.done ? <CheckSquareIcon className="mt-0.5 size-4 shrink-0 text-grid-action" /> : <SquareIcon className="mt-0.5 size-4 shrink-0 text-grid-muted" />}
                      <span className={cn(c.done && "text-grid-muted line-through")} dir="auto">
                        {c.title}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <p className="text-xs text-grid-muted">{t("portal.task.updated", { ago: timeAgo(d.updated_at, locale) })}</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Issues({ p, onOpen }: { p: PortalProjectPage; onOpen: (key: string) => void }) {
  const { t } = useTranslations()
  const [filter, setFilter] = useState<"open" | "closed" | "all">("open")
  const list = p.issues.filter((i) => filter === "all" || (filter === "open" ? i.state === "open" : i.state !== "open"))
  if (p.issues.length === 0) return <PortalEmpty icon={<CircleDotIcon />} title={t("portal.noIssues")} body={t("portal.noIssuesBody")} />
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(["open", "closed", "all"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "secondary" : "ghost"} onClick={() => setFilter(f)}>
            {t(`portal.issueFilter.${f}`)}
          </Button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-grid-muted">{t("portal.noIssuesHere")}</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card" data-portal-issues={list.length}>
          {list.map((i) => (
            <IssueRow key={i.key} i={i} onOpen={() => onOpen(i.key)} />
          ))}
        </ul>
      )}
    </div>
  )
}

function IssueRow({ i, onOpen }: { i: PortalIssue; onOpen: () => void }) {
  const { t, locale } = useTranslations()
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-muted/50" data-portal-issue={i.key}>
        <IssueTypeIcon type={i.issue_type} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <code className="text-xs text-grid-muted" dir="ltr">
              {i.key}
            </code>
            <span className="truncate font-medium">{i.title}</span>
            {i.mine ? <Badge variant="outline">{t("portal.mine")}</Badge> : null}
          </span>
          <span className="flex items-center gap-3 text-xs text-grid-muted">
            {timeAgo(i.updated_at, locale)}
            {i.comment_count ? (
              <span className="flex items-center gap-1">
                <MessageSquareIcon className="size-3" />
                <Ltr>{i.comment_count}</Ltr>
              </span>
            ) : null}
          </span>
        </span>
        <IssuePriorityMark priority={i.priority} />
        <Badge variant={i.can_accept ? "default" : "secondary"}>{t(`issues.status.${i.status}`)}</Badge>
      </button>
    </li>
  )
}

function Requests({
  p,
  onOpenIssue,
  onOpenTask,
  onNew,
}: {
  p: PortalProjectPage
  onOpenIssue: (key: string) => void
  onOpenTask?: (key: string) => void
  onNew: () => void
}) {
  const { t } = useTranslations()
  if (p.requests.length === 0) {
    return (
      <PortalEmpty
        icon={<InboxIcon />}
        title={t("portal.noRequestsTitle")}
        body={t("portal.noRequests")}
        action={
          !p.archived ? (
            <Button size="sm" className="mt-2" onClick={onNew}>
              <InboxIcon /> {t("portal.newRequest")}
            </Button>
          ) : null
        }
      />
    )
  }
  return (
    <ul className="space-y-3" data-portal-requests={p.requests.length}>
      {p.requests.map((r) => (
        <RequestCard key={r.key} r={r} onOpenIssue={onOpenIssue} onOpenTask={onOpenTask} />
      ))}
    </ul>
  )
}

function RequestCard({ r, onOpenIssue, onOpenTask }: { r: CustomerRequest; onOpenIssue: (key: string) => void; onOpenTask?: (key: string) => void }) {
  const { t, locale } = useTranslations()
  return (
    <li className="rounded-xl border border-line bg-card p-4" data-request={r.key}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <code className="text-xs text-grid-muted" dir="ltr">
              {r.key}
            </code>
            <span className="font-medium">{r.title}</span>
          </p>
          <p className="text-xs text-grid-muted">
            {t(`portal.request.kind.${r.kind}`)} · {formatDay(r.created_at, locale)}
            {r.desired_on ? ` · ${t("portal.request.wantedBy", { date: formatDay(r.desired_on, locale) })}` : ""}
          </p>
        </div>
        <span className="flex items-center gap-2">
          {r.state === "accepted" ? <Badge variant="secondary">{t(`issues.status.${r.status}`)}</Badge> : null}
          <RequestStateBadge state={r.state} />
        </span>
      </div>
      {r.body ? (
        <p className="mt-2 text-sm whitespace-pre-wrap text-grid-muted" dir="auto">
          {r.body}
        </p>
      ) : null}
      {r.reply ? (
        <div className="mt-3 rounded-md border border-line bg-muted/40 px-3 py-2 text-sm">
          <p className="text-xs font-medium text-grid-muted">{r.state === "declined" ? t("portal.request.reason") : t("portal.request.reply")}</p>
          <p className="whitespace-pre-wrap" dir="auto">
            {r.reply}
          </p>
        </div>
      ) : null}
      {r.state === "accepted" ? (
        <Button size="sm" variant="ghost" className="mt-2 -ms-2" onClick={() => onOpenIssue(r.key)}>
          {t("portal.request.openIssue")}
        </Button>
      ) : null}
      {r.state === "converted" && r.task_key && onOpenTask ? (
        <Button size="sm" variant="ghost" className="mt-2 -ms-2" onClick={() => onOpenTask(r.task_key!)}>
          {t("portal.request.openTask", { task: r.task_key })}
        </Button>
      ) : null}
    </li>
  )
}

function Time({ projectId, board, onOpen }: { projectId: string; board: boolean; onOpen: (key: string) => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const time = usePortalTime(ws.id, projectId)
  if (time.error) return <ErrorState error={time.error} />
  if (!time.data) return <LoadingRows rows={4} />
  const d = time.data
  const budget = d.budget_minutes ?? 0
  const max = Math.max(1, ...d.by_task.map((x) => x.minutes))
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label={t("portal.time.tracked")} icon={<ClockIcon className="size-3.5" />} value={<Ltr>{t("portal.hoursShort", { h: hours(d.used_minutes) })}</Ltr>} />
        <StatTile
          label={t("portal.time.budget")}
          icon={<WalletIcon className="size-3.5" />}
          value={<Ltr>{budget > 0 ? t("portal.hoursShort", { h: hours(budget) }) : "—"}</Ltr>}
        >
          {budget > 0 ? <Meter value={(d.used_minutes / budget) * 100} warn={d.used_minutes > budget} label={t("portal.time.budget")} /> : null}
        </StatTile>
        <StatTile
          label={t("portal.time.left")}
          icon={<ClockIcon className="size-3.5" />}
          value={<Ltr>{budget > 0 ? t("portal.hoursShort", { h: hours(Math.max(0, budget - d.used_minutes)) }) : "—"}</Ltr>}
        />
      </div>
      <Section title={t("portal.hoursByWeek")} icon={<ClockIcon />}>
        <WeeksChart weeks={d.weeks} />
      </Section>
      {board ? (
        <Section title={t("portal.time.byTask")} icon={<ListChecksIcon />}>
          {d.by_task.length === 0 ? (
            <p className="text-sm text-grid-muted">{t("portal.time.none")}</p>
          ) : (
            <ul className="space-y-2.5" data-portal-time-tasks={d.by_task.length}>
              {d.by_task.map((x, i) => (
                <li key={x.key ?? `none-${i}`} className="space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    {x.key ? (
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-start hover:underline" onClick={() => onOpen(x.key!)}>
                        <Ltr mono>{x.key}</Ltr>
                        <span className="truncate">{x.title}</span>
                      </button>
                    ) : (
                      <span className="flex-1 text-grid-muted">{t("portal.time.noTask")}</span>
                    )}
                    <span className="text-xs tabular-nums" dir="ltr">
                      {t("portal.hoursShort", { h: hours(x.minutes) })}
                    </span>
                  </div>
                  <Meter value={(x.minutes / max) * 100} label={x.title ?? t("portal.time.noTask")} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}
    </div>
  )
}

function Invoices({ p }: { p: PortalProjectPage }) {
  const { t, locale } = useTranslations()
  if (!p.invoices_visible) return <PortalEmpty icon={<ReceiptTextIcon />} title={t("portal.invoicesHidden")} />
  if (p.invoices.length === 0) return <PortalEmpty icon={<ReceiptTextIcon />} title={t("portal.noInvoices")} />
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
      {p.invoices.map((iv) => (
        <li key={iv.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-center gap-3">
            <ReceiptTextIcon className="size-4 text-grid-muted" />
            <span className="font-medium" dir="ltr">
              {iv.number}
            </span>
            <span className="text-xs text-grid-muted">{formatDay(iv.issue_date, locale)}</span>
          </span>
          <span className="flex items-center gap-3">
            <span className="text-sm tabular-nums" dir="ltr">
              {money(iv.total_minor, iv.currency, locale)}
            </span>
            <Badge variant="secondary">{t(`invoices.status.${iv.status}`)}</Badge>
          </span>
        </li>
      ))}
    </ul>
  )
}

function Activity({ projectId, onOpenIssue, onOpenTask }: { projectId: string; onOpenIssue: (k: string) => void; onOpenTask?: (k: string) => void }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const act = usePortalActivity(ws.id, projectId)
  if (act.error) return <ErrorState error={act.error} />
  if (!act.data) return <LoadingRows rows={5} />
  const items = act.data.items
  if (items.length === 0) return <PortalEmpty icon={<ActivityIcon />} title={t("portal.activityEmpty")} />
  return (
    <ol className="relative space-y-4 border-s border-line ps-5" data-portal-activity={items.length}>
      {items.map((it, i) => {
        const isTask = it.kind.startsWith("task.")
        const open = isTask ? onOpenTask : it.kind === "request.filed" ? undefined : onOpenIssue
        return (
          <li key={i} className="relative">
            <span
              aria-hidden
              className={cn(
                "absolute -start-[25px] top-1 size-2.5 rounded-full border-2 border-background",
                it.kind === "task.completed" || it.kind === "issue.closed" ? "bg-grid-action" : "bg-grid-muted",
              )}
            />
            <p className="text-sm">
              {t(`portal.act.${it.kind}`, { from: it.from ?? "", to: it.to ?? "" })}{" "}
              {open ? (
                <button type="button" className="font-medium hover:underline" onClick={() => open(it.key)}>
                  <Ltr mono>{it.key}</Ltr> {it.title}
                </button>
              ) : (
                <span className="font-medium">
                  <Ltr mono>{it.key}</Ltr> {it.title}
                </span>
              )}
            </p>
            <p className="text-xs text-grid-muted">
              {formatDay(it.at, locale)} · {timeAgo(it.at, locale)}
            </p>
          </li>
        )
      })}
    </ol>
  )
}

function IssueSheet({ issueKey, onClose, onChanged }: { issueKey: string; onClose: () => void; onChanged: () => void }) {
  const { t, locale, isRtl } = useTranslations()
  const ws = useWorkspace()
  const issue = usePortalIssue(ws.id, issueKey)
  const i = issue.data
  const [reply, setReply] = useState("")
  const [busy, setBusy] = useState(false)

  const change = async (body: { status?: string; priority?: string }, done?: string) => {
    setBusy(true)
    try {
      const next = await portalApi.patchIssue(ws.id, issueKey, body)
      await issue.mutate(next, { revalidate: false })
      if (done) toast.success(done)
      onChanged()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }
  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!reply.trim()) return
    setBusy(true)
    try {
      await portalApi.comment(ws.id, issueKey, reply.trim())
      setReply("")
      await issue.mutate()
      onChanged()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={isRtl ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-lg" data-portal-issue-sheet={issueKey}>
        {!i ? (
          <div className="p-5">{issue.error ? <ErrorState error={issue.error} /> : <LoadingRows rows={4} />}</div>
        ) : (
          <div className="space-y-5 p-5">
            <div className="pe-8">
              <span className="flex items-center gap-2 text-xs text-grid-muted">
                <IssueTypeIcon type={i.issue_type} />
                <code dir="ltr">{i.key}</code>
              </span>
              <SheetTitle className="mt-1 text-lg leading-snug">{i.title}</SheetTitle>
              <SheetDescription className="sr-only">{t(`issues.type.${i.issue_type}`)}</SheetDescription>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{t(`issues.status.${i.status}`)}</Badge>
                <span className="text-xs text-grid-muted">{t(`issues.type.${i.issue_type}`)}</span>
                <span className="text-xs text-grid-muted">· {timeAgo(i.created_at, locale)}</span>
              </div>
            </div>
            {i.body ? (
              <p className="text-sm whitespace-pre-wrap" dir="auto">
                {i.body}
              </p>
            ) : null}
            {i.screenshot ? <AuthImage src={`/api/w/portal/issues/${encodeURIComponent(i.key)}/screenshot`} alt={t("requests.attachment")} /> : null}

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-muted/30 p-3">
              {i.can_accept ? (
                <Button size="sm" disabled={busy} onClick={() => change({ status: "done" }, t("portal.accepted"))}>
                  <CheckIcon /> {t("portal.accept")}
                </Button>
              ) : null}
              {i.can_reopen ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => change({ status: "todo" }, t("portal.reopened"))}>
                  <RotateCcwIcon /> {t("portal.reopen")}
                </Button>
              ) : null}
              <span className="ms-auto flex items-center gap-2 text-xs text-grid-muted">
                {t("portal.priority")}
                <Select value={i.priority} onValueChange={(v) => v && v !== i.priority && change({ priority: v })}>
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue>
                      <IssuePriorityMark priority={i.priority} withLabel />
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ISSUE_PRIORITIES.map((pr) => (
                      <SelectItem key={pr} value={pr}>
                        <IssuePriorityMark priority={pr} withLabel />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
            </div>

            <section className="space-y-3">
              <h3 className="text-sm font-medium">{t("portal.comments")}</h3>
              {i.comments.length === 0 ? <p className="text-sm text-grid-muted">{t("portal.noComments")}</p> : null}
              <ul className="space-y-3">
                {i.comments.map((c) => (
                  <li key={c.id} className={cn("rounded-lg border border-line px-3 py-2", c.mine && "border-grid-action/40 bg-grid-action/5")}>
                    <p className="text-xs text-grid-muted">
                      {c.mine ? t("portal.you") : c.author_kind === "agent" ? t("portal.agent") : t("portal.team")} · {timeAgo(c.created_at, locale)}
                    </p>
                    <p className="text-sm whitespace-pre-wrap" dir="auto">
                      {c.body}
                    </p>
                  </li>
                ))}
              </ul>
              <form onSubmit={send} className="space-y-2">
                <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t("portal.writeComment")} className="min-h-20" />
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={busy || !reply.trim()}>
                    <SendIcon className={isRtl ? "rotate-180" : undefined} /> {t("portal.send")}
                  </Button>
                </div>
              </form>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
