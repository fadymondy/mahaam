// Time report: summary, notes, the per-day chart and the grouped table (the export's columns).
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { ReportFilters, ReportRow, TimeReport } from "../../../main/api-reports";
import { EmptyState, ErrorState, LtrText, RowsSkeleton } from "@/components/kit";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { NameCell, Note, NumberTable, SeriesChart, Stats } from "./parts";
import { hmCell, hoursCell, moneyCell, reportError } from "./util";

export function useTimeReport(filters: ReportFilters, enabled: boolean) {
  const { ws } = useApp();
  return useQuery({
    queryKey: ["w", ws, "time", "report", filters],
    queryFn: () => api.timeReport(filters),
    enabled: !!ws && enabled,
    placeholderData: keepPreviousData,
  });
}

export function TimeTab({ filters, enabled }: { filters: ReportFilters; enabled: boolean }) {
  const { t } = useI18n();
  const q = useTimeReport(filters, enabled);
  const r = q.data;
  if (q.error) return <ErrorState error={new Error(reportError(q.error, t))} onRetry={() => void q.refetch()} />;
  if (!r) return <RowsSkeleton rows={8} />;
  const cur = r.currency;
  const rows = r.rows ?? [];
  const money = (minor: number | null | undefined) => (
    <>
      {moneyCell(minor ?? 0)} <span className="text-[13px] text-grid-muted">{cur}</span>
    </>
  );
  return (
    <div className={cn("transition-opacity", q.isPlaceholderData && "opacity-60")} data-report-body data-group={r.group_by}>
      <Stats
        items={[
          { key: "tracked", label: t("reports.summary.tracked"), value: <LtrText>{hmCell(r.total.seconds)}</LtrText> },
          { key: "rounded", label: t("reports.summary.rounded"), value: <LtrText>{hmCell(r.total.rounded_s)}</LtrText> },
          { key: "billable", label: t("reports.summary.billable"), value: <LtrText>{hmCell(r.total.billable_rounded_s)}</LtrText> },
          ...(r.finance
            ? [
                { key: "value", label: t("reports.summary.billableValue"), value: <LtrText>{money(r.total.billable_minor)}</LtrText> },
                { key: "profit", label: t("reports.summary.profit"), value: <LtrText>{money(r.total.profit_minor)}</LtrText> },
              ]
            : []),
        ]}
      />
      {r.own_time_only ? <Note>{t("reports.ownOnly")}</Note> : null}
      {r.group_by === "label" ? <Note>{t("reports.labelNote")}</Note> : null}
      {r.other_currency_entries ? <Note>{t("reports.otherCurrency", { n: r.other_currency_entries })}</Note> : null}
      <SeriesChart series={r.series ?? []} />
      {rows.length === 0 ? <EmptyState title={t("reports.empty")} body={t("reports.emptyBody")} /> : <Table r={r} rows={rows} />}
    </div>
  );
}

function Table({ r, rows }: { r: TimeReport; rows: ReportRow[] }) {
  const { t, date } = useI18n();
  const cur = r.currency;
  const cells = (x: ReportRow) => [
    hmCell(x.seconds),
    hmCell(x.rounded_s),
    hoursCell(x.rounded_s),
    hmCell(x.billable_rounded_s),
    String(x.entries),
    ...(r.finance ? [moneyCell(x.billable_minor ?? 0), moneyCell(x.cost_minor ?? 0), moneyCell(x.profit_minor ?? 0)] : []),
  ];
  const heads = [
    t("reports.col.tracked"),
    t("reports.col.rounded"),
    t("reports.col.hours"),
    t("reports.col.billable"),
    t("reports.col.entries"),
    ...(r.finance ? [`${t("reports.col.billableValue")} (${cur})`, `${t("reports.col.cost")} (${cur})`, `${t("reports.col.profit")} (${cur})`] : []),
  ];
  const dayish = r.group_by === "day" || r.group_by === "week";
  const name = (x: ReportRow) => {
    if (!x.key) return <NameCell name="" none={t(`reports.none.${r.group_by}`)} />;
    if (dayish) {
      const d = date(`${x.key}T00:00:00Z`, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
      return (
        <span className="flex items-baseline gap-2">
          <LtrText className="font-mono">{x.name}</LtrText>
          <span className="text-[12px] text-grid-muted">{r.group_by === "week" ? t("reports.weekOf", { date: d }) : d}</span>
        </span>
      );
    }
    return <NameCell name={x.name} color={x.color} />;
  };
  return (
    <NumberTable
      nameHead={t(`reports.group.${r.group_by}`)}
      heads={heads}
      rows={rows.map((x) => ({ key: x.key, name: name(x), cells: cells(x), muted: x.seconds === 0 }))}
      total={cells(r.total)}
      negative={r.finance ? [7] : []}
    />
  );
}
