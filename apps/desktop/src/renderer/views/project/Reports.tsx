// The project's Reports tab: tracked time on this project for a range, grouped by member, task,
// label or week (GET /api/w/report/time?projects=…), the budget burn, and downloads — the time
// table as CSV/XLSX (/api/w/report/export) and the project report as PDF/Markdown.
import { useQuery } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { ReportGroup } from "../../../main/api-project";
import { BudgetMeters, errorText, LevelBadge, saveFile, TabPage, useFormat, useProjectDetail } from "@/components/project/common";
import { ColorDot, EmptyState, ErrorState, LtrText, RowsSkeleton } from "@/components/kit";
import { Segmented, SectionTitle } from "@/components/issues/controls";
import { SmallButton } from "@/components/settings/parts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";

type Range = "month" | "lastMonth" | "d30" | "year" | "all";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rangeDates(r: Range, start: string | null | undefined): { from: string; to: string } {
  const now = new Date();
  const today = iso(now);
  switch (r) {
    case "month":
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case "lastMonth":
      return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
    case "d30":
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)), to: today };
    case "year":
      return { from: iso(new Date(now.getFullYear(), 0, 1)), to: today };
    case "all": {
      // The server caps a report at ~400 days; keep "all time" inside that.
      const floor = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 399));
      const from = start && start > floor ? start : floor;
      return { from, to: today };
    }
  }
}

