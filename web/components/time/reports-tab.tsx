"use client"

// The period's own report: billable / non-billable per day and a per-project table, from
// /api/w/report/time (rounded as the workspace rounds), with a link to the full reports page.
import Link from "next/link"
import { ArrowUpRightIcon } from "lucide-react"

import { Button, Card, Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { SeriesChart } from "@/components/reports/report-charts"
import { ErrorState, LoadingRows } from "@/components/states"
import { ColorDot } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { filterQuery, hmCell, useTimeReport } from "@/lib/reports"
import type { Period } from "@/lib/time-range"

export function ReportsTab({ period, userId }: { period: Period; userId: string | null }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const q = filterQuery({ from: period.from, to: period.to, group_by: "project", users: userId ? [userId] : undefined })
  const report = useTimeReport(ws.id, q)
  const r = report.data
  return (
    <div className="flex flex-col gap-6" data-time-reports>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{r?.rounding_minutes ? t("time.rounded", { minutes: r.rounding_minutes }) : t("timeSettings.roundingNone")}</p>
        <Button variant="secondary" size="sm" nativeButton={false} render={<Link href={`/${locale}/w/${ws.slug}/reports?${filterQuery({ from: period.from, to: period.to, group_by: "project", users: userId ? [userId] : undefined })}`} />}>
          {t("time.rep.open")}
          <ArrowUpRightIcon className="rtl:-scale-x-100" />
        </Button>
      </div>
      {report.error ? (
        <ErrorState error={report.error} />
      ) : !r ? (
        <LoadingRows rows={4} />
      ) : (
        <>
          <Card className="p-4">
            <SeriesChart series={r.series} />
          </Card>
          <Card className="overflow-x-auto py-0">
            <Table className="min-w-[32rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="ps-4">{t("time.project")}</TableHead>
                  <TableHead className="text-end">{t("time.entries")}</TableHead>
                  <TableHead className="text-end">{t("time.billable")}</TableHead>
                  <TableHead className="pe-4 text-end">{t("time.total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.rows.map((row) => (
                  <TableRow key={row.key || "none"} data-report-row={row.key || "none"}>
                    <TableCell className="ps-4">
                      <span className="flex min-w-0 items-center gap-2">
                        <ColorDot color={row.color} />
                        <span className="truncate">{row.name || t("time.noProject")}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      <Ltr>{row.entries}</Ltr>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      <Ltr mono>{hmCell(row.billable_rounded_s)}</Ltr>
                    </TableCell>
                    <TableCell className="pe-4 text-end font-medium tabular-nums">
                      <Ltr mono>{hmCell(row.rounded_s)}</Ltr>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="ps-4 font-medium">{t("time.total")}</TableCell>
                  <TableCell className="text-end font-medium tabular-nums">
                    <Ltr>{r.total.entries}</Ltr>
                  </TableCell>
                  <TableCell className="text-end font-medium tabular-nums">
                    <Ltr mono>{hmCell(r.total.billable_rounded_s)}</Ltr>
                  </TableCell>
                  <TableCell className="pe-4 text-end font-semibold tabular-nums">
                    <Ltr mono>{hmCell(r.total.rounded_s)}</Ltr>
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </Card>
        </>
      )}
    </div>
  )
}
