"use client"

// Profitability (reports:finance — managers and up): billable value − cost for the range, per project
// and per client, each with its own export. Columns match internal/work/export.go ProfitabilityTable.
import { Suspense } from "react"

import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { ExportButtons, FilterBar, PrintButton, PrintHeader, ResetButton, useReportFilters } from "@/components/reports/filter-bar"
import { SavedViews } from "@/components/reports/saved-views"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { ColorDot } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { filterQuery, hmCell, moneyCell, percentCell, useProfitability, type Filters, type ProfitRow, type Profitability } from "@/lib/reports"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"

export default function ProfitabilityPage() {
  return (
    <Suspense>
      <ProfitabilityView />
    </Suspense>
  )
}

// Profitability takes range, projects, clients and rounding only.
const profitFilters = (f: Filters): Filters => ({ from: f.from, to: f.to, projects: f.projects, clients: f.clients, rounding: f.rounding })

function ProfitabilityView() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("profit.title")} · ${ws.summary.name}`)
  const state = useReportFilters()
  const allowed = ws.can("reports:finance")
  const pf = profitFilters(state.filters)
  const query = filterQuery(pf)
  const res = useProfitability(ws.id, query, state.ready && allowed)
  const p = res.data

  if (ws.current && !allowed) return <p className="px-6 py-6 text-sm text-muted-foreground">{t("profit.noPermission")}</p>

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-6 py-3" data-print-hide data-report-toolbar>
        <div className="flex flex-wrap items-center gap-2">
          <SavedViews kind="profitability" filters={pf} base={`/${locale}/w/${ws.slug}/reports`} />
          <ResetButton onReset={state.reset} />
        </div>
        <PrintButton />
      </div>
      <FilterBar state={state} group={false} labels={false} billable={false} members={false} />
      {p ? <PrintHeader title={`${t("reports.title")} · ${t("profit.title")}`} meta={`${p.from} – ${p.to} · ${p.currency}`} /> : null}

      {res.error ? (
        <ErrorState error={res.error} />
      ) : !p ? (
        <LoadingRows rows={4} />
      ) : (
        <div data-profit-body className={cn(res.isValidating && "opacity-70 transition-opacity")}>
          <p className="border-b border-border px-6 py-3 text-sm text-nq-fg-body">{t("profit.hint")}</p>
          {p.other_currency_entries ? (
            <p className="border-b border-border bg-muted px-6 py-2.5 text-caption text-nq-fg-body">{t("reports.otherCurrency", { n: p.other_currency_entries })}</p>
          ) : null}
          <ProfitTable p={p} by="project" rows={p.projects} query={query} />
          <ProfitTable p={p} by="client" rows={p.clients} query={query} />
        </div>
      )}
    </>
  )
}

function ProfitTable({ p, by, rows, query }: { p: Profitability; by: "project" | "client"; rows: ProfitRow[]; query: string }) {
  const { t, locale } = useTranslations()
  const cur = p.currency
  const num = "text-end tabular-nums"
  const heads = [
    t("reports.col.rounded"),
    t("reports.col.billable"),
    `${t("reports.col.billableValue")} (${cur})`,
    `${t("reports.col.cost")} (${cur})`,
    `${t("reports.col.profit")} (${cur})`,
    t("reports.col.margin"),
  ]
  const cells = (x: ProfitRow) => [
    hmCell(x.rounded_s),
    hmCell(x.billable_rounded_s),
    moneyCell(x.billable_minor),
    moneyCell(x.cost_minor),
    moneyCell(x.profit_minor),
    percentCell(x.margin_percent),
  ]
  const neg = (i: number, x: ProfitRow) => (i === 4 && x.profit_minor < 0) || (i === 5 && (x.margin_percent ?? 0) < 0)
  return (
    <section className="print-block" data-profit-table={by}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-6 pb-3">
        <h2 className="text-base font-medium">{t(by === "project" ? "profit.byProject" : "profit.byClient")}</h2>
        <div data-print-hide>
          <ExportButtons query={`${query}${query ? "&" : ""}kind=profitability&by=${by}&lang=${locale}`} id={by} />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t("profit.empty")} />
      ) : (
        <div className="print-table border-t border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-6">{t(`reports.group.${by}`)}</TableHead>
                {heads.map((h, i) => (
                  <TableHead key={h} className={cn(num, i === heads.length - 1 && "pe-6")}>
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((x) => (
                <TableRow key={x.key || "none"} data-row={x.key || "none"}>
                  <TableCell className="max-w-72 ps-6">
                    {x.key ? (
                      <span className="flex min-w-0 items-center gap-2">
                        {x.color ? <ColorDot color={x.color} /> : null}
                        <span className="truncate" dir="auto" data-cell-name>
                          {x.name}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic" data-none>
                        {t(`reports.none.${by}`)}
                      </span>
                    )}
                  </TableCell>
                  {cells(x).map((c, i, all) => (
                    <TableCell key={i} className={cn(num, i === all.length - 1 && "pe-6", neg(i, x) && "text-(--nq-danger-text)")}>
                      <Ltr mono data-cell>
                        {c || "—"}
                      </Ltr>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow data-row="total">
                <TableCell className="ps-6 font-semibold">{t("reports.total")}</TableCell>
                {cells(p.total).map((c, i, all) => (
                  <TableCell key={i} className={cn(num, "font-semibold", i === all.length - 1 && "pe-6")}>
                    <Ltr mono data-cell>
                      {c || "—"}
                    </Ltr>
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </section>
  )
}
