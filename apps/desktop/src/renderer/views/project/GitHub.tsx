// The project's GitHub tab (renderer/views/Project.tsx renders it under the project header): the
// linked repository's commits (by branch), pull requests, workflow runs and deployments, and a
// Deploy button (workflow_dispatch, manager+). Mirrors web/app/[locale]/w/[slug]/projects/[id]/github.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLinkIcon, GithubIcon, RocketIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import type { GhCommit, GhDeployment, GhPull, GhRun } from "../../../main/api-projectMoney";
import { EmptyState, LtrText } from "@/components/kit";
import { Segmented } from "@/components/issues/controls";
import { Badge } from "@/components/settings/parts";
import { SmallButton } from "@/components/settings/parts";
import { Field, Gate, areaCls, errText, inputCls, isManager } from "@/components/projectMoney/shared";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApp } from "@/lib/app";
import { api, desktop } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";

type Tab = "commits" | "pulls" | "runs" | "deployments";

const open = (url: string) => void desktop.openExternal(url);

export function ProjectGitHub({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const { ws, workspace } = useApp();
  const detail = useQuery({ queryKey: qk.project(ws, projectId), queryFn: () => api.project(projectId), enabled: !!ws, staleTime: 60_000 });
  const list = useQuery({ queryKey: ["w", ws, "integrations", projectId], queryFn: () => api.projectIntegrations(projectId), enabled: !!ws });
  const [tab, setTab] = useState<Tab>("commits");
  const [branch, setBranch] = useState("");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <Gate
        q={list}
        render={(items) => {
          const gh = items.find((i) => i.provider === "github");
          const repo = gh?.status !== "disabled" ? gh?.config.repo : undefined;
          if (!gh || !repo) {
            if (detail.data?.can_manage && gh?.status !== "disabled") return <LinkRepo projectId={projectId} />;
            return <NotLinked projectId={projectId} canManage={!!detail.data?.can_manage} />;
          }
          const defaultBranch = gh.config.default_branch ?? "main";
          return (
            <div className="flex flex-col gap-3 px-6 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => open(`https://github.com/${repo}`)} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-grid-fg hover:underline">
                  <GithubIcon className="size-4" />
                  <LtrText>{repo}</LtrText>
                  <ExternalLinkIcon className="size-3.5 text-grid-muted" />
                </button>
                {gh.last_error ? (
                  <span className="text-[13px] text-grid-danger" dir="auto">
                    {gh.last_error}
                  </span>
                ) : null}
                <div className="flex-1" />
                {isManager(workspace?.role) ? <DeployButton projectId={projectId} defaultRef={defaultBranch} /> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Segmented<Tab>
                  label={t("projectMoney.gh.title")}
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "commits", label: t("projectMoney.gh.commits") },
                    { value: "pulls", label: t("projectMoney.gh.pulls") },
                    { value: "runs", label: t("projectMoney.gh.runs") },
                    { value: "deployments", label: t("projectMoney.gh.deployments") },
                  ]}
                />
                {tab === "commits" ? (
                  <input
                    dir="ltr"
                    className={`${inputCls} max-w-56`}
                    placeholder={`${t("projectMoney.gh.branch")} (${defaultBranch})`}
                    aria-label={t("projectMoney.gh.branch")}
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                  />
                ) : null}
              </div>
              {tab === "commits" ? <Commits projectId={projectId} branch={branch.trim()} /> : null}
              {tab === "pulls" ? <Pulls projectId={projectId} /> : null}
              {tab === "runs" ? <Runs projectId={projectId} /> : null}
              {tab === "deployments" ? <Deployments projectId={projectId} /> : null}
            </div>
          );
        }}
      />
    </div>
  );
}

function NotLinked({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={<GithubIcon />}
      title={t("projectMoney.gh.notLinked")}
      body={t("projectMoney.gh.notLinkedBody")}
      action={
        canManage ? (
          <SmallButton onClick={() => void desktop.openWeb(`/projects/${encodeURIComponent(projectId)}/settings?s=integrations`)}>
            <ExternalLinkIcon /> {t("projectMoney.gh.goSettings")}
          </SmallButton>
        ) : undefined
      }
    />
  );
}

