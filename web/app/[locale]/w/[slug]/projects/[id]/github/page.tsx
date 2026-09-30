"use client"

import Link from "next/link"
import { useState } from "react"
import { ExternalLinkIcon, RocketIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Tabs, TabsList, TabsPanel, TabsTab, Textarea } from "@fadymondy/nasaq/web"









import { useProjectCtx } from "@/components/work/project-context"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useGitHub, useIntegrations, type Commit, type Deployment, type Pull, type Run, type Workflow } from "@/lib/integrations"
import { useDocumentTitle } from "@/lib/title"
import { errorText, w } from "@/lib/work"

/*
The project's GitHub tab: commits (by branch), pull requests, workflow runs and deployments of
the linked repository, and a Deploy button (workflow_dispatch, manager+). Members+ read; the
endpoints check visibility and roles.
*/
export default function ProjectGitHubPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const { project: p } = useProjectCtx()
  useDocumentTitle(`GitHub · ${p.name}`)
  const list = useIntegrations(ws.id, p.id)
  const gh = (list.data?.integrations ?? []).find((i) => i.provider === "github")
  const linked = !!gh?.config.repo && gh.status !== "disabled"
  const [tab, setTab] = useState("commits")
  const [branch, setBranch] = useState("")

  if (!list.data && !list.error) return <div className="space-y-2 p-6"><Skeleton className="h-6 w-64" /><Skeleton className="h-40 w-full" /></div>
  if (!linked) {
    return (
      <div className="px-6 py-8 text-sm">
        <p className="text-grid-muted">{t("gh.notLinked")}</p>
        {p.can_manage ? (
          <Button variant="secondary" className="mt-3" nativeButton={false} render={<Link href={`/${locale}/w/${ws.slug}/projects/${p.id}/settings?s=integrations`} />}>
            {t("gh.goSettings")}
          </Button>
        ) : null}
      </div>
    )
  }
  const repo = gh!.config.repo!
  return (
    <div className="px-6 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer" dir="ltr" className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
          {repo}
          <ExternalLinkIcon className="size-3.5" />
        </a>
        {gh!.last_error ? <span className="text-sm text-destructive" dir="auto">{gh!.last_error}</span> : null}
        <div className="flex-1" />
        {ws.can("github:deploy") ? <DeployButton projectId={p.id} defaultRef={gh!.config.default_branch ?? "main"} /> : null}
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList variant="underline">
          <TabsTab value="commits">{t("gh.commits")}</TabsTab>
          <TabsTab value="pulls">{t("gh.pulls")}</TabsTab>
          <TabsTab value="runs">{t("gh.runs")}</TabsTab>
          <TabsTab value="deployments">{t("gh.deployments")}</TabsTab>
        </TabsList>
        <TabsPanel value="commits" className="pt-4">
          <Input dir="ltr" className="mb-3 max-w-60" placeholder={`${t("gh.branch")} (${gh!.config.default_branch ?? "main"})`} value={branch} onChange={(e) => setBranch(e.target.value)} />
          <Commits projectId={p.id} branch={branch.trim()} active={tab === "commits"} />
        </TabsPanel>
        <TabsPanel value="pulls" className="pt-4">
          <Pulls projectId={p.id} active={tab === "pulls"} />
        </TabsPanel>
        <TabsPanel value="runs" className="pt-4">
          <Runs projectId={p.id} active={tab === "runs"} />
        </TabsPanel>
        <TabsPanel value="deployments" className="pt-4">
          <Deployments projectId={p.id} active={tab === "deployments"} />
        </TabsPanel>
      </Tabs>
    </div>
  )
}

function State<T>({ q, render }: { q: { data?: T; error?: unknown }; render: (d: T) => React.ReactNode }) {
  const { t } = useTranslations()
  if (q.error) return <p className="text-sm text-destructive">{errorText(q.error, t("common.networkError"))}</p>
  if (!q.data) return <Skeleton className="h-32 w-full" />
  return <>{render(q.data)}</>
}

function Rows({ children, empty }: { children: React.ReactNode[]; empty: boolean }) {
  const { t } = useTranslations()
  if (empty) return <p className="text-sm text-grid-muted">{t("gh.empty")}</p>
  return <ul className="divide-y divide-line border-y border-line">{children}</ul>
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline" dir="auto">
      {children}
    </a>
  )
}

function Commits({ projectId, branch, active }: { projectId: string; branch: string; active: boolean }) {
  const ws = useWorkspace()
  const { formatDate } = useTranslations()
  const q = useGitHub<{ commits: Commit[] | null }>(ws.id, projectId, active ? `commits${branch ? `?branch=${encodeURIComponent(branch)}` : ""}` : null)
  return (
    <State q={q} render={(d) => (
      <Rows empty={!d.commits?.length}>
        {(d.commits ?? []).map((c) => (
          <li key={c.sha} className="flex items-center gap-3 py-2 text-sm">
            <code className="text-xs text-grid-muted" dir="ltr">{c.sha.slice(0, 7)}</code>
            <Ext href={c.url}>{c.message}</Ext>
            <span className="text-meta text-grid-muted" dir="ltr">{c.author_login || c.author_name}</span>
            <span className="w-28 text-end text-meta text-grid-muted">{formatDate(c.date)}</span>
          </li>
        ))}
      </Rows>
    )} />
  )
}

