// Shared report pieces: the stat strip, notes, the per-day chart and the numeric table.
import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { ReportPoint } from "../../../main/api-reports";
import { ColorDot, LtrText } from "@/components/kit";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { hmCell } from "./util";

export function Stats({ items }: { items: { key: string; label: string; value: ReactNode }[] }) {
  return (
    <div className="grid shrink-0 border-b border-line" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }} data-report-summary>
      {items.map((s, i) => (
        <div key={s.key} className={cn("flex min-w-0 flex-col gap-1.5 px-4 py-3", i > 0 && "border-s border-line")} data-stat={s.key}>
          <span className="grid-micro truncate">{s.label}</span>
          <div className="truncate font-mono text-[20px] leading-none font-medium tabular-nums text-grid-fg">{s.value}</div>
        </div>
      ))}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 border-b border-line bg-grid-soft/60 px-4 py-2 text-[12.5px] text-grid-body">
      <InfoIcon className="mt-px size-3.5 shrink-0 text-grid-muted" />
      <span>{children}</span>
    </p>
  );
}

/** Stacked billable / non-billable bars per day. */
export function SeriesChart({ series }: { series: ReportPoint[] }) {
  const { t, date } = useI18n();
  if (!series.length) return null;
  const max = Math.max(3600, ...series.map((p) => p.rounded_s));
  return (
    <section className="border-b border-line px-4 py-3" data-report-chart>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-medium text-grid-muted">{t("reports.chart.title")}</h2>
        <div className="flex items-center gap-3 text-[12px] text-grid-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-grid-action" />
            {t("reports.chart.billable")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-grid-muted/40" />
            {t("reports.chart.nonBillable")}
          </span>
        </div>
      </div>
      <div className="flex h-28 items-end gap-px" role="img" aria-label={t("reports.chart.label")}>
        {series.map((p) => (
          <div
            key={p.day}
            className="flex h-full min-w-0 flex-1 flex-col justify-end"
            title={`${date(`${p.day}T00:00:00Z`, { day: "numeric", month: "short", timeZone: "UTC" })} · ${hmCell(p.rounded_s)}`}
          >
            <div className="rounded-t-[2px] bg-grid-muted/40" style={{ height: `${(p.non_billable_rounded_s / max) * 100}%` }} />
            <div className={cn("bg-grid-action", !p.non_billable_rounded_s && "rounded-t-[2px]")} style={{ height: `${(p.billable_rounded_s / max) * 100}%` }} />
          </div>
        ))}
      </div>
    </section>
  );
}


/** A report table: a name column, numeric columns, and a total row. Cells are the export's strings. */
export function NumberTable({
  nameHead,
  rows,
  total,
  heads,
  negative,
}: {
  nameHead: string;
  rows: { key: string; name: ReactNode; cells: string[]; muted?: boolean }[];
  total: string[];
  heads: string[];
  /** Which cell indexes turn red when negative. */
  negative?: number[];
}) {
  const { t } = useI18n();
  const neg = (i: number, c: string) => negative?.includes(i) && c.startsWith("-");
  return (
    <div className="overflow-x-auto" data-report-table>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="h-8 border-b border-line text-[12px] text-grid-muted">
            <th className="ps-4 text-start font-medium">{nameHead}</th>
            {heads.map((h, i) => (
              <th key={h} className={cn("px-3 text-end font-medium whitespace-nowrap", i === heads.length - 1 && "pe-4")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key || "none"} className={cn("h-9 border-b border-line/60 hover:bg-grid-soft/50", r.muted && "text-grid-muted")} data-row={r.key || "none"}>
              <td className="max-w-72 ps-4">{r.name}</td>
              {r.cells.map((c, i, all) => (
                <td key={i} className={cn("px-3 text-end tabular-nums", i === all.length - 1 && "pe-4", neg(i, c) && "text-grid-danger")}>
                  <LtrText className="font-mono">{c || "—"}</LtrText>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="h-9 bg-grid-soft/60 font-semibold" data-row="total">
            <td className="ps-4">{t("reports.total")}</td>
            {total.map((c, i, all) => (
              <td key={i} className={cn("px-3 text-end tabular-nums", i === all.length - 1 && "pe-4", neg(i, c) && "text-grid-danger")}>
                <LtrText className="font-mono">{c || "—"}</LtrText>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function NameCell({ name, color, none }: { name: string; color?: string | null; none?: string }) {
  if (none) return <span className="text-grid-muted italic">{none}</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      {color ? <ColorDot color={color} /> : null}
      <span className="min-w-0 truncate" dir="auto">
        {name}
      </span>
    </span>
  );
}
