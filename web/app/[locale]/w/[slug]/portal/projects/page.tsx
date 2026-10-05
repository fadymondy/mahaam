"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { ProjectList, Tabs, TabsList, TabsTab, type Project as NasaqProject, type ProjectStatus as NasaqProjectStatus, type TagHue } from "@fadymondy/nasaq/web"

import { PortalActions } from "@/components/portal/file-issue-dialog"
import { SectionHeader } from "@/components/public-frame"
import { EmptyState } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { hours, usePortalProjects } from "@/lib/portal"
import { useDocumentTitle } from "@/lib/title"
import { errorText } from "@/lib/work"

// Mahaam's project statuses onto Nasaq's ProjectList ones (as on the app's Projects page).
const NASAQ_STATUS: Record<string, NasaqProjectStatus> = {
  planned: "planning",
  active: "active",
  on_hold: "on-hold",
  completed: "completed",
  cancelled: "archived",
}

/** The customer's projects (MH-1167), in the app's Projects list; a row opens the project's panel. */
export default function PortalProjectsPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  useDocumentTitle(`${t("nav.projects")} · ${ws.summary.name}`)
  const [archived, setArchived] = useState(false)
  const projects = usePortalProjects(ws.id)
  const base = `/${locale}/w/${ws.slug}/portal/projects`
  const all = useMemo(() => projects.data?.projects ?? [], [projects.data])
  const rows = useMemo<NasaqProject[]>(
    () =>
      all
        .filter((p) => p.archived === archived)
        .map((p) => ({
          id: p.id,
          name: p.name,
          client: p.client_name ?? undefined,
          status: NASAQ_STATUS[p.status] ?? "active",
          progress: p.percent_done,
          dueDate: p.ends_on,
          tags: [
            ...(p.budget_minutes
              ? [
                  {
                    label: t("portal.hoursOfBudget", { used: hours(p.used_minutes), budget: hours(p.budget_minutes) }),
                    hue: (p.used_minutes > p.budget_minutes ? "red" : "gray") as TagHue,
                  },
                ]
              : []),
            ...(p.open_issues ? [{ label: t("portal.projects.openIssues", { n: p.open_issues }), hue: "blue" as TagHue }] : []),
            ...(p.pending_requests ? [{ label: t("portal.projects.pendingRequests", { n: p.pending_requests }), hue: "amber" as TagHue }] : []),
          ],
        })),
    [all, archived, t],
  )

  return (
    <>
      <SectionHeader title={t("nav.projects")} description={t("portal.projects.hint")} action={<PortalActions projects={all.filter((p) => !p.archived)} onFiled={() => void projects.mutate()} />} />

      <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
        <Tabs value={archived ? "archived" : "active"} onValueChange={(v) => setArchived(v === "archived")}>
          <TabsList>
            <TabsTab value="active">{t("projects.active")}</TabsTab>
            <TabsTab value="archived">{t("projects.archived")}</TabsTab>
          </TabsList>
        </Tabs>
      </div>

      <ProjectList
        projects={rows}
        loading={projects.isLoading}
        error={projects.error ? errorText(projects.error, t("common.networkError")) : undefined}
        onRetry={() => void projects.mutate()}
        onRowClick={(row) => router.push(`${base}/${row.id}`)}
        rowLabel={(row) => row.name}
        selectable={false}
        defaultView="cards"
        labels={{
          search: t("projects.search"),
          statuses: {
            planning: t("projectStatus.planned"),
            active: t("projectStatus.active"),
            "on-hold": t("projectStatus.on_hold"),
            completed: t("projectStatus.completed"),
            archived: t("projectStatus.cancelled"),
          },
        }}
        empty={<EmptyState title={archived ? t("projects.noArchived") : t("portal.noProjects")} />}
        className="px-6 pb-6"
        data-portal-project-list
      />
    </>
  )
}
