"use client"

// Budget burn of every visible project with a budget: hours for everyone who can read reports,
// money for managers and up (`finance`). Levels come from the server.
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Suspense, useMemo } from "react"

import { Badge, DataTableFacetFilter, useDataTable, type DataTableColumn } from "@fadymondy/nasaq/web"

import { BudgetMeters, LevelBadge } from "@/components/reports/budget-meter"
import { PrintButton, PrintHeader } from "@/components/reports/filter-bar"
import { SavedViews } from "@/components/reports/saved-views"
import { DataView } from "@/components/data-view"
import { EmptyState, ErrorState } from "@/components/states"
import { ColorDot } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useBudgets, type Budget, type BudgetLevel } from "@/lib/reports"
import { useDocumentTitle } from "@/lib/title"

const ORDER: Record<BudgetLevel, number> = { over: 0, warning: 1, ok: 2, none: 3 }

export default function BudgetsPage() {
  return (
    <Suspense>
      <BudgetsView />
    </Suspense>
  )
}

function BudgetsView() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  useDocumentTitle(`${t("reports.tab.budgets")} · ${ws.summary.name}`)
  const res = useBudgets(ws.id, ws.can("reports:read"))
  const data = res.data
  const base = `/${locale}/w/${ws.slug}`
  const budgets = useMemo(() => data?.budgets ?? [], [data])
  const finance = !!data?.finance
  const columns = useMemo<DataTableColumn<Budget>[]>(
    () => [
      {
        id: "project",
        header: t("budget.project"),
        hideable: false,
        sortValue: (b) => b.project_name.toLowerCase(),
        searchValue: (b) => `${b.project_name} ${b.client_name ?? ""}`,
        filterValue: (b) => b.billing_mode,
        className: "max-w-0 align-top",
        cell: (b) => (
          <div data-budget={b.project_id} data-level={b.level}>
            <Link href={`${base}/projects/${b.project_id}`} className="flex min-w-0 items-center gap-2 font-medium hover:underline">
              <ColorDot color={b.project_color} />
              <span className="truncate" dir="auto">
                {b.project_name}
              </span>
            </Link>
            <span className="mt-1 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
              {b.client_name ? <span dir="auto">{b.client_name}</span> : null}
              <span>{t(`billing.${b.billing_mode}`)}</span>
              {b.archived ? <Badge variant="neutral">{t("budget.archived")}</Badge> : null}
            </span>
          </div>
        ),
      },
      {
        id: "status",
        header: t("budget.status"),
        headerClassName: "w-40",
        className: "align-top",
        // over budget first, then near the limit, on track, none
        sortValue: (b) => ORDER[b.level],
        filterValue: (b) => b.level,
        cell: (b) => <LevelBadge level={b.level} />,
      },
      {
        id: "spent",
        header: t("budget.spentLabel"),
        headerClassName: "w-[45%]",
        className: "align-top whitespace-normal",
        sortValue: (b) => b.hours_percent ?? b.money_percent ?? null,
        cell: (b) => <BudgetMeters b={b} finance={finance} />,
      },
    ],
    [t, base, finance],
  )
  const table = useDataTable({ data: budgets, columns, getRowId: (b) => b.project_id, defaultSort: { id: "status", direction: "asc" } })
  const modes = useMemo(() => [...new Set(budgets.map((b) => b.billing_mode))], [budgets])

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2" data-print-hide data-report-toolbar>
        <div className="min-w-0">
          <h2 className="text-h4">{t("budget.allTitle")}</h2>
          <p className="text-caption text-muted-foreground">
            {t("budget.allHint", { money: data?.finance ? t("budget.allHintMoney") : "" })} {t("budget.levels")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SavedViews kind="budget" filters={{}} base={`${base}/reports`} />
          <PrintButton />
        </div>
      </div>
      <PrintHeader title={`${t("reports.title")} · ${t("budget.allTitle")}`} meta={ws.current?.workspace.timezone ?? ""} />

      {res.error ? (
        <ErrorState error={res.error} />
      ) : (
        <DataView
          table={table}
          label={t("budget.allTitle")}
          rowLabel={(b) => b.project_name}
          loading={!data}
          empty={<EmptyState title={t("budget.empty")} body={t("budget.emptyBody")} />}
          className="print-table"
          data-budget-table
          data-finance={finance}
          onRowClick={(b) => router.push(`${base}/projects/${b.project_id}`)}
          search={t("reports.search")}
          filters={
            <>
              <DataTableFacetFilter
                table={table}
                column="status"
                title={t("budget.status")}
                options={(["over", "warning", "ok"] as const).map((l) => ({ value: l, label: t(`budget.level.${l}`) }))}
              />
              <DataTableFacetFilter table={table} column="project" title={t("project.billing")} options={modes.map((m) => ({ value: m, label: t(`billing.${m}`) }))} />
            </>
          }
        />
      )}
    </>
  )
}
