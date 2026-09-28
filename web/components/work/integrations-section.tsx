"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"
import useSWR from "swr"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ConfirmButton } from "@/components/confirm-button"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useIntegrations, type Integration, type Provider, type Repo, type SyncResult } from "@/lib/integrations"
import { errorText, w } from "@/lib/work"

/*
Project settings → Integrations: install the GitHub App and pick the repository, connect Jira or
Linear import (the credential is write-only: sealed server-side, never shown again), and see each
integration's status, last sync and last error with a Sync button. Reading is member+; every
change is manager+ (integrations:manage) — the endpoints enforce both.
*/
export function IntegrationsSection({ projectId }: { projectId: string }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const search = useSearchParams()
  const canManage = ws.can("integrations:manage")
  const list = useIntegrations(ws.id, projectId)
  const by = (p: Provider) => (list.data?.integrations ?? []).find((i) => i.provider === p)

  useEffect(() => {
    if (search.get("integration") === "github") toast.success(t("int.github.connected"))
  }, [search, t])

  const reload = () => void list.mutate()

  return (
    <section id="integrations" className="border-b border-line">
      <div className="px-6 pt-6 pb-3">
        <h2 className="text-base font-medium">{t("int.title")}</h2>
        <p className="mt-1 text-sm text-grid-muted">{t("int.hint")}</p>
      </div>
      <div className="divide-y divide-line border-y border-line">
        <GitHubCard projectId={projectId} it={by("github")} canManage={canManage} onChanged={reload} />
        <JiraCard projectId={projectId} it={by("jira")} canManage={canManage} onChanged={reload} />
        <LinearCard projectId={projectId} it={by("linear")} canManage={canManage} onChanged={reload} />
      </div>
    </section>
  )
}

function statusVariant(s: Integration["status"]) {
  return s === "active" ? "default" : s === "error" ? "destructive" : "secondary"
}

