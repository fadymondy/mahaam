"use client"

// Time report: filters (URL-backed), the per-day chart and a breakdown, and the grouped table. The
// table's columns, order and formatting are the export's (internal/work/export.go), so the CSV/XLSX
// match the screen cell for cell, total row included.
import { Suspense, type ReactNode } from "react"
import { InfoIcon } from "lucide-react"

import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { BreakdownChart, SeriesChart } from "@/components/reports/report-charts"
import { ExportButtons, FilterBar, PrintButton, PrintHeader, ResetButton, useReportFilters } from "@/components/reports/filter-bar"
import { SavedViews } from "@/components/reports/saved-views"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { ColorDot } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { filterQuery, hmCell, hoursCell, moneyCell, useTimeReport, type ReportRow, type TimeReport } from "@/lib/reports"
import { dayLabel } from "@/lib/time"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"

export default function TimeReportPage() {
  return (
    <Suspense>
      <TimeReportView />
    </Suspense>
  )
}

function Stat({ label, children, data }: { label: string; children: ReactNode; data?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-background px-6 py-4" data-stat={data}>
      <dt className="text-eyebrow uppercase">{label}</dt>
      <dd className="truncate text-xl font-medium tabular-nums">{children}</dd>
    </div>
  )
}

function Note({ children, data }: { children: ReactNode; data?: string }) {
  return (
    <p className="flex items-start gap-2 border-b border-border bg-muted px-6 py-2.5 text-caption text-nq-fg-body" data-note={data}>
      <InfoIcon className="mt-px size-3.5 shrink-0 text-muted-foreground" />
      <span>{children}</span>
    </p>
  )
}

function TimeReportView() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const state = useReportFilters()
  const { filters } = state
  useDocumentTitle(`${t("reports.title")} · ${ws.summary.name}`)
  const query = filterQuery(filters)
  const report = useTimeReport(ws.id, query, state.ready && ws.can("reports:read"))
  const r = report.data
  const base = `/${locale}/w/${ws.slug}/reports`
  const group = filters.group_by ?? "project"
  const cur = r?.currency ?? ws.current?.workspace.currency ?? ""

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-6 py-3" data-print-hide data-report-toolbar>
        <div className="flex flex-wrap items-center gap-2">
          <SavedViews kind="time" filters={filters} base={base} />
          <ResetButton onReset={state.reset} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons query={filterQuery(filters, { kind: "time", lang: locale })} />
          <PrintButton />
        </div>
      </div>
      <FilterBar state={state} />

      {r ? (
        <PrintHeader
          title={`${t("reports.title")} · ${t("reports.tab.time")}`}
          meta={t("reports.printMeta", { from: r.from, to: r.to, group: t(`reports.group.${r.group_by}`), tz: r.timezone })}
        />
      ) : null}

      {report.error ? (
        <ErrorState error={report.error} />
      ) : !r ? (
        <LoadingRows rows={5} />
      ) : (
        <div data-report-body data-group={r.group_by} data-from={r.from} data-to={r.to} className={cn(report.isValidating && "opacity-70 transition-opacity")}>
          <dl className={cn("grid grid-cols-2 gap-px border-b border-border bg-border", r.finance ? "md:grid-cols-5" : "md:grid-cols-3")} data-report-summary>
            <Stat label={t("reports.summary.tracked")} data="tracked">
              <Ltr mono>{hmCell(r.total.seconds)}</Ltr>
            </Stat>
            <Stat label={t("reports.summary.rounded")} data="rounded">
              <Ltr mono>{hmCell(r.total.rounded_s)}</Ltr>
            </Stat>
            <Stat label={t("reports.summary.billable")} data="billable">
              <Ltr mono>{hmCell(r.total.billable_rounded_s)}</Ltr>
            </Stat>
            {r.finance ? (
              <>
                <Stat label={t("reports.summary.billableValue")} data="value">
                  <Ltr mono>
                    {moneyCell(r.total.billable_minor ?? 0)} <span className="text-sm text-muted-foreground">{cur}</span>
                  </Ltr>
                </Stat>
                <Stat label={t("reports.summary.profit")} data="profit">
                  <Ltr mono>
                    {moneyCell(r.total.profit_minor ?? 0)} <span className="text-sm text-muted-foreground">{cur}</span>
                  </Ltr>
                </Stat>
              </>
            ) : null}
          </dl>

          {r.own_time_only ? <Note data="own">{t("reports.ownOnly")}</Note> : null}
          {r.group_by === "label" ? <Note data="label">{t("reports.labelNote")}</Note> : null}
          {r.other_currency_entries ? <Note data="currency">{t("reports.otherCurrency", { n: r.other_currency_entries })}</Note> : null}

          <Charts r={r} />

          {r.rows.length === 0 ? <EmptyState title={t("reports.empty")} body={t("reports.emptyBody")} /> : <ReportTable r={r} />}
        </div>
      )}
    </>
  )
}

