// Workspace reports, as the web console has them: the time report builder (range, grouping,
// rounding, filters, totals, export), budget burn, profitability (managers+) and saved views.
// Filters live in this view for the session; a saved view brings them back.
import { BarChart3Icon } from "lucide-react";
import { useEffect, useState } from "react";

import type { ReportFilters, SavedReport } from "../../main/api-reports";
import { EmptyState, ViewHeader } from "@/components/kit";
import { Segmented } from "@/components/issues/controls";
import { BudgetsTab } from "@/components/reports/BudgetsTab";
import { ExportButtons, FilterBar } from "@/components/reports/FilterBar";
import { ProfitTab, profitFilters } from "@/components/reports/ProfitTab";
import { SavedTab, SaveViewButton, useSavedReports } from "@/components/reports/SavedTab";
import { TimeTab } from "@/components/reports/TimeTab";
import { presetRange, useReportRole, useWorkspaceTime } from "@/components/reports/util";
import { useApp } from "@/lib/app";
import { useI18n } from "@/lib/i18n";

type Tab = "time" | "budgets" | "profitability" | "saved";

export function ReportsView() {
  const { t } = useI18n();
  const { ws } = useApp();
  const role = useReportRole();
  const time = useWorkspaceTime();
  const saved = useSavedReports(role.read);
  const [tab, setTab] = useState<Tab>("time");
  const [filters, setFilters] = useState<ReportFilters | null>(null);

  const defaults = (): ReportFilters => ({ group_by: "project", ...presetRange("this_month", time.today, time.weekStart) });

  // This month in the workspace's timezone, once its settings are known; again on a workspace switch.
  useEffect(() => {
    if (time.ready) setFilters(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time.ready, ws]);

  if (!role.read) {
    return (
      <>
        <ViewHeader title={t("reports.title")} />
        <EmptyState icon={<BarChart3Icon />} title={t("reports.title")} body={t("reports.noPermission")} />
      </>
    );
  }

  const set = (next: Partial<ReportFilters>) => setFilters((f) => ({ ...(f ?? defaults()), ...next }));
  const reset = () => setFilters(defaults());
  const savedCount = (saved.data ?? []).filter((v) => v.kind !== "profitability" || role.finance).length;

  function openSaved(v: SavedReport) {
    setFilters({ ...defaults(), ...v.filters, group_by: v.filters.group_by ?? "project" });
    setTab(v.kind === "budget" ? "budgets" : v.kind === "profitability" && role.finance ? "profitability" : "time");
  }

  const tabs = [
    { value: "time" as const, label: t("reports.tab.time") },
    { value: "budgets" as const, label: t("reports.tab.budgets") },
    ...(role.finance ? [{ value: "profitability" as const, label: t("reports.tab.profitability") }] : []),
    { value: "saved" as const, label: t("reports.saved.title"), count: savedCount || undefined },
  ];

  const f = filters;
  const actions =
    tab === "time" && f ? (
      <>
        <SaveViewButton kind="time" filters={cleanFor(f)} />
        <ExportButtons request={{ kind: "time", filters: f }} />
      </>
    ) : tab === "profitability" && f ? (
      <SaveViewButton kind="profitability" filters={cleanFor(profitFilters(f))} />
    ) : tab === "budgets" ? (
      <SaveViewButton kind="budget" filters={{}} />
    ) : null;

  return (
    <>
      <ViewHeader title={t("reports.title")} actions={actions}>
        <Segmented label={t("reports.title")} value={tab} onChange={setTab} options={tabs} className="ms-2" />
      </ViewHeader>
      {(tab === "time" || tab === "profitability") && f ? (
        tab === "time" ? (
          <FilterBar filters={f} onChange={set} onReset={reset} />
        ) : (
          <FilterBar filters={f} onChange={set} onReset={reset} group={false} labels={false} billable={false} members={false} />
        )
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto" data-reports-body data-tab={tab}>
        {tab === "time" ? (
          <TimeTab filters={f ?? defaults()} enabled={!!f} />
        ) : tab === "budgets" ? (
          <BudgetsTab enabled />
        ) : tab === "profitability" ? (
          <ProfitTab filters={f ?? defaults()} enabled={!!f && role.finance} />
        ) : (
          <SavedTab onOpen={openSaved} />
        )}
      </div>
    </>
  );
}

/** What a saved view stores: empty parts dropped. */
function cleanFor(f: ReportFilters): ReportFilters {
  const out: ReportFilters = {};
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  if (f.group_by) out.group_by = f.group_by;
  for (const k of ["users", "projects", "clients", "labels"] as const) if (f[k]?.length) out[k] = f[k];
  if (f.billable) out.billable = f.billable;
  if (f.rounding != null && f.rounding >= 0) out.rounding = f.rounding;
  return out;
}
