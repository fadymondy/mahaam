"use client"

import { Progress } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { ProjectBudgetPanel } from "@/components/reports/project-budget-panel"
import { ProjectReportMenu } from "@/components/reports/project-report-menu"
import { ActivityFeed } from "@/components/work/activity-feed"
import { AvatarStack, useDirectory } from "@/components/work/people"
import { useProjectCtx } from "@/components/work/project-context"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { formatDay, minutes, money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"
import { useProjectActivity } from "@/lib/work"

export default function ProjectOverviewPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const { project: p, base } = useProjectCtx()
  useDocumentTitle(`${t("projectTab.overview")} · ${p.name}`)
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  const activity = useProjectActivity(ws.id, p.id)
  const total = p.tasks.todo + p.tasks.doing + p.tasks.done
  const pct = total ? Math.round((p.tasks.done / total) * 100) : 0
  const people = Array.from(new Set([...p.members.map((m) => m.user_id), ...p.teams.flatMap((x) => x.member_ids)]))

  const facts: [string, React.ReactNode][] = [
    [t("project.client"), p.client_name ?? "—"],
    [t("project.billing"), t(`billing.${p.billing_mode}`)],
    [t("project.budgetHours"), p.budget_minutes ? <Ltr key="b">{minutes(p.budget_minutes)}</Ltr> : "—"],
    [t("project.budgetMoney"), p.budget_minor ? <Ltr key="m">{money(p.budget_minor, p.currency, locale)}</Ltr> : "—"],
    [t("project.startsOn"), p.starts_on ? <Ltr key="s">{formatDay(p.starts_on, locale)}</Ltr> : "—"],
    [t("project.endsOn"), p.ends_on ? <Ltr key="e">{formatDay(p.ends_on, locale)}</Ltr> : "—"],
    [t("project.visibility"), t(`visibility.${p.visibility}`)],
  ]

  return (
    <>
      <section className="grid gap-px border-b border-line bg-grid-line sm:grid-cols-3" aria-label={t("projects.progress")}>
        {(["todo", "doing", "done"] as const).map((c) => (
          <div key={c} className="bg-grid-bg px-6 py-4">
            <p className="grid-micro">{t(`category.${c}`)}</p>
            <p className="mt-1 text-2xl font-medium text-grid-fg">
              <Ltr>{p.tasks[c]}</Ltr>
            </p>
          </div>
        ))}
      </section>
      <div className="flex items-center gap-3 border-b border-line px-6 py-3">
        <Progress value={pct} className="max-w-sm flex-1" aria-label={t("projects.progress")} />
        <span className="text-sm text-grid-muted">
          <Ltr>{pct}%</Ltr> {t("project.done")}
        </span>
        {ws.can("reports:read") ? <ProjectReportMenu projectId={p.id} className="ms-auto" /> : null}
      </div>

      <ProjectBudgetPanel projectId={p.id} canManage={p.can_manage} settingsHref={`${base}/settings`} />

      {p.description ? <p className="border-b border-line px-6 py-4 text-sm whitespace-pre-wrap text-grid-body">{p.description}</p> : null}

      <dl className="grid grid-cols-2 gap-px border-b border-line bg-grid-line text-sm md:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="bg-grid-bg px-6 py-3">
            <dt className="grid-micro mb-1">{label}</dt>
            <dd className="text-grid-fg">{value}</dd>
          </div>
        ))}
        <div className="bg-grid-bg px-6 py-3">
          <dt className="grid-micro mb-1">{t("project.people")}</dt>
          <dd>{people.length ? <AvatarStack ids={people} dir={dir} max={6} /> : "—"}</dd>
        </div>
      </dl>

      <h2 className="px-6 pt-6 pb-3 text-base font-medium">{t("activity.title")}</h2>
      <ActivityFeed items={activity.data?.activity} loading={activity.isLoading} error={activity.error} dir={dir} />
    </>
  )
}