function Charts({ r }: { r: TimeReport }) {
  const { t } = useTranslations()
  const grouped = r.group_by !== "day" && r.group_by !== "week"
  const top = grouped
    ? [...r.rows]
        .filter((x) => x.rounded_s > 0)
        .sort((a, b) => b.rounded_s - a.rounded_s)
        .slice(0, 12)
        .map((x) => ({ key: x.key, name: x.key ? x.name : t(`reports.none.${r.group_by}`), color: x.color, seconds: x.rounded_s }))
    : []
  return (
    <section className={cn("grid border-b border-border", top.length ? "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : "")} data-report-charts data-print-block>
      <div className="min-w-0 px-6 py-5">
        <h2 className="mb-3 text-sm font-medium">{t("reports.chart.title")}</h2>
        <SeriesChart series={r.series} />
      </div>
      {top.length ? (
        <div className="min-w-0 border-border px-6 py-5 max-lg:border-t lg:border-s">
          <h2 className="mb-3 text-sm font-medium">{t("reports.chart.breakdown", { group: t(`reports.group.${r.group_by}`) })}</h2>
          <BreakdownChart items={top} colored={r.group_by === "project" || r.group_by === "label"} />
        </div>
      ) : null}
    </section>
  )
}

/** Name cell: "none" is localised; days/weeks keep the ISO date the export uses, with a readable hint. */
function GroupName({ row, group }: { row: ReportRow; group: TimeReport["group_by"] }) {
  const { t, locale } = useTranslations()
  if (!row.key) return <span className="text-muted-foreground italic" data-none>{t(`reports.none.${group}`)}</span>
  if (group === "day" || group === "week") {
    return (
      <span className="flex items-baseline gap-2">
        <Ltr mono data-cell-name>
          {row.name}
        </Ltr>
        <span className="text-caption text-muted-foreground" data-print-hide>
          {group === "week" ? t("reports.weekOf", { date: dayLabel(row.key, locale) }) : dayLabel(row.key, locale)}
        </span>
      </span>
    )
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      {row.color ? <ColorDot color={row.color} /> : null}
      <span className="min-w-0 truncate" dir={group === "member" ? "ltr" : "auto"} data-cell-name>
        {row.name}
      </span>
    </span>
  )
}

function ReportTable({ r }: { r: TimeReport }) {
  const { t } = useTranslations()
  const cur = r.currency
  const num = "text-end tabular-nums"
  const cells = (x: ReportRow) => [
    hmCell(x.seconds),
    hmCell(x.rounded_s),
    hoursCell(x.rounded_s),
    hmCell(x.billable_rounded_s),
    String(x.entries),
    ...(r.finance ? [moneyCell(x.billable_minor ?? 0), moneyCell(x.cost_minor ?? 0), moneyCell(x.profit_minor ?? 0)] : []),
  ]
  const heads = [
    t("reports.col.tracked"),
    t("reports.col.rounded"),
    t("reports.col.hours"),
    t("reports.col.billable"),
    t("reports.col.entries"),
    ...(r.finance ? [`${t("reports.col.billableValue")} (${cur})`, `${t("reports.col.cost")} (${cur})`, `${t("reports.col.profit")} (${cur})`] : []),
  ]
  return (
    <div className="print-table" data-report-table data-finance={r.finance}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="ps-6">{t(`reports.group.${r.group_by}`)}</TableHead>
            {heads.map((h, i) => (
              <TableHead key={h} className={cn(num, i === heads.length - 1 && "pe-6")}>
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {r.rows.map((x) => (
            <TableRow key={x.key || "none"} data-row={x.key || "none"} className={cn(x.seconds === 0 && "text-muted-foreground")}>
              <TableCell className="max-w-72 ps-6">
                <GroupName row={x} group={r.group_by} />
              </TableCell>
              {cells(x).map((c, i, all) => (
                <TableCell key={i} className={cn(num, i === all.length - 1 && "pe-6", i >= 5 && Number(c) < 0 && "text-(--nq-danger-text)")}>
                  <Ltr mono data-cell>
                    {c}
                  </Ltr>
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow data-row="total">
            <TableCell className="ps-6 font-semibold">{t("reports.total")}</TableCell>
            {cells(r.total).map((c, i, all) => (
              <TableCell key={i} className={cn(num, "font-semibold", i === all.length - 1 && "pe-6")}>
                <Ltr mono data-cell>
                  {c}
                </Ltr>
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  )
}
