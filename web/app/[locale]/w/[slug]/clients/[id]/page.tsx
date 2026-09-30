"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"

import { Badge } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { NotFoundState } from "@/components/not-found-state"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { ColorDot } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { ApiError } from "@/lib/api"
import { money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { filterQuery, hmCell, useTimeReport } from "@/lib/reports"
import { useDocumentTitle } from "@/lib/title"
import { StatusBadge } from "../../invoices/page"
import { useClient, useClientInvoices, useClientUnbilled, useProjects } from "@/lib/work"

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t, locale, isRtl } = useTranslations()
  const ws = useWorkspace()
  const canRead = ws.can("clients:read")
  const client = useClient(ws.id, id, canRead)
  const projects = useProjects(ws.id)
  const canReport = ws.can("reports:read")
  const report = useTimeReport(ws.id, filterQuery({ clients: [id], group_by: "project" }), canReport)
  const canInvoice = ws.can("invoices:read")
  const unbilled = useClientUnbilled(ws.id, id, canInvoice)
  const clientInvoices = useClientInvoices(ws.id, id, canInvoice)
  const back = `/${locale}/w/${ws.slug}/clients`

  const c = client.data
  useDocumentTitle(`${c?.name ?? t("nav.clients")} · ${ws.summary.name}`)

  if (ws.current && !canRead) return <p className="px-6 py-6 text-sm text-muted-foreground">{t("clients.noPermission")}</p>

  if (client.error) {
    return client.error instanceof ApiError && client.error.status === 404 ? (
      <NotFoundState title={t("clientDetail.notFound")} body={t("clientDetail.notFoundBody")} backHref={back} backLabel={t("nav.clients")} />
    ) : (
      <ErrorState error={client.error} />
    )
  }
  if (!c) return <LoadingRows rows={5} />

  const clientProjects = (projects.data?.projects ?? []).filter((p) => p.client_id === c.id)
  const r = report.data
  const cur = c.currency || ws.current?.workspace.currency || "USD"

  const facts: [string, React.ReactNode][] = [
    [t("clients.email"), c.email ? <Ltr key="e">{c.email}</Ltr> : "—"],
    [t("clients.phone"), c.phone ? <Ltr key="p">{c.phone}</Ltr> : "—"],
    [t("clients.country"), c.country ? <Ltr key="c" mono>{c.country}</Ltr> : "—"],
    [t("clients.rate"), c.default_rate_minor != null ? <Ltr key="r">{money(c.default_rate_minor, c.currency, locale)}/{t("clients.hourShort")}</Ltr> : <Ltr key="r" mono>{c.currency}</Ltr>],
  ]

  return (
    <>
      <div className="px-6 pt-5">
        <Link href={back} className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground">
          <ChevronLeftIcon className={isRtl ? "size-3.5 rotate-180" : "size-3.5"} />
          {t("nav.clients")}
        </Link>
      </div>
      <SectionHeader
        micro={ws.summary.name}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.name}
            {c.archived_at ? <Badge variant="neutral">{t("project.archivedBadge")}</Badge> : null}
          </span>
        }
        description={t("clients.hint")}
      />

      <div className="grid gap-px border-y border-border bg-border lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* main */}
        <div className="min-w-0 bg-background">
          <dl className="grid grid-cols-2 gap-px border-b border-border bg-border text-sm sm:grid-cols-2">
            {facts.map(([label, value]) => (
              <div key={label} className="bg-background px-6 py-3">
                <dt className="text-eyebrow uppercase mb-1">{label}</dt>
                <dd className="text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
          {c.notes ? (
            <div className="border-b border-border px-6 py-4">
              <p className="text-eyebrow uppercase mb-1">{t("clients.notes")}</p>
              <p className="text-sm whitespace-pre-wrap text-nq-fg-body">{c.notes}</p>
            </div>
          ) : null}

          <h2 className="px-6 pt-6 pb-3 text-base font-medium">{t("clientDetail.projects")}</h2>
          {projects.error ? (
            <ErrorState error={projects.error} />
          ) : projects.isLoading ? (
            <LoadingRows rows={2} />
          ) : clientProjects.length === 0 ? (
            <EmptyState title={t("clientDetail.noProjects")} />
          ) : (
            <ul className="divide-y divide-line border-y border-border">
              {clientProjects.map((p) => (
                <li key={p.id}>
                  <Link href={`/${locale}/w/${ws.slug}/projects/${p.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-muted">
                    <ColorDot color={p.color} className="size-3" />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">{p.name}</span>
                    <Badge variant="outline">{t(`projectStatus.${p.status}`)}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* side rail */}
        <aside className="min-w-0 bg-background">
          <h2 className="px-6 pt-5 pb-3 text-base font-medium">{t("clientDetail.time")}</h2>
          {!canReport ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">{t("clientDetail.timeNoPermission")}</p>
          ) : report.error ? (
            <ErrorState error={report.error} />
          ) : !r ? (
            <LoadingRows rows={2} />
          ) : (
            <dl className="grid grid-cols-1 gap-px border-y border-border bg-border text-sm">
              <Stat label={t("clientDetail.tracked")}><Ltr mono>{hmCell(r.total.seconds)}</Ltr></Stat>
              <Stat label={t("clientDetail.billable")}><Ltr mono>{hmCell(r.total.billable_rounded_s)}</Ltr></Stat>
            </dl>
          )}
          {canInvoice ? (
            <>
              <div className="flex items-center justify-between gap-2 border-t border-border px-6 pt-5 pb-3">
                <h2 className="text-base font-medium">{t("clientDetail.invoices")}</h2>
                <Link href={`/${locale}/w/${ws.slug}/invoices`} className="text-caption text-nq-brand hover:underline">
                  {t("clientDetail.newInvoice")}
                </Link>
              </div>
              <dl className="grid grid-cols-1 gap-px border-y border-border bg-border text-sm">
                <Stat label={t("clientDetail.unbilledValue")}>
                  <Ltr>{money(unbilled.data?.amount_minor ?? 0, unbilled.data?.currency ?? cur, locale)}</Ltr>
                </Stat>
              </dl>
              {(clientInvoices.data?.invoices ?? []).length === 0 ? (
                <p className="px-6 py-4 text-caption text-muted-foreground">{t("clientDetail.noInvoices")}</p>
              ) : (
                <ul className="divide-y divide-line border-b border-border">
                  {(clientInvoices.data?.invoices ?? []).map((iv) => (
                    <li key={iv.id}>
                      <Link href={`/${locale}/w/${ws.slug}/invoices/${iv.number}`} className="flex items-center justify-between gap-2 px-6 py-3 hover:bg-muted">
                        <span className="flex items-center gap-2">
                          <Ltr mono>{iv.number}</Ltr>
                          <StatusBadge status={iv.status} />
                        </span>
                        <span className="tabular-nums text-nq-fg-body">
                          <Ltr>{money(iv.total_minor, iv.currency, locale)}</Ltr>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </aside>
      </div>
    </>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-background px-6 py-4">
      <dt className="text-eyebrow uppercase mb-1">{label}</dt>
      <dd className="text-xl font-medium tabular-nums">{children}</dd>
    </div>
  )
}
