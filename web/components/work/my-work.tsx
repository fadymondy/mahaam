"use client"

import Link from "next/link"
import useSWR from "swr"

import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useIssues, useProjects, type Task } from "@/lib/work"

/*
The workspace overview's "My work": what needs me today — active projects, my open tasks,
my hours this week and the open issues — then my next tasks in board order.
*/
const hours = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`

export function MyWork({ meId }: { meId: string | undefined }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const base = `/${locale}/w/${ws.slug}`
  const fetcher = ([p, id]: [string, string]) => api<any>(p, { workspaceId: id })
  const projects = useProjects(ws.id)
  const tasks = useSWR<{ tasks: Task[] | null }>(meId ? [`/api/w/tasks?assignee=${encodeURIComponent(meId)}&limit=200`, ws.id] : null, fetcher)
  const week = useSWR<{ total_s: number }>(ws.can("time:track") ? ["/api/w/time/timesheet", ws.id] : null, fetcher)
  const issues = useIssues(ws.id, { state: "open" }, ws.can("feedback:read"))

  const open = (tasks.data?.tasks ?? []).filter((x) => !x.completed_at)
  const activeProjects = (projects.data?.projects ?? []).filter((p) => p.status === "active").length
  const tiles: [string, string | number, string][] = [
    [t("overview.activeProjects"), projects.data ? activeProjects : "—", `${base}/projects`],
    [t("overview.myOpenTasks"), tasks.data ? open.length : "—", `${base}/projects`],
    [t("overview.hoursThisWeek"), week.data ? hours(week.data.total_s) : "—", `${base}/time`],
    [t("overview.openIssues"), issues.data ? (issues.data.issues ?? []).length : "—", `${base}/issues`],
  ]

  return (
    <section className="border-b border-line">
      <div className="grid grid-cols-2 divide-line border-b border-line sm:grid-cols-4 [&>*]:border-line [&>*:not(:last-child)]:border-e">
        {tiles.map(([label, value, href]) => (
          <Link key={label} href={href} className="px-6 py-5 transition-colors hover:bg-grid-soft">
            <p className="grid-micro mb-1">{label}</p>
            <p className="text-2xl font-medium tabular-nums text-grid-fg">{value}</p>
          </Link>
        ))}
      </div>
      <div className="px-6 py-5">
        <h2 className="mb-3 text-base font-medium">{t("overview.nextUp")}</h2>
        {tasks.data && open.length === 0 ? (
          <p className="text-sm text-grid-muted">{t("overview.nothingAssigned")}</p>
        ) : (
          <ul className="divide-y divide-line border border-line">
            {open.slice(0, 8).map((x) => (
              <li key={x.id}>
                <Link
                  href={`${base}/projects/${x.project_id}?task=${encodeURIComponent(x.key)}`}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-grid-soft"
                >
                  <span dir="ltr" className="font-mono text-xs text-grid-muted">
                    {x.key}
                  </span>
                  <span className="min-w-0 flex-1 truncate" dir="auto">
                    {x.title}
                  </span>
                  {x.due_at ? <span className="text-meta text-grid-muted">{x.due_at.slice(0, 10)}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
