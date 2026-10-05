"use client"

import Link from "next/link"
import { useState } from "react"
import { ExternalLinkIcon, GlobeIcon, RefreshCwIcon, RocketIcon, ServerIcon } from "lucide-react"

import { Badge, Button, toast } from "@fadymondy/nasaq/web"

import { EmptyState } from "@/components/states"
import { RowsSkeleton } from "@/components/work/project/project-skeletons"
import { useProjectCtx } from "@/components/work/project-context"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { intlTag } from "@/lib/i18n-locale"
import { hostingStatus, hostingVariant, useHosting, useIntegrations, type HosbahDeployment } from "@/lib/integrations"
import { useDocumentTitle } from "@/lib/title"
import { errorText, w } from "@/lib/work"

/*
The project's Hosting tab: the Hosbah app linked in Settings → Integrations, read live from Hosbah
through the app token — its status, domains and server, and the recent deployments — with Deploy
for managers (integrations:manage). Members+ read; the endpoints check visibility and roles.
*/
export default function ProjectHostingPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const { project: p } = useProjectCtx()
  useDocumentTitle(`${t("projectTab.hosting")} · ${p.name}`)
  const list = useIntegrations(ws.id, p.id)
  const hb = (list.data?.integrations ?? []).find((i) => i.provider === "hosbah")
  const linked = !!hb?.config.app_id && hb.status !== "disabled"
  const hosting = useHosting(ws.id, linked ? p.id : null)
  const [busy, setBusy] = useState(false)

  if ((!list.data && !list.error) || (linked && !hosting.data && !hosting.error)) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6" data-shimmer>
        <RowsSkeleton rows={4} />
      </div>
    )
  }
  if (!linked) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-6" data-hosting-unlinked>
        <EmptyState
          title={t("hosting.notLinked")}
          body={t("hosting.notLinkedBody")}
          action={
            p.can_manage ? (
              <Button variant="secondary" nativeButton={false} render={<Link href={`/${locale}/w/${ws.slug}/projects/${p.id}/settings?s=integrations`} />}>
                <ServerIcon />
                {t("hosting.goSettings")}
              </Button>
            ) : null
          }
        />
      </div>
    )
  }

  const deploy = async () => {
    setBusy(true)
    try {
      await w.post(ws.id, `/api/w/projects/${p.id}/hosting/deploy`)
      toast.success(t("hosting.deployQueued"))
      void hosting.mutate()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  // Hosbah unreachable or the token revoked: show what Mahaam stored and the error.
  const app = hosting.data?.app
  const name = app ? (app.title?.trim() ? app.title : app.name) : hb!.config.app_title || hb!.config.app_name || "—"
  const status = app?.status ?? hb!.config.app_status
  const stored = hb!.config.domains as unknown
  const domains = app?.domains ?? (Array.isArray(stored) ? (stored as string[]) : [])
  const server = app?.server_name ?? hb!.config.server_name
  const panel = app?.panel_url ?? hb!.config.panel_url
  const deployments = hosting.data?.deployments ?? []

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6" data-hosting>
      {hosting.error ? (
        <p className="rounded-lg border border-nq-danger/40 bg-nq-danger/5 px-4 py-2 text-sm text-nq-danger-text" dir="auto">
          {errorText(hosting.error, t("common.networkError"))}
        </p>
      ) : null}
      <section className="flex flex-col gap-4 rounded-card border border-border bg-card p-4 sm:flex-row sm:items-start sm:p-5">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-h3 min-w-0 truncate" dir="auto">
              {name}
            </h2>
            <Badge variant={hostingVariant(status)}>{hostingStatus(t, status)}</Badge>
          </div>
          {server ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <ServerIcon className="size-4 shrink-0" />
              <span className="truncate" dir="ltr">
                {server}
              </span>
            </p>
          ) : null}
          {domains.length ? (
            <ul className="flex flex-wrap gap-2" aria-label={t("hosting.domains")}>
              {domains.map((d) => (
                <li key={d}>
                  <a
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-caption text-foreground underline-offset-4 hover:underline"
                    href={`https://${d}`}
                    target="_blank"
                    rel="noreferrer"
                    dir="ltr"
                  >
                    <GlobeIcon className="size-3.5" />
                    {d}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void hosting.mutate()} aria-label={t("hosting.refresh")} title={t("hosting.refresh")}>
            <RefreshCwIcon className={hosting.isValidating ? "animate-spin" : undefined} />
          </Button>
          {panel ? (
            <Button variant="secondary" size="sm" nativeButton={false} render={<a href={panel} target="_blank" rel="noreferrer" />}>
              <ExternalLinkIcon />
              {t("hosting.openInHosbah")}
            </Button>
          ) : null}
          {ws.can("integrations:manage") ? (
            <Button variant="primary" size="sm" disabled={busy || status === "deploying"} onClick={() => void deploy()}>
              <RocketIcon />
              {t("hosting.deploy")}
            </Button>
          ) : null}
        </div>
      </section>
      <section className="rounded-card border border-border bg-card" aria-labelledby="hosting-deployments">
        <h3 id="hosting-deployments" className="border-b border-border px-4 py-3 font-medium sm:px-5">
          {t("hosting.deployments")}
        </h3>
        {deployments.length ? (
          <ul className="divide-y divide-border">
            {deployments.map((d) => (
              <DeploymentRow key={d.id} d={d} />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-5">{t("hosting.noDeployments")}</p>
        )}
      </section>
    </div>
  )
}

function DeploymentRow({ d }: { d: HosbahDeployment }) {
  const { t, locale } = useTranslations()
  const when = new Intl.DateTimeFormat(intlTag(locale), { dateStyle: "medium", timeStyle: "short" }).format(new Date(d.queued_at))
  const status = d.status === "succeeded" ? "running" : d.status
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:px-5" data-deployment={d.number}>
      <span className="w-12 shrink-0 font-medium tabular-nums" dir="ltr">
        #{d.number}
      </span>
      <Badge variant={hostingVariant(status)}>{hostingStatus(t, d.status)}</Badge>
      <span className="min-w-0 flex-1 truncate text-muted-foreground" dir="auto" title={d.message}>
        {d.message || d.kind}
      </span>
      {d.ref || d.commit ? (
        <span className="shrink-0 font-mono text-caption text-muted-foreground" dir="ltr">
          {[d.ref, d.commit?.slice(0, 7)].filter(Boolean).join(" · ")}
        </span>
      ) : null}
      <time className="shrink-0 text-caption text-muted-foreground" dateTime={d.queued_at}>
        {when}
      </time>
    </li>
  )
}