function Pulls({ projectId, active }: { projectId: string; active: boolean }) {
  const ws = useWorkspace()
  const { t, formatDate } = useTranslations()
  const q = useGitHub<{ pulls: Pull[] | null }>(ws.id, projectId, active ? "pulls?state=all" : null)
  return (
    <State q={q} render={(d) => (
      <Rows empty={!d.pulls?.length}>
        {(d.pulls ?? []).map((x) => (
          <li key={x.number} className="flex items-center gap-3 py-2 text-sm">
            <span className="text-meta text-grid-muted" dir="ltr">#{x.number}</span>
            <Ext href={x.url}>{x.title}</Ext>
            {x.merged_at ? <Badge variant="brand">{t("gh.merged")}</Badge> : x.draft ? <Badge variant="neutral">{t("gh.draft")}</Badge> : <Badge variant="outline">{x.state}</Badge>}
            <span className="hidden text-meta text-grid-muted sm:inline" dir="ltr">{x.head} → {x.base}</span>
            <span className="w-28 text-end text-meta text-grid-muted">{formatDate(x.updated_at)}</span>
          </li>
        ))}
      </Rows>
    )} />
  )
}

function runVariant(r: { status: string; conclusion: string }) {
  if (r.conclusion === "success") return "success"
  if (r.conclusion === "failure" || r.conclusion === "cancelled" || r.conclusion === "timed_out") return "danger"
  return "neutral"
}

function Runs({ projectId, active }: { projectId: string; active: boolean }) {
  const ws = useWorkspace()
  const { formatDate } = useTranslations()
  const q = useGitHub<{ runs: Run[] | null }>(ws.id, projectId, active ? "runs" : null)
  return (
    <State q={q} render={(d) => (
      <Rows empty={!d.runs?.length}>
        {(d.runs ?? []).map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
            <Badge variant={runVariant(r)} dir="ltr">{r.conclusion || r.status}</Badge>
            <Ext href={r.url}>{r.name}</Ext>
            <span className="text-meta text-grid-muted" dir="ltr">{r.branch} · {r.event}</span>
            <span className="w-28 text-end text-meta text-grid-muted">{formatDate(r.created_at)}</span>
          </li>
        ))}
      </Rows>
    )} />
  )
}

function Deployments({ projectId, active }: { projectId: string; active: boolean }) {
  const ws = useWorkspace()
  const { formatDate } = useTranslations()
  const q = useGitHub<{ deployments: Deployment[] | null }>(ws.id, projectId, active ? "deployments" : null)
  return (
    <State q={q} render={(d) => (
      <Rows empty={!d.deployments?.length}>
        {(d.deployments ?? []).map((x) => (
          <li key={x.id} className="flex items-center gap-3 py-2 text-sm">
            <Badge variant={runVariant({ status: x.state, conclusion: x.state === "success" ? "success" : x.state === "failure" || x.state === "error" ? "failure" : "" })} dir="ltr">
              {x.state || "—"}
            </Badge>
            <span className="min-w-0 flex-1 truncate font-medium" dir="ltr">{x.environment}</span>
            <span className="text-meta text-grid-muted" dir="ltr">{x.ref} · {x.sha.slice(0, 7)}</span>
            {x.url ? <a href={x.url} target="_blank" rel="noreferrer" aria-label="log"><ExternalLinkIcon className="size-3.5" /></a> : null}
            <span className="w-28 text-end text-meta text-grid-muted">{formatDate(x.created_at)}</span>
          </li>
        ))}
      </Rows>
    )} />
  )
}

function DeployButton({ projectId, defaultRef }: { projectId: string; defaultRef: string }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [open, setOpen] = useState(false)
  const [workflow, setWorkflow] = useState("")
  const [ref, setRef] = useState(defaultRef)
  const [inputs, setInputs] = useState("")
  const [busy, setBusy] = useState(false)
  const flows = useGitHub<{ workflows: Workflow[] | null }>(ws.id, projectId, open ? "workflows" : null)
  const list = (flows.data?.workflows ?? []).filter((f) => f.state === "active")
  const submit = async () => {
    const parsed: Record<string, string> = {}
    for (const line of inputs.split("\n")) {
      const i = line.indexOf("=")
      if (i > 0) parsed[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
    setBusy(true)
    try {
      await w.post(ws.id, `/api/w/projects/${projectId}/github/deploy`, { workflow, ref, inputs: parsed })
      toast.success(t("gh.deployed"))
      setOpen(false)
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <RocketIcon />
        {t("gh.deploy")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("gh.deployTitle")}</DialogTitle>
            <DialogDescription>{t("gh.deployHint")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="gh-wf">{t("gh.workflow")}</FieldLabel>
            <Select items={list.map((f) => ({ value: String(f.id), label: f.name }))} value={workflow} onValueChange={(v) => setWorkflow(String(v ?? ""))}>
              <SelectTrigger id="gh-wf" className="w-full">
                <SelectValue placeholder={t("gh.workflow")} />
              </SelectTrigger>
              <SelectContent>
                {list.map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    <span dir="ltr">{f.name} · {f.path.split("/").pop()}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="gh-ref">{t("gh.ref")}</FieldLabel>
            <Input id="gh-ref" dir="ltr" value={ref} onChange={(e) => setRef(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="gh-inputs">{t("gh.inputs")}</FieldLabel>
            <Textarea id="gh-inputs" dir="ltr" rows={3} placeholder="environment=production" value={inputs} onChange={(e) => setInputs(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={!workflow || busy} onClick={submit}>
              {t("gh.deploy")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
