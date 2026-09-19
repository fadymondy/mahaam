"use client"

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { KanbanSquareIcon, ListIcon, MessageSquareIcon, PlusIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { IssueBoard } from "@/components/work/issues/issue-board"
import { AgentTime, HumanOnlyMark, IssuePriorityMark, IssueTypeIcon } from "@/components/work/issues/issue-bits"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { timeAgo } from "@/lib/format"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  ISSUE_TYPES,
  errorText,
  issuesApi,
  useIssues,
  useProjects,
  type Issue,
  type IssuePriority,
  type IssueStatus,
  type IssueType,
} from "@/lib/work"

type View = "board" | "list"
const VIEW_KEY = "mahaam.issues.view"

/**
 * The issue tracker: SDK / portal / MCP / in-app reports. One set of issues, shown for the whole
 * workspace (/w/{slug}/issues) or for one project (its Issues tab, fixedProject = project id).
 */
export function IssuesView({ fixedProject }: { fixedProject?: { id: string; name: string } }) {
  return (
    <Suspense>
      <IssuesScreen fixedProject={fixedProject} />
    </Suspense>
  )
}

/** A filter <Select> whose "" value means "all". */
function FilterSelect({ value, onChange, items, className, label }: { value: string; onChange: (v: string) => void; items: { value: string; label: string }[]; className?: string; label: string }) {
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange(String(v ?? ""))}>
      <SelectTrigger className={cn("h-9 w-full sm:w-40", className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((p) => (
          <SelectItem key={p.value || "all"} value={p.value}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function IssuesScreen({ fixedProject }: { fixedProject?: { id: string; name: string } }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("issues.title")} · ${fixedProject?.name ?? ws.summary.name}`)
  const [q, setQ] = useState("")
  const [priority, setPriority] = useState("")
  const [type, setType] = useState("")
  const [pickedProject, setProject] = useState("")
  const project = fixedProject?.id ?? pickedProject
  const [view, setViewState] = useState<View>("board")
  // Restore the last view after hydration (the server render is always the board).
  useEffect(() => {
    if (window.localStorage.getItem(VIEW_KEY) === "list") setViewState("list")
  }, [])
  const [creating, setCreating] = useState(false)
  const canWrite = ws.can("feedback:write")

  const setView = (v: View) => {
    setViewState(v)
    try {
      window.localStorage.setItem(VIEW_KEY, v)
    } catch {
      // storage blocked — the toggle still works for this visit
    }
  }

  const issues = useIssues(ws.id, {
    q: q.trim() || undefined,
    priority: priority || undefined,
    type: type || undefined,
    project: project || undefined,
  })
  const projects = useProjects(ws.id)
  const projectList = useMemo(() => projects.data?.projects ?? [], [projects.data])
  const projectName = useMemo(() => {
    const m = new Map(projectList.map((p) => [p.id, p.name]))
    return (id: string | null) => (id ? (m.get(id) ?? null) : null)
  }, [projectList])

  const priorityItems = [{ value: "", label: t("issues.allPriorities") }, ...ISSUE_PRIORITIES.map((p) => ({ value: p, label: t(`issues.priority.${p}`) }))]
  const typeItems = [{ value: "", label: t("issues.allTypes") }, ...ISSUE_TYPES.map((p) => ({ value: p, label: t(`issues.type.${p}`) }))]
  const projectItems = [{ value: "", label: t("issues.allProjects") }, ...projectList.map((p) => ({ value: p.id, label: p.name }))]
  const list = issues.data?.issues ?? []
  const base = `/${locale}/w/${ws.slug}/issues`
  const hrefFor = (key: string) => `${base}/${encodeURIComponent(key)}`
  const filtered = !!(q.trim() || priority || type || pickedProject)

  return (
    <>
      {fixedProject ? null : <SectionHeader micro={ws.summary.name} title={t("issues.title")} description={t("issues.hint")} />}

      <div className="flex flex-wrap items-center gap-2 border-y border-line px-6 py-3">
        <div className="relative w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-grid-muted" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("issues.search")} aria-label={t("issues.search")} className="h-9 ps-8" dir="auto" />
        </div>
        {fixedProject ? null : (
          <FilterSelect value={pickedProject} onChange={setProject} items={projectItems} label={t("issues.projectLabel")} className="sm:w-48" />
        )}
        <FilterSelect value={type} onChange={setType} items={typeItems} label={t("issues.typeLabel")} />
        <FilterSelect value={priority} onChange={setPriority} items={priorityItems} label={t("issues.priorityLabel")} />

        <div className="ms-auto flex items-center gap-2">
          <div role="radiogroup" aria-label={t("issues.viewLabel")} className="flex border border-line">
            {(["board", "list"] as const).map((v) => {
              const Icon = v === "board" ? KanbanSquareIcon : ListIcon
              return (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    "flex h-9 items-center gap-1.5 px-3 text-xs text-grid-muted hover:text-grid-fg",
                    view === v && "bg-grid-soft font-medium text-grid-fg",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {t(`issues.view.${v}`)}
                </button>
              )
            })}
          </div>
          {canWrite ? (
            <Button className="h-9" onClick={() => setCreating(true)}>
              <PlusIcon />
              {t("issues.new")}
            </Button>
          ) : null}
        </div>
      </div>

      {issues.error ? (
        <ErrorState error={issues.error} />
      ) : issues.isLoading && !issues.data ? (
        <LoadingRows rows={5} />
      ) : list.length === 0 && (filtered || view === "list") ? (
        <EmptyState title={filtered ? t("issues.noMatch") : t("issues.empty")} body={filtered ? t("issues.noMatchBody") : t("issues.emptyBody")} />
      ) : view === "board" ? (
        <IssueBoard
          issues={list}
          workspaceId={ws.id}
          canWrite={canWrite}
          projectName={projectName}
          hrefFor={hrefFor}
          onChanged={() => void issues.mutate()}
        />
      ) : (
        <IssueList issues={list} projectName={projectName} hrefFor={hrefFor} />
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("issues.new")}</DialogTitle>
            <DialogDescription>{t("issues.newHint")}</DialogDescription>
          </DialogHeader>
          {creating ? (
            <NewIssueForm
              projects={projectList}
              defaultProject={project}
              onDone={() => {
                setCreating(false)
                void issues.mutate()
              }}
              base={base}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

function IssueList({ issues, projectName, hrefFor }: { issues: Issue[]; projectName: (id: string | null) => string | null; hrefFor: (key: string) => string }) {
  const { t, locale } = useTranslations()
  // Board order within status order, so the list reads like the board top-to-bottom.
  const rows = [...issues].sort(
    (a, b) => ISSUE_STATUSES.indexOf(a.status) - ISSUE_STATUSES.indexOf(b.status) || a.sort_order - b.sort_order,
  )
  return (
    <ul className="divide-y divide-line border-b border-line">
      {rows.map((issue) => {
        const project = projectName(issue.project_id)
        return (
          <li key={issue.key}>
            <Link href={hrefFor(issue.key)} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3 hover:bg-grid-soft">
              <IssueTypeIcon type={issue.issue_type} />
              <Ltr mono className="w-16 shrink-0 text-xs text-grid-muted">{issue.key}</Ltr>
              <span className={cn("min-w-0 flex-1 truncate text-sm font-medium text-grid-fg", issue.status === "done" && "text-grid-muted line-through")} dir="auto">
                {issue.title}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-grid-muted">
                {issue.human_only ? <HumanOnlyMark /> : null}
                {project ? <span className="max-w-40 truncate" dir="auto">{project}</span> : null}
                <span className="border border-line px-1.5 py-0.5 text-[11px]">{t(`issues.status.${issue.status}`)}</span>
                <IssuePriorityMark priority={issue.priority} />
                <AgentTime seconds={issue.agent_seconds} />
                {issue.comment_count ? (
                  <span className="flex items-center gap-1">
                    <MessageSquareIcon className="size-3" aria-hidden />
                    <Ltr>{issue.comment_count}</Ltr>
                  </span>
                ) : null}
                <span>{timeAgo(issue.created_at, locale)}</span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function NewIssueForm({
  projects,
  defaultProject,
  onDone,
  base,
}: {
  projects: { id: string; name: string }[]
  defaultProject: string
  onDone: (key?: string) => void
  base: string
}) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [type, setType] = useState<IssueType>("bug")
  const [priority, setPriority] = useState<IssuePriority>("medium")
  const [status, setStatus] = useState<IssueStatus>("backlog")
  const [project, setProject] = useState(defaultProject)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const typeItems = ISSUE_TYPES.map((v) => ({ value: v, label: t(`issues.type.${v}`) }))
  const priorityItems = ISSUE_PRIORITIES.map((v) => ({ value: v, label: t(`issues.priority.${v}`) }))
  const statusItems = ISSUE_STATUSES.map((v) => ({ value: v, label: t(`issues.status.${v}`) }))
  const projectItems = [{ value: "", label: t("issues.noProject") }, ...projects.map((p) => ({ value: p.id, label: p.name }))]

  async function submit(e: FormEvent, open = false) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    setError(null)
    try {
      const created = await issuesApi.create(ws.id, {
        title: title.trim(),
        body: body.trim() || undefined,
        issue_type: type,
        priority,
        status,
        project: project || undefined,
      })
      onDone(created.key)
      if (open) router.push(`${base}/${encodeURIComponent(created.key)}`)
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  const select = (id: string, label: string, value: string, items: { value: string; label: string }[], set: (v: string) => void) => (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select items={items} value={value} onValueChange={(v) => set(String(v ?? ""))}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value || "none"} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )

  return (
    <form onSubmit={(e) => submit(e)} noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="i-title">{t("issues.fieldTitle")}</FieldLabel>
          <Input id="i-title" autoFocus dir="auto" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="i-body">{t("issues.fieldBody")}</FieldLabel>
          <Textarea id="i-body" rows={5} dir="auto" value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("issues.bodyPlaceholder")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {select("i-type", t("issues.typeLabel"), type, typeItems, (v) => setType(v as IssueType))}
          {select("i-priority", t("issues.priorityLabel"), priority, priorityItems, (v) => setPriority(v as IssuePriority))}
          {select("i-status", t("issues.statusLabel"), status, statusItems, (v) => setStatus(v as IssueStatus))}
          {select("i-project", t("issues.projectLabel"), project, projectItems, setProject)}
        </div>
        {error ? <FieldError>{error}</FieldError> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy || !title.trim()} onClick={(e) => submit(e as unknown as FormEvent, true)}>
            {t("issues.createAndOpen")}
          </Button>
          <Button type="submit" disabled={busy || !title.trim()}>
            {busy ? t("common.working") : t("issues.create")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