export function ProjectReports({ projectId }: { projectId: string }) {
  const { t, number, locale, date } = useI18n();
  const { ws, workspace } = useApp();
  const role = workspace?.role;
  const detail = useProjectDetail(projectId);
  const [range, setRange] = useState<Range>("month");
  const [group, setGroup] = useState<ReportGroup>("member");
  const [busy, setBusy] = useState(false);
  const f = useFormat();
  const isClient = role === "client";

  const start = detail.data?.starts_on ?? detail.data?.created_at?.slice(0, 10);
  const { from, to } = rangeDates(range, start);
  const report = useQuery({
    queryKey: ["w", ws, "project-tab", projectId, "time", { from, to, group }],
    queryFn: () => api.projectTimeReport(projectId, { from, to, group_by: group }),
    enabled: !!ws && !isClient,
  });
  const budget = useQuery({ queryKey: ["w", ws, "project-tab", projectId, "budget"], queryFn: () => api.projectBudget(projectId), enabled: !!ws && !isClient });

  if (isClient) return <EmptyState title={t("project.reports.noAccess")} />;

  const lang = locale === "ar" ? "ar" : "en";
  const download = async (fn: () => Promise<Awaited<ReturnType<typeof api.exportProjectTime>>>) => {
    setBusy(true);
    try {
      const file = await fn();
      saveFile(file);
      toast.success(t("project.exported", { name: file.name }));
    } catch (err) {
      toast.error(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const r = report.data;
  const finance = !!r?.finance;
  const rows = r?.rows ?? [];
  const max = Math.max(1, ...rows.map((x) => x.rounded_s));
  const rowName = (name: string, key: string) =>
    !key ? t("project.reports.none") : group === "day" || group === "week" ? date(`${key}T12:00:00`, { day: "numeric", month: "short", year: "numeric" }) : name;

  return (
    <TabPage data-project-reports>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<Range>
          label={t("project.reports.range")}
          value={range}
          onChange={setRange}
          options={(["month", "lastMonth", "d30", "year", "all"] as const).map((v) => ({ value: v, label: t(`project.reports.range.${v}`) }))}
        />
        <span className="text-[12.5px] text-grid-muted">
          <LtrText>{date(`${from}T12:00:00`, { day: "numeric", month: "short", year: "numeric" })}</LtrText> –{" "}
          <LtrText>{date(`${to}T12:00:00`, { day: "numeric", month: "short", year: "numeric" })}</LtrText>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SmallButton className="ms-auto" disabled={busy} data-project-export />}>
            <DownloadIcon />
            {t("project.reports.export")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem onClick={() => void download(() => api.exportProjectTime(projectId, { from, to, group_by: group, format: "csv", lang }))}>
              {t("project.reports.csv")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void download(() => api.exportProjectTime(projectId, { from, to, group_by: group, format: "xlsx", lang }))}>
              {t("project.reports.xlsx")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void download(() => api.exportProjectReport(projectId, { format: "pdf", lang, from, to }))}>{t("project.reportPdf")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void download(() => api.exportProjectReport(projectId, { format: "md", lang, from, to }))}>{t("project.reportMd")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {report.error ? (
        <ErrorState error={new Error(errorText(report.error, t))} onRetry={() => void report.refetch()} />
      ) : !r ? (
        <RowsSkeleton rows={5} />
      ) : (
        <>
          <section className="settings-card grid grid-cols-2 divide-x divide-line md:grid-cols-4 rtl:divide-x-reverse" data-report-totals>
            <Stat label={t("project.reports.tracked")} value={f.hours(r.total.rounded_s)} />
            <Stat label={t("project.reports.billable")} value={f.hours(r.total.billable_rounded_s)} />
            <Stat label={t("project.reports.entries")} value={number(r.total.entries)} />
            {finance ? <Stat label={t("project.reports.value")} value={f.money(r.total.billable_minor ?? 0, r.currency)} /> : <Stat label={t("project.reports.rounding")} value={r.rounding_minutes ? t("project.fmt.m", { m: number(r.rounding_minutes) }) : "—"} />}
          </section>
          {r.own_time_only ? <p className="-mt-3 px-1 text-[12.5px] text-grid-muted">{t("project.reports.ownOnly")}</p> : null}

          <section className="flex flex-col gap-2">
            <SectionTitle
              actions={
                <Segmented<ReportGroup>
                  label={t("project.reports.groupBy")}
                  value={group}
                  onChange={setGroup}
                  options={(["member", "task", "label", "week"] as const).map((v) => ({ value: v, label: t(`project.reports.by.${v}`) }))}
                />
              }
            >
              {t("project.reports.breakdown")}
            </SectionTitle>
            {!rows.length ? (
              <div className="settings-card">
                <EmptyState title={t("project.reports.empty")} body={t("project.reports.emptyBody")} />
              </div>
            ) : (
              <div className="settings-card overflow-hidden">
                <table className="w-full text-[13.5px]" data-report-table>
                  <thead>
                    <tr className="border-b border-line text-[12px] text-grid-muted">
                      <th className="px-4 py-2 text-start font-medium">{t(`project.reports.by.${group}`)}</th>
                      <th className="w-[30%] px-2 py-2" />
                      <th className="px-3 py-2 text-end font-medium">{t("project.reports.tracked")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("project.reports.billable")}</th>
                      <th className="px-3 py-2 text-end font-medium">{t("project.reports.entries")}</th>
                      {finance ? <th className="px-4 py-2 text-end font-medium">{t("project.reports.value")}</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((x) => (
                      <tr key={x.key || "none"} data-report-row={x.key}>
                        <td className="max-w-0 px-4 py-2">
                          <span className="flex items-center gap-2">
                            {x.color ? <ColorDot color={x.color} /> : null}
                            <span className="truncate text-grid-fg" dir={group === "member" ? "ltr" : undefined}>
                              {rowName(x.name, x.key)}
                            </span>
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <div className="h-1.5 overflow-hidden rounded-full bg-grid-soft">
                            <div className="h-full rounded-full bg-grid-action" style={{ width: `${(x.rounded_s / max) * 100}%` }} />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-end text-grid-body tabular-nums">
                          <LtrText>{f.hours(x.rounded_s)}</LtrText>
                        </td>
                        <td className="px-3 py-2 text-end text-grid-muted tabular-nums">
                          <LtrText>{f.hours(x.billable_rounded_s)}</LtrText>
                        </td>
                        <td className="px-3 py-2 text-end text-grid-muted tabular-nums">{number(x.entries)}</td>
                        {finance ? (
                          <td className="px-4 py-2 text-end text-grid-body tabular-nums">
                            <LtrText>{f.money(x.billable_minor ?? 0, r.currency)}</LtrText>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {r.other_currency_entries ? <p className="px-1 text-[12.5px] text-grid-muted">{t("project.reports.otherCurrency", { n: number(r.other_currency_entries) })}</p> : null}
          </section>
        </>
      )}

      {budget.data && budget.data.level !== "none" ? (
        <section className="flex flex-col gap-2">
          <SectionTitle actions={<LevelBadge level={budget.data.level} />}>{t("project.budget.title")}</SectionTitle>
          <div className="settings-card px-4 py-3">
            <BudgetMeters b={budget.data} />
          </div>
        </section>
      ) : null}
    </TabPage>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[12.5px] text-grid-muted">{label}</p>
      <p className="mt-0.5 text-[20px] font-semibold text-grid-fg tabular-nums">
        <LtrText>{value}</LtrText>
      </p>
    </div>
  );
}
