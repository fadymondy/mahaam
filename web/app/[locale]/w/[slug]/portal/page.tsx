"use client"

import { useState } from "react"
import Link from "next/link"
import { FolderKanbanIcon, InboxIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { api } from "@/lib/api"
import { Badge, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@fadymondy/nasaq/web"







import { ErrorState, LoadingRows } from "@/components/states"
import { Meter, NewRequestDialog, PortalEmpty, ProgressRing } from "@/components/portal/portal-bits"
import { ConnectAiCard } from "@/components/portal/connect-ai"
import { ColorDot } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { formatDay, money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { hours, usePortalInvoices, usePortalProjects, type PortalProject } from "@/lib/portal"
import { useDocumentTitle } from "@/lib/title"
import { errorText } from "@/lib/work"

/*
The customer portal home (P7, extended in roadmap 5). A client-role member sees their projects
(the API restricts them to the projects of the client they are a portal contact of) as cards with
progress and hours — aggregates only — and opens one for its issues, requests and invoices. Their
invoices are listed here too, read-only. Anything internal (tasks, rates, members) is 404 at the API.
*/
export default function PortalPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("portal.title")} · ${ws.summary.name}`)
  const projects = usePortalProjects(ws.id)
  const invoices = usePortalInvoices(ws.id)
  const [dialog, setDialog] = useState<"issue" | "request" | null>(null)

  const list = projects.data?.projects ?? []
  const active = list.filter((p) => !p.archived)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("portal.title")}</h1>
          <p className="text-sm text-grid-muted">{t("portal.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setDialog("issue")} disabled={active.length === 0}>
            <PlusIcon /> {t("portal.fileIssue")}
          </Button>
          <Button variant="primary" onClick={() => setDialog("request")} disabled={active.length === 0}>
            <InboxIcon /> {t("portal.newRequest")}
          </Button>
        </div>
      </header>

      <section>
        <h2 className="mb-3 text-base font-medium">{t("portal.projects")}</h2>
        {projects.error ? (
          <ErrorState error={projects.error} />
        ) : !projects.data ? (
          <LoadingRows rows={3} />
        ) : list.length === 0 ? (
          <PortalEmpty icon={<FolderKanbanIcon />} title={t("portal.noProjects")} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-portal-projects={list.length}>
            {list.map((p) => (
              <ProjectCard key={p.id} p={p} href={`/${locale}/w/${ws.slug}/portal/projects/${p.id}`} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-medium">{t("portal.invoices")}</h2>
        {(invoices.data?.invoices ?? []).length === 0 ? (
          <p className="text-sm text-grid-muted">{t("portal.noInvoices")}</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {(invoices.data?.invoices ?? []).map((iv) => (
              <li key={iv.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="flex items-center gap-3">
                  <span className="font-medium" dir="ltr">
                    {iv.number}
                  </span>
                  <span className="text-meta text-grid-muted">{formatDay(iv.issue_date, locale)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-sm tabular-nums" dir="ltr">
                    {money(iv.total_minor, iv.currency, locale)}
                  </span>
                  <Badge variant="neutral">{t(`invoices.status.${iv.status}`)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConnectAiCard />

      {dialog === "request" ? (
        <NewRequestDialog
          projects={active}
          onClose={() => setDialog(null)}
          onFiled={() => {
            setDialog(null)
            projects.mutate()
          }}
        />
      ) : null}
      {dialog === "issue" ? (
        <FileIssueDialog
          projects={active}
          onClose={() => setDialog(null)}
          onFiled={() => {
            setDialog(null)
            projects.mutate()
          }}
        />
      ) : null}
    </div>
  )
}

function ProjectCard({ p, href }: { p: PortalProject; href: string }) {
  const { t } = useTranslations()
  const budget = p.budget_minutes ?? 0
  const used = hours(p.used_minutes)
  return (
    <li>
      <Link
        href={href}
        className="group flex h-full flex-col gap-4 rounded-2xl border border-line bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-grid-action/50 hover:shadow-sm"
        data-portal-project={p.id}
      >
        <div className="flex items-start gap-3">
          <ProgressRing value={p.percent_done} label={t("portal.progress")} size={56} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2">
              <ColorDot color={p.color} />
              <span className="truncate font-medium group-hover:text-grid-action">{p.name}</span>
            </p>
            {p.client_name ? <p className="truncate text-meta text-grid-muted">{p.client_name}</p> : null}
            <Badge variant="neutral" className="mt-1.5">
              {p.archived ? t("portal.archived") : t(`projectStatus.${p.status}`)}
            </Badge>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-meta text-grid-muted">
            <span>{t("portal.budget")}</span>
            <span className="tabular-nums" dir="ltr">
              {budget > 0 ? t("portal.hoursOfBudget", { used, budget: hours(budget) }) : t("portal.hoursTracked", { used })}
            </span>
          </div>
          {budget > 0 ? <Meter value={(p.used_minutes / budget) * 100} warn={p.used_minutes > budget} label={t("portal.budget")} /> : null}
        </div>
        <div className="mt-auto grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
          <span>
            <span className="block text-base font-semibold tabular-nums">{p.tasks.done}/{p.tasks.todo + p.tasks.doing + p.tasks.done}</span>
            <span className="block text-xs text-grid-muted">{t("portal.card.tasks")}</span>
          </span>
          <span>
            <span className="block text-base font-semibold tabular-nums">{p.open_issues}</span>
            <span className="block text-xs text-grid-muted">{t("portal.card.issues")}</span>
          </span>
          <span>
            <span className={`block text-base font-semibold tabular-nums ${p.pending_requests > 0 ? "text-grid-action" : ""}`}>{p.pending_requests}</span>
            <span className="block text-xs text-grid-muted">{t("portal.card.requests")}</span>
          </span>
        </div>
      </Link>
    </li>
  )
}

function FileIssueDialog({
  projects,
  onClose,
  onFiled,
}: {
  projects: PortalProject[]
  onClose: () => void
  onFiled: () => void
}) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "")
  const [type, setType] = useState("bug")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const typeLabel: Record<string, string> = {
    bug: t("portal.issue.typeBug"),
    feature: t("portal.issue.typeFeature"),
    task: t("portal.issue.typeTask"),
  }

  const submit = async () => {
    if (!title.trim() || !projectId) return
    setBusy(true)
    try {
      const form = new FormData()
      form.set("project_id", projectId)
      form.set("title", title.trim())
      form.set("body", body.trim())
      form.set("issue_type", type)
      form.set("page_url", window.location.href)
      form.set("route", window.location.pathname)
      // Best-effort screenshot of the portal page via the shared capture core.
      try {
        const { captureViewport } = await import("@/lib/feedback/core")
        const dataUrl = await captureViewport()
        if (dataUrl) {
          const res = await fetch(dataUrl)
          form.set("screenshot", await res.blob(), "screenshot.png")
        }
      } catch {
        /* screenshots are optional */
      }
      await api("/api/w/portal/issues", { method: "POST", form, workspaceId: ws.id })
      toast.success(t("portal.issue.filed"))
      onFiled()
    } catch (err) {
      toast.error(errorText(err, t("portal.issue.failed")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("portal.fileIssue")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel>{t("portal.request.project")}</FieldLabel>
            <Select value={projectId} onValueChange={(v) => setProjectId(v ?? "")}>
              <SelectTrigger>
                <SelectValue>{projects.find((p) => p.id === projectId)?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>{t("portal.issue.type")}</FieldLabel>
            <Select value={type} onValueChange={(v) => setType(v ?? "bug")}>
              <SelectTrigger>
                <SelectValue>{typeLabel[type]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(typeLabel).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>{t("portal.request.title")}</FieldLabel>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </Field>
          <Field>
            <FieldLabel>{t("portal.request.details")}</FieldLabel>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-24" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("portal.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !title.trim() || !projectId}>
            {busy ? t("portal.sending") : t("portal.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
