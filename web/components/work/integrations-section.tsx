"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"
import useSWR from "swr"

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Field, FieldLabel, Input, ProductMark } from "@fadymondy/nasaq/web"

import { ConfirmButton } from "@/components/confirm-button"
import { LogoTile, type TileBrand } from "@/components/work/brand-logos"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { hostingStatus, hostingVariant, useIntegrations, type HosbahApp, type HosbahMethods, type Integration, type Provider, type Repo, type SyncResult } from "@/lib/integrations"
import { errorText, w } from "@/lib/work"

/*
Project settings → Integrations: install the GitHub App and pick the repository, connect Jira or
Linear import (the credential is write-only: sealed server-side, never shown again), link a Hosbah
app (OAuth through CircleXO or Hosbah; Hosbah mints a token for the picked app), and see each
integration's status, last sync and last error with a Sync button. The four sit in one row as
compact cards with one button each; the setup opens in a dialog (GitHub with no installation to
reuse goes straight to the App install). Reading is member+; every
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
    if (search.get("integration") === "hosbah") toast.success(t("int.hosbah.linked"))
    const err = search.get("hosbah_error")
    if (err) toast.error(t("int.hosbah.failed", { error: err }))
  }, [search, t])

  const reload = () => void list.mutate()

  return (
    <section id="integrations" className="flex flex-col gap-4">
      <div>
        <h2 className="text-h3">{t("int.title")}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">{t("int.hint")}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <GitHubCard projectId={projectId} it={by("github")} canManage={canManage} onChanged={reload} />
        <JiraCard projectId={projectId} it={by("jira")} canManage={canManage} onChanged={reload} />
        <LinearCard projectId={projectId} it={by("linear")} canManage={canManage} onChanged={reload} />
        <HosbahCard projectId={projectId} it={by("hosbah")} canManage={canManage} onChanged={reload} />
      </div>
    </section>
  )
}

function statusVariant(s: Integration["status"]) {
  return s === "active" ? "success" : s === "error" ? "danger" : "neutral"
}

// One integration as a compact card: logo, name and status, what it does (or its last sync and
// error once connected), and a single Connect / Manage button. `connect` skips the dialog for a
// one-click connect; otherwise the provider's setup (children, handed a close callback) opens in a
// dialog that also carries Disconnect.
function IntegrationCard({
  brand,
  name,
  desc,
  it,
  canManage,
  projectId,
  onChanged,
  summary,
  connect,
  autoOpen,
  children,
}: {
  brand: TileBrand
  name: string
  desc: string
  it?: Integration
  canManage: boolean
  projectId: string
  onChanged: () => void
  summary?: React.ReactNode
  connect?: () => void
  /** Opens the dialog when it turns true (e.g. back from an OAuth round trip with something to pick). */
  autoOpen?: boolean
  children: (close: () => void) => React.ReactNode
}) {
  const { t, formatDate } = useTranslations()
  const ws = useWorkspace()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (autoOpen) setOpen(true)
  }, [autoOpen])
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
  const syncable = it && it.status !== "pending" && it.status !== "disabled"
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-card bg-muted/40 p-4" data-integration={brand}>
      <div className="flex items-center gap-3">
        <LogoTile brand={brand} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <h3 className="truncate font-medium">{name}</h3>
          {it ? <Badge variant={statusVariant(it.status)}>{t(`int.status.${it.status}`)}</Badge> : <Badge variant="outline">{t("int.notConnected")}</Badge>}
        </div>
      </div>
      {it ? (
        <div className="space-y-1 text-caption text-muted-foreground">
          {summary}
          <p>{it.last_synced_at ? t("int.lastSync", { when: formatDate(it.last_synced_at) }) : t("int.neverSynced")}</p>
          {it.last_error ? (
            <p className="line-clamp-2 text-destructive" dir="auto" title={it.last_error}>
              {it.last_error}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="line-clamp-3 text-caption text-muted-foreground">{desc}</p>
      )}
      {canManage ? (
        <div className="mt-auto flex items-center gap-2 pt-1">
          <Button variant={it ? "secondary" : "primary"} size="sm" className="flex-1" onClick={!it && connect ? connect : () => setOpen(true)}>
            {it ? t("int.manage") : t("int.connect")}
          </Button>
          {syncable ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={sync} aria-label={t("int.sync")} title={t("int.sync")}>
              <RefreshCwIcon className={busy ? "animate-spin" : undefined} />
            </Button>
          ) : null}
        </div>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-integration-dialog={brand}>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <LogoTile brand={brand} />
              <div className="min-w-0">
                <DialogTitle>{name}</DialogTitle>
                <DialogDescription>{desc}</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          {children(() => setOpen(false))}
          {it ? (
            <div className="flex justify-end border-t border-line pt-4">
              <ConfirmButton
                label={t("int.disconnect")}
                title={t("int.disconnectTitle", { provider: name })}
                description={t("int.disconnectBody")}
                confirmLabel={t("int.disconnect")}
                onConfirm={async () => {
                  try {
                    await w.del(ws.id, `/api/w/projects/${projectId}/integrations/${it.provider}`)
                    setOpen(false)
                  } catch (err) {
                    toast.error(errorText(err, t("common.networkError")))
                  }
                  onChanged()
                }}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
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
  const link = async (close: () => void) => {
    try {
      await w.put(ws.id, `/api/w/projects/${projectId}/integrations/github/repo`, { repo })
      toast.success(t("int.github.linked"))
      setRepo("")
      onChanged()
      close()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
  }
  const list = repos.data?.repos ?? []
  const current = it?.config.repo
  return (
    <IntegrationCard
      brand="github"
      name="GitHub"
      desc={t("int.github.desc")}
      it={it}
      canManage={canManage}
      projectId={projectId}
      onChanged={onChanged}
      // No installation to reuse: Connect goes straight to the GitHub App install.
      connect={list.length ? undefined : install}
      summary={
        current ? (
          <a
            className="inline-flex max-w-full items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
            dir="ltr"
            href={`https://github.com/${current}`}
            target="_blank"
            rel="noreferrer"
          >
            <span className="truncate">{current}</span>
            <ExternalLinkIcon className="size-3.5 shrink-0" />
          </a>
        ) : null
      }
    >
      {(close) => (
        <div className="space-y-3">
          {current ? (
            <p className="text-sm">
              {t("int.github.repo")}:{" "}
              <span className="font-medium" dir="ltr">
                {current}
              </span>
            </p>
          ) : null}
          {needsRepo && repos.data ? (
            list.length ? (
              <div className="space-y-2">
                <RepoSearch repos={list.map((r) => r.full_name)} value={repo} onChange={setRepo} />
                <Button variant="primary" disabled={!repo} onClick={() => void link(close)}>
                  {t("int.github.link")}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("int.github.noRepos")}</p>
            )
          ) : null}
          {repos.error && it ? <p className="text-sm text-destructive">{errorText(repos.error, t("common.networkError"))}</p> : null}
          <Button variant="secondary" onClick={install}>
            {it ? t("int.github.reinstall") : t("int.github.install")}
          </Button>
        </div>
      )}
    </IntegrationCard>
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
      <ul role="listbox" aria-label={t("int.github.repo")} className="max-h-60 overflow-y-auto rounded-md border border-border">
        {shown.length ? (
          shown.slice(0, 200).map((r) => (
            <li key={r} role="option" aria-selected={r === value}>
              <button
                type="button"
                dir="ltr"
                onClick={() => onChange(r)}
                className={`block w-full truncate px-3 py-1.5 text-start text-sm hover:bg-muted ${r === value ? "bg-muted font-medium" : ""}`}
              >
                {r}
              </button>
            </li>
          ))
        ) : (
          <li className="px-3 py-2 text-sm text-muted-foreground">{t("int.github.noMatch")}</li>
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
    <IntegrationCard brand="jira" name="Jira" desc={t("int.jira.desc")} it={it} canManage={canManage} projectId={projectId} onChanged={onChanged}>
      {(close) => (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save(f).then((ok) => ok && close())
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
          <Field>
            <FieldLabel htmlFor="jira-token">{t("int.jira.token")}</FieldLabel>
            <Input id="jira-token" dir="ltr" type="password" autoComplete="off" placeholder={it?.has_secret ? t("int.keepSecret") : ""} value={f.api_token} onChange={set("api_token")} />
          </Field>
          <div>
            <Button variant="primary" type="submit" disabled={busy}>
              {it ? t("int.save") : t("int.connect")}
            </Button>
          </div>
        </form>
      )}
    </IntegrationCard>
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
    <IntegrationCard brand="linear" name="Linear" desc={t("int.linear.desc")} it={it} canManage={canManage} projectId={projectId} onChanged={onChanged}>
      {(close) => (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save({ team_id: team, api_key: key }).then((ok) => ok && close())
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
          <div>
            <Button variant="primary" type="submit" disabled={busy}>
              {it ? t("int.save") : t("int.connect")}
            </Button>
          </div>
        </form>
      )}
    </IntegrationCard>
  )
}

// Hosbah connects over OAuth: through the manager's CircleXO account (back here with a sealed
// sign-in in the URL fragment, the apps they can see on Hosbah are listed and they pick one; Hosbah
// mints a token for that app alone) or through Hosbah's own consent screen, where the app is picked
// on Hosbah and the project comes back linked. Linking another app replaces the first.
function HosbahCard({ projectId, it, canManage, onChanged }: { projectId: string; it?: Integration; canManage: boolean; onChanged: () => void }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const methods = useSWR<HosbahMethods>(
    canManage ? [`/api/w/projects/${projectId}/integrations/hosbah/methods`, ws.id] : null,
    ([p, id]: [string, string]) => api(p, { workspaceId: id }),
    { shouldRetryOnError: false, revalidateOnFocus: false },
  )
  const [pending, setPending] = useState("")
  const [apps, setApps] = useState<HosbahApp[] | null>(null)
  const [pick, setPick] = useState("")
  const [q, setQ] = useState("")
  const [busy, setBusy] = useState(false)

  // Back from CircleXO: take the sealed sign-in out of the address bar and list the apps.
  useEffect(() => {
    const m = /(?:^#|&)hosbah=([^&]+)/.exec(window.location.hash)
    if (!m || !canManage) return
    const sealed = decodeURIComponent(m[1])
    window.history.replaceState(null, "", window.location.pathname + window.location.search)
    setPending(sealed)
    setBusy(true)
    w.post<{ apps: HosbahApp[] | null }>(ws.id, `/api/w/projects/${projectId}/integrations/hosbah/apps`, { pending: sealed })
      .then((r) => setApps(r.apps ?? []))
      .catch((err) => {
        setPending("")
        toast.error(errorText(err, t("common.networkError")))
      })
      .finally(() => setBusy(false))
  }, [canManage, projectId, ws.id, t])

  const start = async (via: "circlexo" | "hosbah") => {
    setBusy(true)
    try {
      const r = await w.post<{ url: string }>(ws.id, `/api/w/projects/${projectId}/integrations/hosbah/authorize`, { via, locale })
      window.location.assign(r.url)
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
      setBusy(false)
    }
  }
  const link = async (close: () => void) => {
    setBusy(true)
    try {
      await w.put(ws.id, `/api/w/projects/${projectId}/integrations/hosbah`, { pending, app: pick })
      toast.success(t("int.hosbah.linked"))
      setPending("")
      setApps(null)
      onChanged()
      close()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }
  const title = (a: HosbahApp) => (a.title?.trim() ? a.title : a.name)
  const needle = q.trim().toLowerCase()
  const shown = (apps ?? []).filter((a) => !needle || `${a.name} ${a.title ?? ""} ${a.server_name ?? ""}`.toLowerCase().includes(needle))
  const current = it?.config.app_title || it?.config.app_name
  const m = methods.data
  return (
    <IntegrationCard
      brand="hosbah"
      name="Hosbah"
      desc={t("int.hosbah.desc")}
      it={it}
      canManage={canManage}
      projectId={projectId}
      onChanged={onChanged}
      autoOpen={apps !== null}
      summary={
        current ? (
          <p className="flex min-w-0 items-center gap-1.5">
            {it?.config.panel_url ? (
              <a className="inline-flex min-w-0 items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline" href={it.config.panel_url} target="_blank" rel="noreferrer">
                <span className="truncate" dir="auto">
                  {current}
                </span>
                <ExternalLinkIcon className="size-3.5 shrink-0" />
              </a>
            ) : (
              <span className="truncate font-medium text-foreground" dir="auto">
                {current}
              </span>
            )}
            {it?.config.server_name ? (
              <span className="shrink-0 truncate" dir="ltr">
                · {it.config.server_name}
              </span>
            ) : null}
          </p>
        ) : null
      }
    >
      {(close) => (
        <div className="grid gap-3">
          {current ? (
            <p className="text-sm">
              {t("int.hosbah.app")}:{" "}
              <span className="font-medium" dir="auto">
                {current}
              </span>
            </p>
          ) : null}
          {apps ? (
            apps.length ? (
              <div className="space-y-2" data-hosbah-apps={apps.length}>
                <p className="text-sm text-muted-foreground">{t("int.hosbah.pickApp")}</p>
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("int.hosbah.searchApp")} aria-label={t("int.hosbah.searchApp")} />
                <ul role="listbox" aria-label={t("int.hosbah.app")} className="max-h-60 overflow-y-auto rounded-md border border-border">
                  {shown.length ? (
                    shown.slice(0, 200).map((a) => (
                      <li key={a.id} role="option" aria-selected={a.id === pick}>
                        <button
                          type="button"
                          onClick={() => setPick(a.id)}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm hover:bg-muted ${a.id === pick ? "bg-muted font-medium" : ""}`}
                        >
                          <span className="min-w-0 flex-1 truncate" dir="auto">
                            {title(a)}
                          </span>
                          {a.server_name ? (
                            <span className="shrink-0 text-caption text-muted-foreground" dir="ltr">
                              {a.server_name}
                            </span>
                          ) : null}
                          <Badge variant={hostingVariant(a.status)}>{hostingStatus(t, a.status)}</Badge>
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="px-3 py-2 text-sm text-muted-foreground">{t("int.hosbah.noMatch")}</li>
                  )}
                </ul>
                <Button variant="primary" disabled={busy || !pick} onClick={() => void link(close)}>
                  {it ? t("int.hosbah.relink") : t("int.hosbah.link")}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("int.hosbah.noApps")}</p>
            )
          ) : !m && !methods.error ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : m && (m.circlexo || m.hosbah) ? (
            <div className="grid gap-2" data-hosbah-connect>
              <p className="text-sm text-muted-foreground">{it ? t("int.hosbah.relinkHint") : t("int.hosbah.connectHint")}</p>
              {m.circlexo ? (
                <Button variant="primary" disabled={busy} onClick={() => void start("circlexo")}>
                  <ProductMark brand="circlexo" size={18} title="" />
                  {t("int.hosbah.viaCircleXO")}
                </Button>
              ) : null}
              {m.hosbah ? (
                <Button variant={m.circlexo ? "secondary" : "primary"} disabled={busy} onClick={() => void start("hosbah")}>
                  <ProductMark brand="hosbah" size={18} title="" />
                  {t("int.hosbah.viaHosbah")}
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-hosbah-unavailable>
              {t("int.hosbah.unavailable")}
            </p>
          )}
        </div>
      )}
    </IntegrationCard>
  )
}
