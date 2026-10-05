"use client"

// The customer's "File an issue" dialog (P7): a bug, feature or task on one of their projects,
// with a best-effort screenshot of the page. POSTs multipart to /api/w/portal/issues.
import { useState } from "react"
import { InboxIcon, PlusIcon } from "lucide-react"

import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, toast } from "@fadymondy/nasaq/web"

import { NewRequestDialog } from "@/components/portal/portal-bits"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import type { PortalProject } from "@/lib/portal"
import { errorText } from "@/lib/work"

/** The portal's two header actions — File an issue, New request — and their dialogs. */
export function PortalActions({ projects, onFiled }: { projects: PortalProject[]; onFiled: () => void }) {
  const { t } = useTranslations()
  const [dialog, setDialog] = useState<"issue" | "request" | null>(null)
  const done = () => {
    setDialog(null)
    onFiled()
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => setDialog("issue")} disabled={projects.length === 0}>
        <PlusIcon /> {t("portal.fileIssue")}
      </Button>
      <Button variant="primary" onClick={() => setDialog("request")} disabled={projects.length === 0} data-action="new-request">
        <InboxIcon /> {t("portal.newRequest")}
      </Button>
      {dialog === "request" ? <NewRequestDialog projects={projects} onClose={() => setDialog(null)} onFiled={done} /> : null}
      {dialog === "issue" ? <FileIssueDialog projects={projects} onClose={() => setDialog(null)} onFiled={done} /> : null}
    </div>
  )
}

export function FileIssueDialog({
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
