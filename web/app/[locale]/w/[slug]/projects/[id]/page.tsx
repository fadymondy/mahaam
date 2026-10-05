"use client"

import Link from "next/link"
import { useMemo } from "react"
import { toast } from "@fadymondy/nasaq/web"
import { CheckCircle2Icon, CircleAlertIcon, CircleDotIcon, ClockAlertIcon, GitCommitHorizontalIcon, ListChecksIcon, PlusIcon, SettingsIcon, SquareKanbanIcon, TriangleAlertIcon } from "lucide-react"

import { Button, MetricTiles, Progress, Skeleton } from "@fadymondy/nasaq/web"

import { ConfirmButton } from "@/components/confirm-button"
import { Ltr } from "@/components/copy-field"
import { BudgetMeters, LevelBadge } from "@/components/reports/budget-meter"
import { ProjectReportMenu } from "@/components/reports/project-report-menu"
import { ActivityFeed } from "@/components/work/activity-feed"
import { Card, Empty, InfoRow } from "@/components/work/project/cards"
import { NewTaskDialog } from "@/components/work/project/new-task-dialog"
import { ColorDot } from "@/components/work/palette"
import { PersonAvatar, useDirectory } from "@/components/work/people"
import { useProjectCtx } from "@/components/work/project-context"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { formatDay, isOverdue, minutes, money, timeAgo } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useGitHub, useIntegrations, type Commit, type Run } from "@/lib/integrations"
import { useMe } from "@/lib/queries"
import { useProjectBudget } from "@/lib/reports"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"
import { errorText, useBoard, useIssues, useProjectActivity, w } from "@/lib/work"

type Tone = "ok" | "warn" | "bad"
const TONE_DOT: Record<Tone, string> = { ok: "bg-nq-ok", warn: "bg-nq-warn", bad: "bg-nq-danger" }
const TONE_TEXT: Record<Tone, string> = { ok: "text-(--nq-ok-text)", warn: "text-(--nq-warn-text)", bad: "text-(--nq-danger-text)" }

