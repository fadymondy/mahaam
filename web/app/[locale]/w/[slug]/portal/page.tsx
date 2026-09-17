"use client"

import { useState } from "react"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"
import useSWR from "swr"

import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useDocumentTitle } from "@/lib/title"
import { errorText } from "@/lib/work"

/*
The client portal (P7). A client-role member sees only what they are allowed to:
their projects (the API already restricts /api/w/projects to the projects of the
client they are a contact of), the issues they filed, and their own invoices —
read-only. Everything finance/internal (rates, time, other clients, members) is
404 for them at the API, so there is nothing to hide here.
*/

type Project = { id: string; name: string; status: string; client_name: string | null }
type Issue = { key: string; title: string; status: string; issue_type: string; created_at: string }
type Invoice = { id: string; number: string; status: string; currency: string; total_minor: number; issue_date: string }

function scoped<T>(path: string, ws: string) {
  return api<T>(path, { workspaceId: ws })
}

export default function PortalPage() {
  const ws = useWorkspace()
  useDocumentTitle("Portal")
  const projects = useSWR<{ projects: Project[] | null }>(["/api/w/projects", ws.id], ([p, id]: [string, string]) =>
    scoped(p, id),
  )
  const issues = useSWR<{ issues: Issue[] | null }>(["/api/w/portal/issues", ws.id], ([p, id]: [string, string]) =>
    scoped(p, id),
  )
  const invoices = useSWR<{ invoices: Invoice[] | null }>(["/api/w/portal/invoices", ws.id], ([p, id]: [string, string]) =>
    scoped(p, id),
  )
  const [filing, setFiling] = useState(false)

  const projectList = projects.data?.projects ?? []

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8 space-y-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Your portal</h1>
          <p className="text-sm text-grid-muted">Your projects, the issues you filed, and your invoices.</p>
        </div>
        <Button onClick={() => setFiling(true)} disabled={projectList.length === 0}>
          <PlusIcon /> File an issue
        </Button>
      </header>

      <section>
        <h2 className="mb-3 text-base font-medium">Projects</h2>
        {projectList.length === 0 ? (
          <p className="text-sm text-grid-muted">No projects have been shared with you yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {projectList.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-3">
                <span className="font-medium">{p.name}</span>
                <Badge variant="secondary">{p.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-medium">Your issues</h2>
        {(issues.data?.issues ?? []).length === 0 ? (
          <p className="text-sm text-grid-muted">You haven&apos;t filed any issues.</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {(issues.data?.issues ?? []).map((i) => (
              <li key={i.key} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <code className="text-xs text-grid-muted" dir="ltr">
                    {i.key}
                  </code>{" "}
                  <span className="font-medium">{i.title}</span>
                </span>
                <Badge variant="secondary">{i.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-medium">Invoices</h2>
        {(invoices.data?.invoices ?? []).length === 0 ? (
          <p className="text-sm text-grid-muted">No invoices yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {(invoices.data?.invoices ?? []).map((iv) => (
              <li key={iv.id} className="flex items-center justify-between px-4 py-3">
                <span className="font-medium" dir="ltr">
                  {iv.number}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-sm tabular-nums" dir="ltr">
                    {(iv.total_minor / 100).toLocaleString(undefined, { style: "currency", currency: iv.currency })}
                  </span>
                  <Badge variant="secondary">{iv.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {filing ? (
        <FileIssueDialog
          projects={projectList}
          onClose={() => setFiling(false)}
          onFiled={() => {
            setFiling(false)
            issues.mutate()
          }}
        />
      ) : null}
    </div>
  )
}

function FileIssueDialog({
  projects,
  onClose,
  onFiled,
}: {
  projects: Project[]
  onClose: () => void
  onFiled: () => void
}) {
  const ws = useWorkspace()
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "")
  const [type, setType] = useState("bug")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)

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
      toast.success("Issue filed")
      onFiled()
    } catch (err) {
      toast.error(errorText(err, "Could not file the issue"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>File an issue</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel>Project</FieldLabel>
            <Select value={projectId} onValueChange={(v) => setProjectId(v ?? "")}>
              <SelectTrigger>
                <SelectValue />
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
            <FieldLabel>Type</FieldLabel>
            <Select value={type} onValueChange={(v) => setType(v ?? "bug")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bug">Something is broken</SelectItem>
                <SelectItem value="feature">An idea</SelectItem>
                <SelectItem value="task">Something else</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Summary</FieldLabel>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </Field>
          <Field>
            <FieldLabel>Details</FieldLabel>
            <textarea
              className="min-h-[100px] w-full rounded-md border border-line bg-transparent px-3 py-2 text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !title.trim() || !projectId}>
            {busy ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
