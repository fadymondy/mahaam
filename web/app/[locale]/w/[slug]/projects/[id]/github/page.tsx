"use client"

import Link from "next/link"
import { useState } from "react"
import { ChevronDownIcon, GithubIcon, RocketIcon } from "lucide-react"

import {
  Button,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  GithubActivity,
  Input,
  RadioCard,
  RadioGroup,
  Skeleton,
  Textarea,
  toast,
  type DeploymentStatus,
  type GithubCommit,
  type GithubDeployment,
  type GithubPull,
  type GithubRun,
  type RunStatus,
} from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { EmptyState } from "@/components/states"
import { GithubSkeleton } from "@/components/work/project/project-skeletons"
import { useProjectCtx } from "@/components/work/project-context"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useGitHub, useIntegrations, type Commit, type Deployment, type Pull, type Run, type Workflow } from "@/lib/integrations"
import { useDocumentTitle } from "@/lib/title"
import { errorText, w } from "@/lib/work"

/*
The project's GitHub tab: the linked repository's commits, pull requests, workflow runs and
deployments in Nasaq's GithubActivity (a merged timeline plus one list per feed), and Deploy
(workflow_dispatch, github:deploy) opening the app picker. Members+ read; the endpoints check
visibility and roles.
*/
export default function ProjectGitHubPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const { project: p } = useProjectCtx()
  useDocumentTitle(`GitHub · ${p.name}`)
  const list = useIntegrations(ws.id, p.id)
  const gh = (list.data?.integrations ?? []).find((i) => i.provider === "github")
  const linked = !!gh?.config.repo && gh.status !== "disabled"
  const [deploying, setDeploying] = useState(false)

  if (!list.data && !list.error) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
        <GithubSkeleton />
      </div>
    )
  }
  if (!linked) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-6" data-github-unlinked>
        <EmptyState
          title={t("gh.notLinked")}
          action={
            p.can_manage ? (
              <Button variant="secondary" nativeButton={false} render={<Link href={`/${locale}/w/${ws.slug}/projects/${p.id}/settings?s=integrations`} />}>
                <GithubIcon />
                {t("gh.goSettings")}
              </Button>
            ) : null
          }
        />
      </div>
    )
  }
  const repo = gh!.config.repo!
  const canDeploy = ws.can("github:deploy")
  return (
    <div className="mx-auto w-full max-w-6xl space-y-3 p-4 sm:p-6">
      {gh!.last_error ? (
        <p className="rounded-lg border border-nq-danger/40 bg-nq-danger/5 px-4 py-2 text-sm text-nq-danger-text" dir="auto">
          {gh!.last_error}
        </p>
      ) : null}
      <Feeds projectId={p.id} repo={repo} onDeploy={canDeploy ? async () => setDeploying(true) : undefined} />
      {canDeploy ? <DeployDialog projectId={p.id} defaultRef={gh!.config.default_branch ?? "main"} open={deploying} onOpenChange={setDeploying} /> : null}
    </div>
  )
}

const actor = (login: string) => (login ? { login, avatar: `https://github.com/${login}.png?size=48`, href: `https://github.com/${login}` } : { login: "—" })

function runStatus(r: { status: string; conclusion: string }): RunStatus {
  if (r.status === "queued" || r.status === "waiting" || r.status === "pending" || r.status === "requested") return "queued"
  if (r.status === "in_progress") return "in_progress"
  if (r.conclusion === "success") return "success"
  if (r.conclusion === "cancelled") return "cancelled"
  if (r.conclusion === "skipped" || r.conclusion === "neutral") return "skipped"
  return "failure"
}

function deploymentStatus(state: string): DeploymentStatus {
  if (state === "success") return "success"
  if (state === "failure" || state === "error") return "failure"
  if (state === "in_progress" || state === "queued") return "in_progress"
  if (state === "inactive") return "inactive"
  return "pending"
}