function Header({ name, desc, it, canManage, projectId, onChanged }: { name: string; desc: string; it?: Integration; canManage: boolean; projectId: string; onChanged: () => void }) {
  const { t, formatDate } = useTranslations()
  const ws = useWorkspace()
  const [busy, setBusy] = useState(false)
  const sync = async () => {
    if (!it) return
    setBusy(true)
    try {
      const r = await w.post<SyncResult>(ws.id, `/api/w/projects/${projectId}/integrations/${it.provider}/sync`)
      toast.success(t("int.synced", { fetched: r.fetched, created: r.created, updated: r.updated }))
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
      onChanged()
    }
  }
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{name}</h3>
          {it ? <Badge variant={statusVariant(it.status)}>{t(`int.status.${it.status}`)}</Badge> : <Badge variant="outline">{t("int.notConnected")}</Badge>}
          {it ? (
            <span className="text-meta text-grid-muted">{it.last_synced_at ? t("int.lastSync", { when: formatDate(it.last_synced_at) }) : t("int.neverSynced")}</span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-grid-muted">{desc}</p>
        {it?.last_error ? (
          <p className="mt-2 text-sm text-destructive" dir="auto">
            {it.last_error}
          </p>
        ) : null}
      </div>
      {it && canManage ? (
        <div className="flex items-center gap-2">
          {it.status !== "pending" && it.status !== "disabled" ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={sync}>
              <RefreshCwIcon className={busy ? "animate-spin" : undefined} />
              {t("int.sync")}
            </Button>
          ) : null}
          <ConfirmButton
            label={t("int.disconnect")}
            title={t("int.disconnectTitle", { provider: name })}
            description={t("int.disconnectBody")}
            confirmLabel={t("int.disconnect")}
            onConfirm={async () => {
              try {
                await w.del(ws.id, `/api/w/projects/${projectId}/integrations/${it.provider}`)
              } catch (err) {
                toast.error(errorText(err, t("common.networkError")))
              }
              onChanged()
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

function GitHubCard({ projectId, it, canManage, onChanged }: { projectId: string; it?: Integration; canManage: boolean; onChanged: () => void }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const [repo, setRepo] = useState("")
  // With no GitHub row yet, the repos call falls back to the App installation another project in
  // this workspace made (GitHub installs once per account), so the picker shows without a second install.
  const needsRepo = it?.status !== "disabled" && canManage
  const repos = useSWR<{ repos: Repo[] | null }>(
    needsRepo ? [`/api/w/projects/${projectId}/integrations/github/repos`, ws.id] : null,
    ([p, id]: [string, string]) => api(p, { workspaceId: id }),
    { shouldRetryOnError: false, revalidateOnFocus: false },
  )
  const install = async () => {
    try {
      const r = await api<{ url: string }>(`/api/w/projects/${projectId}/integrations/github/install?locale=${locale}`, { workspaceId: ws.id })
      window.location.assign(r.url)
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
  }
  const link = async () => {
    try {
      await w.put(ws.id, `/api/w/projects/${projectId}/integrations/github/repo`, { repo })
      toast.success(t("int.github.linked"))
      setRepo("")
      onChanged()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
  }
  const list = repos.data?.repos ?? []
  const current = it?.config.repo
  return (
    <div className="space-y-3 px-6 py-4" data-integration="github">
      <Header name="GitHub" desc={t("int.github.desc")} it={it} canManage={canManage} projectId={projectId} onChanged={onChanged} />
      {current ? (
        <p className="text-sm">
          {t("int.github.repo")}:{" "}
          <a className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline" dir="ltr" href={`https://github.com/${current}`} target="_blank" rel="noreferrer">
            {current}
            <ExternalLinkIcon className="size-3.5" />
          </a>
        </p>
      ) : null}
      {canManage ? (
        <div className="flex flex-wrap items-end gap-2">
          <Button variant={it || list.length ? "outline" : "default"} onClick={install}>
            {it ? t("int.github.reinstall") : t("int.github.install")}
          </Button>
          {needsRepo && repos.data ? (
            list.length ? (
              <>
                <RepoSearch repos={list.map((r) => r.full_name)} value={repo} onChange={setRepo} />
                <Button variant="outline" disabled={!repo} onClick={link}>
                  {t("int.github.link")}
                </Button>
              </>
            ) : (
              <p className="text-sm text-grid-muted">{t("int.github.noRepos")}</p>
            )
          ) : null}
          {repos.error && it ? <p className="text-sm text-destructive">{errorText(repos.error, t("common.networkError"))}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

// A searchable list rather than a select: an account can have hundreds of repositories.
function RepoSearch({ repos, value, onChange }: { repos: string[]; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslations()
  const [q, setQ] = useState("")
  const needle = q.trim().toLowerCase()
  const shown = needle ? repos.filter((r) => r.toLowerCase().includes(needle)) : repos
  return (
    <div className="w-full max-w-md space-y-1" data-repo-search>
      <Input dir="ltr" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("int.github.searchRepo")} aria-label={t("int.github.searchRepo")} />
      <ul role="listbox" aria-label={t("int.github.repo")} className="max-h-60 overflow-y-auto rounded-md border border-line">
        {shown.length ? (
          shown.slice(0, 200).map((r) => (
            <li key={r} role="option" aria-selected={r === value}>
              <button
                type="button"
                dir="ltr"
                onClick={() => onChange(r)}
                className={`block w-full truncate px-3 py-1.5 text-start text-sm hover:bg-grid-soft ${r === value ? "bg-grid-soft font-medium" : ""}`}
              >
                {r}
              </button>
            </li>
          ))
        ) : (
          <li className="px-3 py-2 text-sm text-grid-muted">{t("int.github.noMatch")}</li>
        )}
      </ul>
    </div>
  )
}

function useSave(projectId: string, provider: "jira" | "linear", onChanged: () => void) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [busy, setBusy] = useState(false)
  return {
    busy,
    save: async (body: Record<string, string>) => {
      setBusy(true)
      try {
        const clean = Object.fromEntries(Object.entries(body).filter(([k, v]) => !(k === "api_token" || k === "api_key") || v.trim() !== ""))
        await w.put(ws.id, `/api/w/projects/${projectId}/integrations/${provider}`, clean)
        toast.success(t("int.saved"))
        onChanged()
        return true
      } catch (err) {
        toast.error(errorText(err, t("common.networkError")))
        return false
      } finally {
        setBusy(false)
      }
    },
  }
}

function JiraCard({ projectId, it, canManage, onChanged }: { projectId: string; it?: Integration; canManage: boolean; onChanged: () => void }) {
  const { t } = useTranslations()
  const [f, setF] = useState({ base_url: "", email: "", project_key: "", jql: "", api_token: "" })
  const [seen, setSeen] = useState<string | null>(null)
  if ((it?.updated_at ?? "") !== seen) {
    setSeen(it?.updated_at ?? "")
    setF({ base_url: it?.config.base_url ?? "", email: it?.config.email ?? "", project_key: it?.config.project_key ?? "", jql: it?.config.jql ?? "", api_token: "" })
  }
  const { busy, save } = useSave(projectId, "jira", onChanged)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <div className="space-y-3 px-6 py-4" data-integration="jira">
      <Header name="Jira" desc={t("int.jira.desc")} it={it} canManage={canManage} projectId={projectId} onChanged={onChanged} />
      {canManage ? (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save(f)
          }}
        >
          <Field>
            <FieldLabel htmlFor="jira-url">{t("int.jira.baseUrl")}</FieldLabel>
            <Input id="jira-url" dir="ltr" placeholder="https://your-site.atlassian.net" value={f.base_url} onChange={set("base_url")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="jira-email">{t("int.jira.email")}</FieldLabel>
            <Input id="jira-email" dir="ltr" type="email" value={f.email} onChange={set("email")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="jira-key">{t("int.jira.projectKey")}</FieldLabel>
            <Input id="jira-key" dir="ltr" placeholder="PROJ" value={f.project_key} onChange={set("project_key")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="jira-jql">{t("int.jira.jql")}</FieldLabel>
            <Input id="jira-jql" dir="ltr" value={f.jql} onChange={set("jql")} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="jira-token">{t("int.jira.token")}</FieldLabel>
            <Input id="jira-token" dir="ltr" type="password" autoComplete="off" placeholder={it?.has_secret ? t("int.keepSecret") : ""} value={f.api_token} onChange={set("api_token")} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {it ? t("int.save") : t("int.connect")}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}

function LinearCard({ projectId, it, canManage, onChanged }: { projectId: string; it?: Integration; canManage: boolean; onChanged: () => void }) {
  const { t } = useTranslations()
  const [team, setTeam] = useState("")
  const [key, setKey] = useState("")
  const [seen, setSeen] = useState<string | null>(null)
  if ((it?.updated_at ?? "") !== seen) {
    setSeen(it?.updated_at ?? "")
    setTeam(it?.config.team_id ?? "")
    setKey("")
  }
  const { busy, save } = useSave(projectId, "linear", onChanged)
  return (
    <div className="space-y-3 px-6 py-4" data-integration="linear">
      <Header name="Linear" desc={t("int.linear.desc")} it={it} canManage={canManage} projectId={projectId} onChanged={onChanged} />
      {canManage ? (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save({ team_id: team, api_key: key })
          }}
        >
          <Field>
            <FieldLabel htmlFor="linear-team">{t("int.linear.team")}</FieldLabel>
            <Input id="linear-team" dir="ltr" placeholder="ENG" value={team} onChange={(e) => setTeam(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="linear-key">{t("int.linear.key")}</FieldLabel>
            <Input id="linear-key" dir="ltr" type="password" autoComplete="off" placeholder={it?.has_secret ? t("int.keepSecret") : "lin_api_…"} value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {it ? t("int.save") : t("int.connect")}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
