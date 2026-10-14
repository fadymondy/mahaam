"use client"

import { useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { DataTableFacetFilter, useDataTable, type DataTableColumn } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { DataView } from "@/components/data-view"
import { Page, PageHeader } from "@/components/page"
import { EmptyState, ErrorState } from "@/components/states"
import { RangePicker } from "@/components/kpi/kpi-dashboard"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { compact, defaultRange, useTeamKPI, type TeamKPIRow } from "@/lib/kpi"
import { hm } from "@/lib/time"
import { useDocumentTitle } from "@/lib/title"

// The team KPI table (manager+): one headline row per employee; each row opens their dashboard.
export default function TeamKpiPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const allowed = ws.can("kpi:all")
  const [range, setRange] = useState(defaultRange)
  const team = useTeamKPI(ws.id, range.from, range.to, allowed)
  const base = `/${locale}/w/${ws.slug}/members`
  useDocumentTitle(`${t("kpi.teamTitle")} · ${ws.summary.name}`)

  const rows = useMemo(() => team.data?.rows ?? [], [team.data])
  const finance = !!team.data?.finance
  const currency = team.data?.currency ?? ""
  const roles = useMemo(() => [...new Set(rows.map((r) => r.member.role))], [rows])
  const columns = useMemo<DataTableColumn<TeamKPIRow>[]>(() => {
    const n = (id: string, header: string, v: (r: TeamKPIRow) => number | null, cell?: (r: TeamKPIRow) => ReactNode): DataTableColumn<TeamKPIRow> => ({
      id,
      header,
      align: "end",
      className: "tabular-nums",
      sortValue: v,
      cell: cell ?? ((r) => v(r) ?? "—"),
    })
    return [
      {
        id: "member",
        header: t("kpi.member"),
        hideable: false,
        sortValue: (r) => r.member.email,
        searchValue: (r) => r.member.email,
        filterValue: (r) => r.member.role,
        cell: (r) => (
          <>
            <Link href={`${base}/${r.member.user_id}`} className="font-medium text-foreground hover:underline">
              <Ltr>{r.member.email}</Ltr>
            </Link>
            <span className="ms-2 text-caption text-muted-foreground">{t(`role.${r.member.role}`)}</span>
          </>
        ),
      },
      n("hours", t("kpi.hours"), (r) => r.tracked_s, (r) => <Ltr mono>{hm(r.tracked_s, "0:00")}</Ltr>),
      n("billable", t("kpi.billable"), (r) => r.billable_s, (r) => <Ltr mono>{hm(r.billable_s, "0:00")}</Ltr>),
      n("days", t("kpi.daysTracked"), (r) => r.days_tracked),
      n("done", t("kpi.tasksDone"), (r) => r.tasks_completed),
      n("overdue", t("kpi.overdue"), (r) => r.tasks_overdue),
      n("issues", t("kpi.issuesFinished"), (r) => r.issues_finished),
      n("tokens", t("kpi.aiTokens"), (r) => r.ai_tokens, (r) => <Ltr>{compact(r.ai_tokens)}</Ltr>),
      ...(finance ? [n("cost", t("kpi.aiCost"), (r) => r.ai_cost_minor ?? 0, (r) => <Ltr>{money(r.ai_cost_minor ?? 0, currency, locale)}</Ltr>)] : []),
      n("commits", t("kpi.commits"), (r) => (r.github_login ? r.commits : null), (r) => (
        <span title={r.github_login ? `@${r.github_login}` : t("kpi.notConnected")}>{r.github_login ? r.commits : "—"}</span>
      )),
      n("prs", t("kpi.prsMerged"), (r) => (r.github_login ? r.prs_merged : null)),
      n("mcp", t("kpi.mcp"), (r) => r.mcp_actions),
      n("rating", t("kpi.rating"), (r) => r.avg_rating ?? null, (r) => (r.avg_rating != null ? r.avg_rating.toFixed(1) : "—")),
    ]
  }, [t, locale, base, finance, currency])
  const table = useDataTable({ data: rows, columns, getRowId: (r) => r.member.user_id, defaultSort: { id: "hours", direction: "desc" } })
  return (
    <Page wide>
      <PageHeader
        breadcrumbs={[{ label: t("nav.members"), href: base }, { label: t("kpi.teamTitle") }]}
        title={t("kpi.teamTitle")}
        description={t("kpi.teamHint")}
        actions={allowed ? <RangePicker from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} /> : null}
      />
      {!allowed ? (
        <p className="text-sm text-muted-foreground">{t("kpi.teamNoPermission")}</p>
      ) : team.error ? (
        <ErrorState error={team.error} />
      ) : (
        <DataView
          table={table}
          label={t("kpi.teamTitle")}
          rowLabel={(r) => r.member.email}
          loading={!team.data}
          empty={<EmptyState title={t("kpi.teamEmpty")} />}
          onRowClick={(r) => router.push(`${base}/${r.member.user_id}`)}
          search={t("members.search")}
          filters={<DataTableFacetFilter table={table} column="member" title={t("members.role")} options={roles.map((r) => ({ value: r, label: t(`role.${r}`) }))} />}
        />
      )}
    </Page>
  )
}