// Fetches the four feeds in parallel and hands them to GithubActivity, which owns the tabs,
// the merged timeline and the filter box.
function Feeds({ projectId, repo, onDeploy }: { projectId: string; repo: string; onDeploy?: () => Promise<void> }) {
  const ws = useWorkspace()
  const { t } = useTranslations()
  const commits = useGitHub<{ commits: Commit[] | null }>(ws.id, projectId, "commits")
  const pulls = useGitHub<{ pulls: Pull[] | null }>(ws.id, projectId, "pulls?state=all")
  const runs = useGitHub<{ runs: Run[] | null }>(ws.id, projectId, "runs")
  const deployments = useGitHub<{ deployments: Deployment[] | null }>(ws.id, projectId, "deployments")
  const [owner, name] = repo.split("/")
  const failed = commits.error ?? pulls.error ?? runs.error ?? deployments.error
  const loading = [commits, pulls, runs, deployments].some((q) => !q.data && !q.error)

  return (
    <>
      {failed ? <p className="text-sm text-nq-danger-text">{errorText(failed, t("common.networkError"))}</p> : null}
      <GithubActivity
        repo={{ owner, name, href: `https://github.com/${repo}` }}
        commits={(commits.data?.commits ?? []).map(
          (c): GithubCommit => ({ id: c.sha, message: c.message, author: actor(c.author_login || c.author_name), date: c.date, href: c.url }),
        )}
        pulls={(pulls.data?.pulls ?? []).map(
          (x): GithubPull => ({
            id: String(x.number),
            number: x.number,
            title: x.title,
            author: actor(x.author),
            state: x.merged_at ? "merged" : x.draft ? "draft" : x.state === "closed" ? "closed" : "open",
            createdAt: x.created_at,
            mergedAt: x.merged_at,
            href: x.url,
            head: x.head,
            base: x.base,
          }),
        )}
        runs={(runs.data?.runs ?? []).map(
          (r): GithubRun => ({
            id: String(r.id),
            name: r.name,
            status: runStatus(r),
            branch: r.branch,
            sha: r.sha,
            event: r.event,
            actor: r.actor ? actor(r.actor) : undefined,
            startedAt: r.created_at,
            href: r.url,
          }),
        )}
        deployments={(deployments.data?.deployments ?? []).map(
          (d): GithubDeployment => ({
            id: String(d.id),
            environment: d.environment,
            status: deploymentStatus(d.state),
            ref: d.ref,
            sha: d.sha,
            creator: d.creator ? actor(d.creator) : undefined,
            createdAt: d.created_at,
            url: d.url || undefined,
          }),
        )}
        loading={loading}
        onRefresh={async () => {
          await Promise.all([commits.mutate(), pulls.mutate(), runs.mutate(), deployments.mutate()])
        }}
        onDeploy={onDeploy}
        data-github-activity
      />
    </>
  )
}

function DeployDialog({
  projectId,
  defaultRef,
  open,
  onOpenChange: setOpen,
}: {
  projectId: string
  defaultRef: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [picked, setPicked] = useState("")
  const [ref, setRef] = useState(defaultRef)
  const [inputs, setInputs] = useState("")
  const [busy, setBusy] = useState(false)
  const flows = useGitHub<{ workflows: Workflow[] | null }>(ws.id, projectId, open ? "workflows" : null)
  // Every active workflow with a workflow_dispatch trigger is an app you can ship; one is picked for you.
  const list = (flows.data?.workflows ?? []).filter((f) => f.state === "active")
  const workflow = picked || (list.length === 1 ? String(list[0].id) : "")
  const app = list.find((f) => String(f.id) === workflow)
  const submit = async () => {
    const parsed: Record<string, string> = {}
    for (const line of inputs.split("\n")) {
      const i = line.indexOf("=")
      if (i > 0) parsed[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
    setBusy(true)
    try {
      await w.post(ws.id, `/api/w/projects/${projectId}/github/deploy`, {
        workflow,
        ref,
        inputs: parsed,
      })
      toast.success(t("gh.deployed"))
      setOpen(false)
      setPicked("")
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("gh.deployNow")}</DialogTitle>
          <DialogDescription>{t("gh.pickApp")}</DialogDescription>
        </DialogHeader>
        {flows.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : flows.error ? (
          <p className="text-sm text-nq-danger-text">{errorText(flows.error, t("common.networkError"))}</p>
        ) : list.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{t("gh.noApps")}</p>
        ) : (
          <RadioGroup value={workflow} onValueChange={(v) => setPicked(String(v ?? ""))} aria-label={t("gh.app")} className="flex flex-col gap-2" data-deploy-apps>
            {list.map((f) => (
              <RadioCard
                key={f.id}
                value={String(f.id)}
                title={<span dir="auto">{f.name}</span>}
                description={
                  <Ltr mono className="text-caption">
                    {f.path.split("/").pop()}
                  </Ltr>
                }
                meta={<RocketIcon className="size-4 text-muted-foreground" />}
              />
            ))}
          </RadioGroup>
        )}
        <Field>
          <FieldLabel htmlFor="gh-ref">{t("gh.ref")}</FieldLabel>
          <Input id="gh-ref" dir="ltr" value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="-ms-2" />}>
            <ChevronDownIcon className="transition-transform in-data-panel-open:rotate-180" />
            {t("gh.advanced")}
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <Field className="pt-2">
              <FieldLabel htmlFor="gh-inputs">{t("gh.inputs")}</FieldLabel>
              <Textarea id="gh-inputs" dir="ltr" rows={3} placeholder="environment=production" value={inputs} onChange={(e) => setInputs(e.target.value)} />
            </Field>
          </CollapsiblePanel>
        </Collapsible>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!workflow || !ref.trim() || busy} onClick={submit} data-deploy-start>
            <RocketIcon />
            {app ? t("gh.deployApp", { app: app.name }) : t("gh.deployNow")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
