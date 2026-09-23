// The week as a timesheet: a row per project/issue, a column per day and a total; today's column
// lit; a footer of day totals. A cell is a button — it opens Log time on that day for that row.
import { PlusIcon } from "lucide-react";

import type { Timesheet } from "../../../shared/types";
import { LtrText, ProjectMark } from "@/components/kit";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { dayDate, hm } from "./format";

type Row = NonNullable<Timesheet["rows"]>[number];

const COLS = "minmax(200px, 1fr) repeat(7, minmax(58px, 72px)) minmax(68px, 84px)";

export const rowKey = (r: { project_id: string | null; task_id: string | null }) => `${r.project_id ?? ""}|${r.task_id ?? ""}`;

export function WeekGrid({
  days,
  rows,
  dayTotals,
  total,
  today,
  runningKey,
  onCell,
}: {
  days: string[];
  rows: Row[];
  dayTotals: number[];
  total: number;
  today: string;
  runningKey: string | null;
  onCell: (day: string, row: Row | null) => void;
}) {
  const { t, date } = useI18n();
  const ti = days.indexOf(today);
  const lit = (i: number) => i === ti && "bg-grid-soft/60";
  return (
    <div className="overflow-x-auto" data-time-grid>
      <div className="min-w-[720px]" role="table">
        {/* Header: the days */}
        <div className="grid h-9 items-stretch border-b border-line" style={{ gridTemplateColumns: COLS }} role="row">
          <div className="flex items-center ps-4 text-[11.5px] text-grid-muted" role="columnheader">
            {t("time.projectTask")}
          </div>
          {days.map((d, i) => (
            <div
              key={d}
              role="columnheader"
              data-day={d}
              data-today={i === ti || undefined}
              className={cn("flex items-center justify-end gap-1 border-s border-line pe-2.5 text-[11.5px]", lit(i), i === ti ? "text-grid-fg" : "text-grid-muted")}
            >
              <span>{date(dayDate(d), { weekday: "short", timeZone: "UTC", numberingSystem: "latn" })}</span>
              <span className={cn("tabular-nums", i === ti && "flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] bg-grid-action px-1 font-medium text-grid-on-action")}>
                {date(dayDate(d), { day: "numeric", timeZone: "UTC", numberingSystem: "latn" })}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-end border-s border-line pe-4 text-[11.5px] text-grid-muted" role="columnheader">
            {t("time.total")}
          </div>
        </div>

        {rows.map((r) => {
          const k = rowKey(r);
          const label = r.task_id ? r.task_title || r.task_key || "" : r.project_name || t("time.noProject");
          return (
            <div key={k} className="group/row grid h-9 items-stretch border-b border-line hover:bg-grid-soft/30" style={{ gridTemplateColumns: COLS }} role="row" data-grid-row={k}>
              <div className="flex min-w-0 items-center gap-2 ps-4 pe-2" role="rowheader" title={[r.project_name, r.task_key, r.task_title].filter(Boolean).join(" · ")}>
                {r.project_id ? <ProjectMark name={r.project_name ?? "?"} color={r.project_color} size={14} /> : <span className="size-3.5 shrink-0 rounded-[4px] border border-dashed border-line" />}
                {r.task_key ? <LtrText className="shrink-0 font-mono text-[11px] text-grid-muted">{r.task_key}</LtrText> : null}
                <span className={cn("truncate text-[12.5px]", r.project_id || r.task_id ? "text-grid-fg" : "text-grid-muted")}>{label}</span>
                {r.task_id && r.project_name ? <span className="hidden shrink truncate text-[11.5px] text-grid-muted xl:inline">{r.project_name}</span> : null}
                {k === runningKey ? <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-grid-action motion-reduce:animate-none" aria-hidden /> : null}
              </div>
              {days.map((d, i) => {
                const s = r.seconds?.[i] ?? 0;
                return (
                  <button
                    key={d}
                    type="button"
                    role="cell"
                    onClick={() => onCell(d, r)}
                    title={t("time.logOn", { day: date(dayDate(d), { weekday: "long", day: "numeric", month: "short", timeZone: "UTC", numberingSystem: "latn" }) })}
                    data-cell={d}
                    className={cn(
                      "group/cell flex items-center justify-end border-s border-line pe-2.5 font-mono text-[12.5px] tabular-nums outline-none hover:bg-grid-soft focus-visible:bg-grid-soft focus-visible:ring-1 focus-visible:ring-ring/60 focus-visible:ring-inset",
                      lit(i),
                      s ? "text-grid-fg" : "text-grid-muted/50",
                    )}
                  >
                    {s ? (
                      <LtrText>{hm(s)}</LtrText>
                    ) : (
                      <>
                        <PlusIcon className="size-3 opacity-0 group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100" />
                        <span className="group-hover/cell:hidden group-focus-visible/cell:hidden">–</span>
                      </>
                    )}
                  </button>
                );
              })}
              <div className="flex items-center justify-end border-s border-line pe-4 font-mono text-[12.5px] font-medium text-grid-fg tabular-nums" role="cell">
                <LtrText>{hm(r.total_s, "–")}</LtrText>
              </div>
            </div>
          );
        })}

        {/* An empty row to log against no project, so a blank week can still be filled in. */}
        <div className="grid h-9 items-stretch border-b border-line" style={{ gridTemplateColumns: COLS }} role="row" data-grid-add>
          <div className="flex items-center gap-2 ps-4 text-[12px] text-grid-muted" role="rowheader">
            <PlusIcon className="size-3.5" />
            {rows.length ? t("time.logOther") : t("time.logFirst")}
          </div>
          {days.map((d, i) => (
            <button
              key={d}
              type="button"
              role="cell"
              onClick={() => onCell(d, null)}
              data-cell={d}
              className={cn("group/cell flex items-center justify-end border-s border-line pe-2.5 text-grid-muted/40 outline-none hover:bg-grid-soft hover:text-grid-muted focus-visible:bg-grid-soft", lit(i))}
            >
              <PlusIcon className="size-3 opacity-0 group-hover/cell:opacity-100" />
            </button>
          ))}
          <div className="border-s border-line" />
        </div>

        {/* Footer: the day totals */}
        <div className="grid h-9 items-stretch bg-grid-card" style={{ gridTemplateColumns: COLS }} role="row" data-grid-totals>
          <div className="flex items-center ps-4 text-[11.5px] font-medium text-grid-muted" role="rowheader">
            {t("time.dayTotal")}
          </div>
          {days.map((d, i) => (
            <div
              key={d}
              role="cell"
              data-total={d}
              className={cn("flex items-center justify-end border-s border-line pe-2.5 font-mono text-[12.5px] font-medium tabular-nums", lit(i), dayTotals[i] ? "text-grid-fg" : "text-grid-muted/50")}
            >
              <LtrText>{hm(dayTotals[i] ?? 0, "–")}</LtrText>
            </div>
          ))}
          <div className="flex items-center justify-end border-s border-line pe-4 font-mono text-[13px] font-semibold text-grid-fg tabular-nums" role="cell" data-total-week>
            <LtrText>{hm(total, "0:00")}</LtrText>
          </div>
        </div>
      </div>
    </div>
  );
}