// No repository yet, but a manager: GitHub installs its App once per account, so offer the
// repositories of the installation this workspace already has. A 404 means nothing is installed
// yet, and installing goes through the web console.
function LinkRepo({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const ws = useApp().ws;
  const qc = useQueryClient();
  const repos = useQuery({ queryKey: ["w", ws, "github", projectId, "repos"], queryFn: () => api.githubRepos(projectId), enabled: !!ws, retry: false });
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  if (repos.isPending) return <p className="py-6 text-center text-[13.5px] text-grid-muted">{t("projectMoney.loading")}</p>;
  if (repos.isError || !repos.data.length) return <NotLinked projectId={projectId} canManage />;
  const link = async () => {
    setBusy(true);
    try {
      await api.githubLinkRepo(projectId, repo);
      toast.success(t("projectMoney.gh.linked"));
      await qc.invalidateQueries({ queryKey: ["w", ws, "integrations", projectId] });
    } catch (err) {
      toast.error(errText(err, t("projectMoney.failed")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <EmptyState
      icon={<GithubIcon />}
      title={t("projectMoney.gh.notLinked")}
      body={t("projectMoney.gh.pickBody")}
      action={
        <div className="flex w-full max-w-md flex-col items-stretch gap-2">
          <RepoSearch repos={repos.data.map((r) => r.full_name)} value={repo} onChange={setRepo} />
          <SmallButton tone="primary" disabled={!repo || busy} onClick={() => void link()}>
            <GithubIcon /> {t("projectMoney.gh.link")}
          </SmallButton>
        </div>
      }
    />
  );
}

// A searchable list rather than a select: an account can have hundreds of repositories.
function RepoSearch({ repos, value, onChange }: { repos: string[]; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? repos.filter((r) => r.toLowerCase().includes(needle)) : repos;
  return (
    <div className="flex flex-col gap-1">
      <input dir="ltr" autoFocus className={inputCls} placeholder={t("projectMoney.gh.searchRepo")} aria-label={t("projectMoney.gh.searchRepo")} value={q} onChange={(e) => setQ(e.target.value)} />
      <ul role="listbox" aria-label={t("projectMoney.gh.pickRepo")} className="max-h-60 overflow-y-auto rounded-lg border border-line text-start">
        {shown.length ? (
          shown.slice(0, 200).map((r) => (
            <li key={r} role="option" aria-selected={r === value}>
              <button
                type="button"
                dir="ltr"
                onClick={() => onChange(r)}
                className={`block w-full truncate px-3 py-1.5 text-start text-[13.5px] hover:bg-grid-soft ${r === value ? "bg-grid-soft font-medium" : ""}`}
              >
                {r}
              </button>
            </li>
          ))
        ) : (
          <li className="px-3 py-2 text-[13px] text-grid-muted">{t("projectMoney.gh.noMatch")}</li>
        )}
      </ul>
    </div>
  );
}

function Rows({ children, empty }: { children: ReactNode; empty: boolean }) {
  const { t } = useI18n();
  if (empty) return <p className="py-6 text-center text-[13.5px] text-grid-muted">{t("projectMoney.gh.empty")}</p>;
  return <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">{children}</ul>;
}

function Row({ children }: { children: ReactNode }) {
  return <li className="flex h-9 items-center gap-3 px-3 text-[13.5px] hover:bg-grid-soft">{children}</li>;
}

function Link({ url, children }: { url: string; children: ReactNode }) {
  return (
    <button type="button" onClick={() => open(url)} className="min-w-0 flex-1 truncate text-start text-grid-fg hover:underline" dir="auto">
      {children}
    </button>
  );
}

function When({ iso }: { iso: string }) {
  const { relative, date } = useI18n();
  return (
    <span className="w-24 shrink-0 text-end text-[12.5px] text-grid-muted" title={date(iso, { dateStyle: "medium", timeStyle: "short" })}>
      {relative(iso)}
    </span>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return <LtrText className="hidden shrink-0 truncate text-[12.5px] text-grid-muted md:inline">{children}</LtrText>;
}

function tone(conclusion: string): "ok" | "warn" | "muted" {
  if (conclusion === "success") return "ok";
  if (["failure", "cancelled", "timed_out", "error"].includes(conclusion)) return "warn";
  return "muted";
}

function Commits({ projectId, branch }: { projectId: string; branch: string }) {
  const ws = useApp().ws;
  const q = useQuery({ queryKey: ["w", ws, "github", projectId, "commits", branch], queryFn: () => api.githubCommits(projectId, branch), enabled: !!ws });
  return (
    <Gate
      q={q}
      render={(list: GhCommit[]) => (
        <Rows empty={!list.length}>
          {list.map((c) => (
            <Row key={c.sha}>
              <code className="shrink-0 font-mono text-[12px] text-grid-muted" dir="ltr">
                {c.sha.slice(0, 7)}
              </code>
              <Link url={c.url}>{c.message.split("\n")[0]}</Link>
              <Meta>{c.author_login || c.author_name}</Meta>
              <When iso={c.date} />
            </Row>
          ))}
        </Rows>
      )}
    />
  );
}

function Pulls({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const ws = useApp().ws;
  const q = useQuery({ queryKey: ["w", ws, "github", projectId, "pulls"], queryFn: () => api.githubPulls(projectId), enabled: !!ws });
  return (
    <Gate
      q={q}
      render={(list: GhPull[]) => (
        <Rows empty={!list.length}>
          {list.map((x) => (
            <Row key={x.number}>
              <LtrText className="shrink-0 text-[12.5px] text-grid-muted">#{x.number}</LtrText>
              <Link url={x.url}>{x.title}</Link>
              {x.merged_at ? (
                <Badge tone="action">{t("projectMoney.gh.merged")}</Badge>
              ) : x.draft ? (
                <Badge>{t("projectMoney.gh.draft")}</Badge>
              ) : (
                <Badge tone={x.state === "open" ? "ok" : "muted"}>{x.state === "open" ? t("projectMoney.gh.open") : t("projectMoney.gh.closed")}</Badge>
              )}
              <Meta>
                {x.head} → {x.base}
              </Meta>
              <When iso={x.updated_at} />
            </Row>
          ))}
        </Rows>
      )}
    />
  );
}

function Runs({ projectId }: { projectId: string }) {
  const ws = useApp().ws;
  const q = useQuery({ queryKey: ["w", ws, "github", projectId, "runs"], queryFn: () => api.githubRuns(projectId), enabled: !!ws });
  return (
    <Gate
      q={q}
      render={(list: GhRun[]) => (
        <Rows empty={!list.length}>
          {list.map((r) => (
            <Row key={r.id}>
              <span dir="ltr">
                <Badge tone={tone(r.conclusion)}>{r.conclusion || r.status}</Badge>
              </span>
              <Link url={r.url}>{r.name}</Link>
              <Meta>
                {r.branch} · {r.event}
              </Meta>
              <When iso={r.created_at} />
            </Row>
          ))}
        </Rows>
      )}
    />
  );
}

function Deployments({ projectId }: { projectId: string }) {
  const ws = useApp().ws;
  const q = useQuery({ queryKey: ["w", ws, "github", projectId, "deployments"], queryFn: () => api.githubDeployments(projectId), enabled: !!ws });
  return (
    <Gate
      q={q}
      render={(list: GhDeployment[]) => (
        <Rows empty={!list.length}>
          {list.map((x) => (
            <Row key={x.id}>
              <span dir="ltr">
                <Badge tone={tone(x.state)}>{x.state || "—"}</Badge>
              </span>
              {x.url ? <Link url={x.url}>{x.environment}</Link> : <span className="min-w-0 flex-1 truncate" dir="ltr">{x.environment}</span>}
              <Meta>
                {x.ref} · {x.sha.slice(0, 7)}
              </Meta>
              <When iso={x.created_at} />
            </Row>
          ))}
        </Rows>
      )}
    />
  );
}

function DeployButton({ projectId, defaultRef }: { projectId: string; defaultRef: string }) {
  const { t } = useI18n();
  const ws = useApp().ws;
  const [show, setShow] = useState(false);
  const [workflow, setWorkflow] = useState("");
  const [ref, setRef] = useState(defaultRef);
  const [inputs, setInputs] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flows = useQuery({ queryKey: ["w", ws, "github", projectId, "workflows"], queryFn: () => api.githubWorkflows(projectId), enabled: !!ws && show });
  const active = (flows.data ?? []).filter((f) => f.state === "active");

  const submit = async () => {
    const parsed: Record<string, string> = {};
    for (const line of inputs.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) parsed[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    setBusy(true);
    setError(null);
    try {
      await api.githubDeploy(projectId, { workflow, ref: ref.trim() || undefined, inputs: parsed });
      toast.success(t("projectMoney.gh.deployed"));
      setShow(false);
    } catch (err) {
      setError(errText(err, t("projectMoney.failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SmallButton tone="primary" onClick={() => { setError(null); setShow(true); }}>
        <RocketIcon /> {t("projectMoney.gh.deploy")}
      </SmallButton>
      <Dialog open={show} onOpenChange={setShow}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("projectMoney.gh.deployTitle")}</DialogTitle>
            <DialogDescription>{t("projectMoney.gh.deployHint")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Field label={t("projectMoney.gh.workflow")} htmlFor="gh-wf">
              <select id="gh-wf" className={inputCls} value={workflow} onChange={(e) => setWorkflow(e.target.value)} disabled={!flows.data}>
                <option value="">{flows.data ? t("projectMoney.gh.pickWorkflow") : t("projectMoney.loading")}</option>
                {active.map((f) => (
                  <option key={f.id} value={String(f.id)}>
                    {f.name} · {f.path.split("/").pop()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("projectMoney.gh.ref")} htmlFor="gh-ref">
              <input id="gh-ref" dir="ltr" className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} />
            </Field>
            <Field label={t("projectMoney.gh.inputs")} htmlFor="gh-inputs" hint={t("projectMoney.gh.inputsHint")}>
              <textarea id="gh-inputs" dir="ltr" rows={3} className={areaCls} placeholder="environment=production" value={inputs} onChange={(e) => setInputs(e.target.value)} />
            </Field>
            {error || flows.error ? (
              <p className="text-[13px] text-grid-danger" role="alert">
                {error ?? errText(flows.error, t("projectMoney.failed"))}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <SmallButton onClick={() => setShow(false)}>{t("projectMoney.cancel")}</SmallButton>
            <SmallButton tone="primary" disabled={!workflow || busy} onClick={() => void submit()}>
              <RocketIcon /> {t("projectMoney.gh.deploy")}
            </SmallButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