export default function ProjectOverviewPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const { project: p, base, reload, openTask } = useProjectCtx()
  useDocumentTitle(`${t("projectTab.overview")} · ${p.name}`)
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  const activity = useProjectActivity(ws.id, p.id)
  const board = useBoard(ws.id, p.id)
  const issues = useIssues(ws.id, { project: p.id })
  const isClient = ws.current?.role === "client"
  const budget = useProjectBudget(ws.id, isClient ? null : p.id)
  const integrations = useIntegrations(ws.id, p.id, ws.can("integrations:read"))
  const gh = (integrations.data?.integrations ?? []).find((i) => i.provider === "github")
  const repo = gh?.config.repo && gh.status !== "disabled" ? gh.config.repo : null
  const commits = useGitHub<{ commits: Commit[] | null }>(ws.id, p.id, repo ? "commits" : null)
  const runs = useGitHub<{ runs: Run[] | null }>(ws.id, p.id, repo ? "runs" : null)

  const total = p.tasks.todo + p.tasks.doing + p.tasks.done
  const pct = total ? Math.round((p.tasks.done / total) * 100) : 0
  const statusById = useMemo(() => new Map(p.statuses.map((s) => [s.id, s])), [p.statuses])
  // Cards and issues are one thing (MH-n); the tasks list leaves out what the issues list already shows.
  const tasks = useMemo(() => board.data?.tasks ?? [], [board.data])
  const issueList = useMemo(() => issues.data?.issues ?? [], [issues.data])
  const overdue = useMemo(() => tasks.filter((x) => statusById.get(x.status_id)?.category !== "done" && isOverdue(x.due_at, x.completed_at)).length, [tasks, statusById])
  const recentTasks = useMemo(() => {
    const issueKeys = new Set(issueList.map((i) => i.key))
    return tasks.filter((x) => !issueKeys.has(x.key)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5)
  }, [tasks, issueList])
  const openIssues = issueList.filter((i) => i.status !== "done")
  const urgentIssues = openIssues.filter((i) => i.priority === "highest" || i.priority === "high").length
  const recentIssues = useMemo(() => [...issueList].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5), [issueList])
  const people = Array.from(new Set([...p.members.map((m) => m.user_id), ...p.teams.flatMap((x) => x.member_ids)]))
  const b = budget.data
  const pastEnd = !!p.ends_on && p.ends_on.slice(0, 10) < new Date().toISOString().slice(0, 10) && p.status !== "completed" && p.status !== "cancelled"

  // Health signals: only what the data says.
  const signals: { key: string; label: string; value: string; tone: Tone }[] = [
    { key: "overdue", label: t("po.health.overdue"), value: String(overdue), tone: overdue === 0 ? "ok" : overdue > 3 ? "bad" : "warn" },
    { key: "issues", label: t("po.health.issues"), value: String(openIssues.length), tone: urgentIssues > 0 ? "warn" : "ok" },
  ]
  if (b && b.level !== "none") signals.push({ key: "budget", label: t("po.health.budget"), value: t(`budget.level.${b.level}`), tone: b.level === "over" ? "bad" : b.level === "warning" ? "warn" : "ok" })
  if (p.ends_on) signals.push({ key: "schedule", label: t("po.health.schedule"), value: pastEnd ? t("po.health.pastEnd") : t("po.health.onSchedule"), tone: pastEnd ? "bad" : "ok" })
  const overall: Tone = signals.some((s) => s.tone === "bad") ? "bad" : signals.some((s) => s.tone === "warn") ? "warn" : "ok"
  const loadingHealth = board.isLoading || issues.isLoading

  async function setArchived(path: "archive" | "restore") {
    try {
      await w.post(ws.id, `/api/w/projects/${p.id}/${path}`)
      toast.success(t(path === "archive" ? "project.archived" : "project.restored"))
      reload()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
  }

  const HealthIcon = overall === "ok" ? CheckCircle2Icon : overall === "warn" ? CircleAlertIcon : TriangleAlertIcon

  return (
    <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-3">
      <MetricTiles
        className="lg:col-span-3"
        loading={loadingHealth}
        metrics={[
          { id: "progress", label: t("po.progress.title"), value: pct, display: <Ltr>{pct}%</Ltr>, icon: <ListChecksIcon /> },
          { id: "open", label: t("po.kpi.openTasks"), value: p.tasks.todo + p.tasks.doing, icon: <CircleDotIcon /> },
          { id: "overdue", label: t("po.health.overdue"), value: overdue, invert: true, icon: <ClockAlertIcon /> },
          { id: "issues", label: t("po.health.issues"), value: openIssues.length, icon: <SquareKanbanIcon /> },
        ]}
      />
      <Card title={t("po.health.title")} data-card="health">
        {loadingHealth ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-full border", TONE_TEXT[overall], "border-current/30")}>
                <HealthIcon className="size-6" />
              </span>
              <p className={cn("text-base font-medium", TONE_TEXT[overall])}>{t(`po.health.${overall}`)}</p>
            </div>
            <dl className="mt-3 divide-y divide-line">
              {signals.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <dt className="flex items-center gap-2 text-nq-fg-body">
                    <span aria-hidden className={cn("size-2 rounded-full", TONE_DOT[s.tone])} />
                    {s.label}
                  </dt>
                  <dd className={cn("font-medium", TONE_TEXT[s.tone])}>
                    <Ltr>{s.value}</Ltr>
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </Card>

      <Card title={t("po.progress.title")} data-card="progress">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-medium">
            <Ltr>{pct}%</Ltr>
          </span>
          <span className="text-sm text-muted-foreground">
            <Ltr>
              {p.tasks.done} / {total}
            </Ltr>{" "}
            {t("po.progress.tasksDone")}
          </span>
        </div>
        <Progress value={pct} className="mt-3" aria-label={t("projects.progress")} />
        <ul className="mt-4 space-y-2">
          {p.statuses.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2 text-nq-fg-body">
                <ColorDot color={s.color} />
                <span className="truncate">{s.name}</span>
              </span>
              <span className="font-medium">
                <Ltr>{s.task_count}</Ltr>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {!isClient ? (
        <Card title={t("budget.title")} data-card="budget" action={p.can_manage ? { href: `${base}/settings`, label: t("projectTab.settings") } : undefined}>
          {!b ? (
            <Skeleton className="h-24 w-full" />
          ) : b.level === "none" ? (
            <div className="space-y-1">
              <p className="text-sm text-nq-fg-body">{t("budget.none")}</p>
              {p.can_manage ? <p className="text-caption text-muted-foreground">{t("budget.noneManager")}</p> : null}
            </div>
          ) : (
            <div className="space-y-4">
              <LevelBadge level={b.level} />
              <BudgetMeters b={b} finance={ws.can("reports:finance")} className="!grid-cols-1" />
            </div>
          )}
        </Card>
      ) : (
        <Card title={t("po.info.title")}>
          <InfoRow label={t("project.billing")}>{t(`billing.${p.billing_mode}`)}</InfoRow>
        </Card>
      )}

      <Card title={t("po.recentTasks")} flush action={{ href: `${base}/board`, label: t("po.viewAll") }} data-card="tasks">
        {board.isLoading ? (
          <div className="px-4 pb-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : recentTasks.length === 0 ? (
          <Empty>{t("po.noTasks")}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {recentTasks.map((x) => {
              const st = statusById.get(x.status_id)
              const late = st?.category !== "done" && isOverdue(x.due_at, x.completed_at)
              return (
                <li key={x.id}>
                  <button type="button" onClick={() => openTask(x.key)} className="flex w-full items-center gap-3 px-4 py-2.5 text-start text-sm hover:bg-muted">
                    <Ltr mono className="shrink-0 text-caption text-muted-foreground">
                      {x.key}
                    </Ltr>
                    <span className="min-w-0 flex-1 truncate">{x.title}</span>
                    {late ? <span className="shrink-0 text-caption text-(--nq-danger-text)">{t("po.overdue")}</span> : null}
                    {st ? (
                      <span className="hidden shrink-0 items-center gap-1.5 text-caption text-muted-foreground sm:inline-flex">
                        <ColorDot color={st.color} />
                        {st.name}
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card title={t("po.recentIssues")} flush action={{ href: `${base}/board`, label: t("po.viewAll") }} data-card="issues">
        {issues.isLoading ? (
          <div className="px-4 pb-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : recentIssues.length === 0 ? (
          <Empty>{t("po.noIssues")}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {recentIssues.map((i) => (
              <li key={i.key}>
                <button type="button" onClick={() => openTask(i.key)} className="flex w-full items-center gap-3 px-4 py-2.5 text-start text-sm hover:bg-muted">
                  <Ltr mono className="shrink-0 text-caption text-muted-foreground">
                    {i.key}
                  </Ltr>
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <span className="hidden shrink-0 text-caption text-muted-foreground sm:inline">{t(`issues.status.${i.status}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t("po.quick.title")} data-card="quick">
        <div className="grid gap-2">
          {p.can_write && !p.archived_at ? (
            <NewTaskDialog
              trigger={(open) => (
                <Button variant="secondary" className="justify-start" onClick={open}>
                  <PlusIcon />
                  {t("po.newTask")}
                </Button>
              )}
            />
          ) : null}
          <Button variant="secondary" className="justify-start" nativeButton={false} render={<Link href={`${base}/board`} />}>
            <SquareKanbanIcon />
            {t("po.quick.board")}
          </Button>
          {ws.can("reports:read") ? <ProjectReportMenu projectId={p.id} className="w-full justify-start" /> : null}
          {p.can_manage ? (
            <Button variant="secondary" className="justify-start" nativeButton={false} render={<Link href={`${base}/settings`} />}>
              <SettingsIcon />
              {t("projectTab.settings")}
            </Button>
          ) : null}
        </div>
      </Card>

      <div className="grid content-start gap-4 lg:col-span-2">
      <Card title={t("activity.title")} flush data-card="activity">
        <ActivityFeed items={activity.data?.activity?.slice(0, 8)} loading={activity.isLoading} error={activity.error} dir={dir} compact />
      </Card>

      {repo ? (
        <Card title={t("po.github.title")} action={{ href: `${base}/github`, label: t("po.viewAll") }} data-card="github">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-2 text-caption font-medium uppercase text-muted-foreground">{t("gh.commits")}</p>
              {commits.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : (commits.data?.commits ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{commits.error ? t("po.github.unavailable") : t("gh.empty")}</p>
              ) : (
                <ul className="space-y-2">
                  {(commits.data?.commits ?? []).slice(0, 3).map((c) => (
                    <li key={c.sha} className="flex items-start gap-2 text-sm">
                      <GitCommitHorizontalIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <a href={c.url} target="_blank" rel="noreferrer" className="line-clamp-1 hover:underline">
                          {c.message.split("\n")[0]}
                        </a>
                        <p className="text-caption text-muted-foreground">
                          <Ltr mono>{c.sha.slice(0, 7)}</Ltr> · {c.author_login || c.author_name} · <Ltr>{timeAgo(c.date, locale)}</Ltr>
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-caption font-medium uppercase text-muted-foreground">{t("gh.runs")}</p>
              {runs.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : (runs.data?.runs ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{runs.error ? t("po.github.unavailable") : t("gh.empty")}</p>
              ) : (
                <ul className="space-y-2">
                  {(runs.data?.runs ?? []).slice(0, 3).map((r) => {
                    const tone: Tone = r.conclusion === "success" ? "ok" : r.conclusion === "failure" ? "bad" : "warn"
                    return (
                      <li key={r.id} className="flex items-start gap-2 text-sm">
                        <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE_DOT[tone])} />
                        <div className="min-w-0">
                          <a href={r.url} target="_blank" rel="noreferrer" className="line-clamp-1 hover:underline">
                            {r.name}
                          </a>
                          <p className="text-caption text-muted-foreground">
                            <Ltr mono>{r.branch}</Ltr> · {r.conclusion || r.status} · <Ltr>{timeAgo(r.created_at, locale)}</Ltr>
                          </p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </Card>
      ) : null}

      </div>
      <div className="grid content-start gap-4">
        <Card title={t("po.team.title")} data-card="team">
          {p.members.length === 0 && p.teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <ul className="space-y-2.5">
              {p.members.map((m) => (
                <li key={m.user_id} className="flex items-center gap-3 text-sm">
                  <PersonAvatar id={m.user_id} dir={dir} />
                  <span className="min-w-0 flex-1 truncate" dir="ltr">
                    {dir.name(m.user_id)}
                  </span>
                  <span className="shrink-0 text-caption text-muted-foreground">{t(`projectRole.${m.role}`)}</span>
                </li>
              ))}
              {p.teams.map((x) => (
                <li key={x.team_id} className="flex items-center gap-3 text-sm">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border">
                    <ColorDot color={x.color} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  <span className="shrink-0 text-caption text-muted-foreground">{t("po.members", { n: String(x.member_ids.length) })}</span>
                </li>
              ))}
            </ul>
          )}
          {people.length > 0 && p.teams.length > 0 ? <p className="mt-3 text-caption text-muted-foreground">{t("po.team.total", { n: String(people.length) })}</p> : null}
        </Card>
      <Card title={t("po.info.title")} data-card="info">
        <dl className="divide-y divide-line">
          <InfoRow label={t("project.client")}>{p.client_name ?? "—"}</InfoRow>
          <InfoRow label={t("project.billing")}>{t(`billing.${p.billing_mode}`)}</InfoRow>
          <InfoRow label={t("project.budgetHours")}>{p.budget_minutes ? <Ltr>{minutes(p.budget_minutes)}</Ltr> : "—"}</InfoRow>
          <InfoRow label={t("project.budgetMoney")}>{p.budget_minor ? <Ltr>{money(p.budget_minor, p.currency, locale)}</Ltr> : "—"}</InfoRow>
          <InfoRow label={t("project.startsOn")}>{p.starts_on ? <Ltr>{formatDay(p.starts_on, locale)}</Ltr> : "—"}</InfoRow>
          <InfoRow label={t("project.endsOn")}>{p.ends_on ? <Ltr>{formatDay(p.ends_on, locale)}</Ltr> : "—"}</InfoRow>
          <InfoRow label={t("project.visibility")}>{t(`visibility.${p.visibility}`)}</InfoRow>
          <InfoRow label={t("po.created")}>
            <Ltr>{formatDay(p.created_at, locale)}</Ltr>
          </InfoRow>
        </dl>
        {p.can_manage ? (
          <Button variant="ghost" size="sm" className="mt-2" nativeButton={false} render={<Link href={`${base}/settings`} />}>
            {t("po.info.edit")}
          </Button>
        ) : null}
      </Card>

      </div>

      {p.can_manage ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-nq-danger/40 bg-card p-4 lg:col-span-3" aria-label={t("po.danger.title")} data-card="danger">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-(--nq-danger-text)">{t("po.danger.title")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{p.archived_at ? t("settings.restoreHint") : t("settings.archiveHint")}</p>
          </div>
          {p.archived_at ? (
            <Button variant="secondary" onClick={() => setArchived("restore")}>
              {t("settings.restore")}
            </Button>
          ) : (
            <ConfirmButton label={t("settings.archive")} title={t("settings.archiveConfirm")} description={t("settings.archiveHint")} confirmLabel={t("settings.archive")} onConfirm={() => setArchived("archive")} />
          )}
        </section>
      ) : null}
    </div>
  )
}
