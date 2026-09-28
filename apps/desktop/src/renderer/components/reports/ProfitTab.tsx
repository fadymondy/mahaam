// Profitability (reports:finance — managers and up): billable value − cost for the range, per project
// and per client, each with its own export. Columns match internal/work/export.go ProfitabilityTable.
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { Profitability, ProfitRow, ReportFilters } from "../../../main/api-reports";
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/kit";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { ExportButtons } from "./FilterBar";
import { NameCell, Note, NumberTable } from "./parts";
import { hmCell, moneyCell, percentCell, reportError } from "./util";

/** Profitability takes range, projects, clients and rounding only. */
export const profitFilters = (f: ReportFilters): ReportFilters => ({ from: f.from, to: f.to, projects: f.projects, clients: f.clients, rounding: f.rounding });

export function ProfitTab({ filters, enabled }: { filters: ReportFilters; enabled: boolean }) {
  const { t } = useI18n();
  const { ws } = useApp();
  const pf = profitFilters(filters);
  const q = useQuery({ queryKey: ["w", ws, "time", "profitability", pf], queryFn: () => api.profitability(pf), enabled: !!ws && enabled, placeholderData: keepPreviousData });
  const p = q.data;
  if (q.error) return <ErrorState error={new Error(reportError(q.error, t))} onRetry={() => void q.refetch()} />;
  if (!p) return <RowsSkeleton rows={6} />;
  return (
    <div className={cn("transition-opacity", q.isPlaceholderData && "opacity-60")} data-profit-body>
      <p className="border-b border-line px-4 py-2.5 text-[12.5px] text-grid-muted">{t("reports.profit.hint")}</p>
      {p.other_currency_entries ? <Note>{t("reports.otherCurrency", { n: p.other_currency_entries })}</Note> : null}
      <ProfitTable p={p} by="project" rows={p.projects ?? []} filters={pf} />
      <ProfitTable p={p} by="client" rows={p.clients ?? []} filters={pf} />
    </div>
  );
}

function ProfitTable({ p, by, rows, filters }: { p: Profitability; by: "project" | "client"; rows: ProfitRow[]; filters: ReportFilters }) {
  const { t } = useI18n();
  const cur = p.currency;
  const heads = [
    t("reports.col.rounded"),
    t("reports.col.billable"),
    `${t("reports.col.billableValue")} (${cur})`,
    `${t("reports.col.cost")} (${cur})`,
    `${t("reports.col.profit")} (${cur})`,
    t("reports.col.margin"),
  ];
  const cells = (x: ProfitRow) => [
    hmCell(x.rounded_s),
    hmCell(x.billable_rounded_s),
    moneyCell(x.billable_minor),
    moneyCell(x.cost_minor),
    moneyCell(x.profit_minor),
    percentCell(x.margin_percent),
  ];
  return (
    <section className="border-b border-line" data-profit-table={by}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2">
        <h2 className="text-[13.5px] font-medium">{t(by === "project" ? "reports.profit.byProject" : "reports.profit.byClient")}</h2>
        <ExportButtons request={{ kind: "profitability", by, filters }} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t("reports.profit.empty")} />
      ) : (
        <NumberTable
          nameHead={t(`reports.group.${by}`)}
          heads={heads}
          rows={rows.map((x) => ({ key: x.key, name: <NameCell name={x.name} color={x.color} none={x.key ? undefined : t(`reports.none.${by}`)} />, cells: cells(x) }))}
          total={cells(p.total)}
          negative={[4, 5]}
        />
      )}
    </section>
  );
}
