"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { PlusIcon } from "lucide-react"

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ProjectList,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsList, TabsTab,
  type Project as NasaqProject,
  type ProjectStatus as NasaqProjectStatus,
  type TagHue,
} from "@fadymondy/nasaq/web"
import { SectionHeader } from "@/components/public-frame"
import { EmptyState } from "@/components/states"
import { useDirectory } from "@/components/work/people"
import { useMe } from "@/lib/queries"
import { ProjectForm } from "@/components/work/project-form"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { ISSUE_STATUSES, errorText, useOverview, useProjects } from "@/lib/work"

// Mahaam's project statuses onto Nasaq's ProjectList ones; the labels stay Mahaam's.
const NASAQ_STATUS: Record<string, NasaqProjectStatus> = {
  planned: "planning",
  active: "active",
  on_hold: "on-hold",
  completed: "completed",
  cancelled: "archived",
}
// Board statuses as tag hues, so a project's open work reads at a glance.
const STATUS_HUE: Record<string, TagHue> = {
  backlog: "gray",
  todo: "blue",
  in_progress: "violet",
  waiting_approval: "orange",
  in_review: "amber",
  done: "green",
}

function FilterSelect({ value, onChange, items, label }: { value: string; onChange: (v: string) => void; items: { value: string; label: string }[]; label: string }) {
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange(String(v ?? ""))}>
      <SelectTrigger className="h-9 w-auto min-w-36 gap-1.5" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((x) => (
          <SelectItem key={x.value || "all"} value={x.value}>
            {x.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default function ProjectsPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  useDocumentTitle(`${t("nav.projects")} · ${ws.summary.name}`)
  const [archived, setArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const projects = useProjects(ws.id, archived)
  const canCreate = ws.can("projects:create")
  const base = `/${locale}/w/${ws.slug}/projects`
  const list = useMemo(() => projects.data?.projects ?? [], [projects.data])
  const [only, setOnly] = useState("")
  const overview = useOverview(ws.id)
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  const members = overview.data?.project_members ?? {}
  const rows = useMemo<NasaqProject[]>(
    () =>
      list
        .filter((p) => {
          const i = p.issues ?? {}
          if (only === "open" && !ISSUE_STATUSES.some((x) => x !== "done" && i[x])) return false
          if (only === "review" && !(i.in_review || i.waiting_approval)) return false
          return true
        })
        .map((p) => {
          const total = p.tasks.todo + p.tasks.doing + p.tasks.done
          const issues = p.issues ?? {}
          return {
            id: p.id,
            name: p.name,
            logo: p.avatar ?? undefined,
            client: p.client_name ?? undefined,
            status: NASAQ_STATUS[p.status] ?? "active",
            progress: total ? Math.round((p.tasks.done / total) * 100) : 0,
            members: (members[p.id] ?? []).map((id) => ({ name: dir.name(id) })),
            dueDate: p.ends_on,
            tags: [
              ...(p.visibility === "members" ? [{ label: t("project.private"), hue: "gray" as TagHue }] : []),
              ...ISSUE_STATUSES.filter((x) => x !== "done" && issues[x]).map((x) => ({ label: `${t(`issues.status.${x}`)} ${issues[x]}`, hue: STATUS_HUE[x] })),
            ],
            lastActivity: p.last_activity_at ?? p.updated_at,
          }
        }),
    [list, only, members, dir, t],
  )

  return (
    <>
      <SectionHeader
        title={t("nav.projects")}
        description={t("projects.hint")}
        action={
          canCreate ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <PlusIcon />
              {t("project.new")}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
        <Tabs value={archived ? "archived" : "active"} onValueChange={(v) => setArchived(v === "archived")}>
          <TabsList>
            <TabsTab value="active">{t("projects.active")}</TabsTab>
            <TabsTab value="archived">{t("projects.archived")}</TabsTab>
          </TabsList>
        </Tabs>
        <FilterSelect value={only} onChange={setOnly} label={t("projects.show")} items={[{ value: "", label: t("projects.showAll") }, { value: "open", label: t("projects.showOpen") }, { value: "review", label: t("projects.showReview") }]} />
      </div>

      <ProjectList
        projects={rows}
        loading={projects.isLoading}
        error={projects.error ? errorText(projects.error, t("common.networkError")) : undefined}
        onRetry={() => void projects.mutate()}
        onRowClick={(row) => router.push(`${base}/${row.id}/board`)}
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
        empty={
          <EmptyState
            title={archived ? t("projects.noArchived") : t("projects.empty")}
            body={archived ? undefined : canCreate ? t("projects.emptyBody") : t("projects.emptyMember")}
            action={
              !archived && canCreate ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <PlusIcon />
                  {t("project.new")}
                </Button>
              ) : null
            }
          />
        }
        className="px-6 pb-6"
        data-project-list
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
              router.push(`${base}/${p.id}/board`)
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
