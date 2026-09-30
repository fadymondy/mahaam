"use client"

// Budget burn of every visible project with a budget: hours for everyone who can read reports,
// money for managers and up (`finance`). Levels come from the server.
import Link from "next/link"
import { Suspense } from "react"

import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@fadymondy/nasaq/web"


import { BudgetMeters, LevelBadge } from "@/components/reports/budget-meter"
import { PrintButton, PrintHeader } from "@/components/reports/filter-bar"
import { SavedViews } from "@/components/reports/saved-views"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { ColorDot } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useBudgets, type BudgetLevel } from "@/lib/reports"
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
  useDocumentTitle(`${t("reports.tab.budgets")} · ${ws.summary.name}`)
  const res = useBudgets(ws.id, ws.can("reports:read"))
  const data = res.data
  const base = `/${locale}/w/${ws.slug}`
  const budgets = [...(data?.budgets ?? [])].sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.project_name.localeCompare(b.project_name))

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-6 py-3" data-print-hide data-report-toolbar>
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{t("budget.allTitle")}</h2>
          <p className="text-meta text-grid-muted">
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
      ) : !data ? (
        <LoadingRows rows={4} />
      ) : budgets.length === 0 ? (
        <EmptyState title={t("budget.empty")} body={t("budget.emptyBody")} />
      ) : (
        <div className="print-table" data-budget-table data-finance={data.finance}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-6">{t("budget.project")}</TableHead>
                <TableHead className="w-40">{t("budget.status")}</TableHead>
                <TableHead className="w-[45%] pe-6">{t("budget.spentLabel")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {budgets.map((b) => (
                <TableRow key={b.project_id} data-budget={b.project_id} data-level={b.level}>
                  <TableCell className="max-w-0 ps-6 align-top">
                    <Link href={`${base}/projects/${b.project_id}`} className="flex min-w-0 items-center gap-2 font-medium hover:underline">
                      <ColorDot color={b.project_color} />
                      <span className="truncate" dir="auto">
                        {b.project_name}
                      </span>
                    </Link>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-meta text-grid-muted">
                      {b.client_name ? <span dir="auto">{b.client_name}</span> : null}
                      <span>{t(`billing.${b.billing_mode}`)}</span>
                      {b.archived ? <Badge variant="neutral">{t("budget.archived")}</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell className="align-top">
                    <LevelBadge level={b.level} />
                  </TableCell>
                  <TableCell className="pe-6 align-top whitespace-normal">
                    <BudgetMeters b={b} finance={data.finance} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
