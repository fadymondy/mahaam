"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { BriefcaseIcon, CalendarIcon, LockIcon, PlusIcon, SearchIcon, UsersIcon } from "lucide-react"

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Progress, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsList, TabsTab } from "@fadymondy/nasaq/web"
import { SectionHeader } from "@/components/public-frame"
import { Ltr } from "@/components/copy-field"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { ProjectAvatar } from "@/components/work/project-avatar"
import { formatDay } from "@/lib/format"
import { ProjectForm } from "@/components/work/project-form"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { ISSUE_STATUSES, useProjects } from "@/lib/work"

const PROJECT_STATUSES = ["planned", "active", "on_hold", "completed", "cancelled"] as const
const STATUS_TONE: Record<string, string> = {
  backlog: "var(--nq-tag-gray)",
  todo: "var(--nq-tag-blue)",
  in_progress: "var(--nq-tag-violet)",
  waiting_approval: "var(--nq-tag-orange)",
  in_review: "var(--nq-tag-amber)",
  done: "var(--nq-tag-green)",
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
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("")
  const [client, setClient] = useState("")
  const [only, setOnly] = useState("")
  const clientItems = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of list) if (p.client_id && p.client_name) m.set(p.client_id, p.client_name)
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [list])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return list.filter((p) => {
      if (needle && !`${p.name} ${p.client_name ?? ""} ${p.description ?? ""}`.toLowerCase().includes(needle)) return false
      if (status && p.status !== status) return false
      if (client && p.client_id !== client) return false
      const i = p.issues ?? {}
      if (only === "open" && !ISSUE_STATUSES.some((x) => x !== "done" && i[x])) return false
      if (only === "review" && !(i.in_review || i.waiting_approval)) return false
      return true
    })
  }, [list, q, status, client, only])

  return (
    <>
      <SectionHeader
        micro={ws.summary.name}
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

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-6 py-3">
        <Tabs value={archived ? "archived" : "active"} onValueChange={(v) => setArchived(v === "archived")}>
          <TabsList>
            <TabsTab value="active">{t("projects.active")}</TabsTab>
            <TabsTab value="archived">{t("projects.archived")}</TabsTab>
          </TabsList>
        </Tabs>
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("projects.search")} aria-label={t("projects.search")} className="h-9 ps-8" dir="auto" />
        </div>
        <FilterSelect value={status} onChange={setStatus} label={t("project.status")} items={[{ value: "", label: t("projects.allStatuses") }, ...PROJECT_STATUSES.map((x) => ({ value: x, label: t(`projectStatus.${x}`) }))]} />
        <FilterSelect value={client} onChange={setClient} label={t("project.client")} items={[{ value: "", label: t("projects.allClients") }, ...clientItems]} />
        <FilterSelect value={only} onChange={setOnly} label={t("projects.show")} items={[{ value: "", label: t("projects.showAll") }, { value: "open", label: t("projects.showOpen") }, { value: "review", label: t("projects.showReview") }]} />
      </div>

      {projects.error ? (
        <ErrorState error={projects.error} />
      ) : projects.isLoading ? (
        <LoadingRows />
      ) : list.length === 0 ? (
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
      ) : (
        <ul className="divide-y divide-line border-y border-border" data-project-list>
          {shown.map((p) => {
            const total = p.tasks.todo + p.tasks.doing + p.tasks.done
            const pct = total ? Math.round((p.tasks.done / total) * 100) : 0
            const issues = p.issues ?? {}
            const open = ISSUE_STATUSES.filter((x) => x !== "done").reduce((n, x) => n + (issues[x] ?? 0), 0)
            return (
              <li key={p.id} data-project={p.id}>
                <Link href={`${base}/${p.id}/board`} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-6 py-4 transition-colors hover:bg-muted">
                  <ProjectAvatar project={p} />

                  <span className="min-w-48 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-base font-medium text-foreground" dir="auto">{p.name}</span>
                      <Badge variant="outline">{t(`projectStatus.${p.status}`)}</Badge>
                      {p.visibility === "members" ? <LockIcon className="size-3.5 text-muted-foreground" aria-label={t("project.private")} /> : null}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
                      {p.client_name ? (
                        <span className="inline-flex items-center gap-1" dir="auto">
                          <BriefcaseIcon className="size-3" /> {p.client_name}
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1">
                        <UsersIcon className="size-3" /> <Ltr>{p.member_count}</Ltr>
                      </span>
                      {p.ends_on ? (
                        <span className="inline-flex items-center gap-1">
                          <CalendarIcon className="size-3" /> <Ltr>{formatDay(p.ends_on, locale, "short")}</Ltr>
                        </span>
                      ) : null}
                      {p.description ? <span className="max-w-md truncate" dir="auto">{p.description}</span> : null}
                    </span>
                  </span>

                  {/* The issue track: one segment per board status. */}
                  <span className="flex w-full flex-col gap-1.5 sm:w-72">
                    <span className="flex h-1.5 w-full overflow-hidden bg-muted" aria-hidden>
                      {ISSUE_STATUSES.map((x) =>
                        issues[x] ? <span key={x} style={{ flexGrow: issues[x], background: STATUS_TONE[x] }} title={`${t(`issues.status.${x}`)}: ${issues[x]}`} /> : null,
                      )}
                    </span>
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground">
                      {ISSUE_STATUSES.filter((x) => issues[x]).map((x) => (
                        <span key={x} className="inline-flex items-center gap-1">
                          <span className="size-1.5" style={{ background: STATUS_TONE[x] }} aria-hidden />
                          {t(`issues.status.${x}`)} <Ltr>{issues[x]}</Ltr>
                        </span>
                      ))}
                      {open === 0 && !issues.done ? <span>{t("projects.noItems")}</span> : null}
                    </span>
                  </span>

                  <span className="flex w-24 shrink-0 flex-col items-end gap-1">
                    <Ltr className="text-sm tabular-nums text-foreground">{pct}%</Ltr>
                    <Progress value={pct} className="h-1 w-full" />
                    <Ltr className="text-caption tabular-nums text-muted-foreground">
                      {p.tasks.done}/{total}
                    </Ltr>
                  </span>
                </Link>
              </li>
            )
          })}
          {shown.length === 0 ? <li className="px-6 py-10 text-center text-sm text-muted-foreground">{t("projects.noMatch")}</li> : null}
        </ul>
      )}

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
