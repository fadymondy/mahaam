// Budget burn of every visible project with a budget: hours for everyone who reads reports, money
// for managers and up (`finance`). Levels come from the server; worst first.
import { useQuery } from "@tanstack/react-query";

import type { Budget, BudgetLevel } from "../../../main/api-reports";
import { ColorDot, EmptyState, ErrorState, LtrText, RowsSkeleton } from "@/components/kit";
import { ProgressBar } from "@/components/issues/controls";
import { Badge } from "@/components/settings/parts";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { useRouter } from "@/lib/router";

import { hmCell, moneyCell, reportError } from "./util";

const ORDER: Record<BudgetLevel, number> = { over: 0, warning: 1, ok: 2, none: 3 };
const TONE = { over: "warn", warning: "warn", ok: "ok", none: "muted" } as const;
const BAR: Record<BudgetLevel, string | undefined> = { over: "var(--grid-danger)", warning: "var(--grid-warn)", ok: undefined, none: undefined };

export function useBudgets(enabled: boolean) {
  const { ws } = useApp();
  return useQuery({ queryKey: ["w", ws, "time", "budgets"], queryFn: () => api.budgets(), enabled: !!ws && enabled });
}

export function BudgetsTab({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const q = useBudgets(enabled);
  const data = q.data;
  if (q.error) return <ErrorState error={new Error(reportError(q.error, t))} onRetry={() => void q.refetch()} />;
  if (!data) return <RowsSkeleton rows={5} />;
  const list = [...(data.budgets ?? [])].sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.project_name.localeCompare(b.project_name));
  return (
    <div data-budget-table data-finance={data.finance}>
      <p className="border-b border-line px-4 py-2.5 text-[12.5px] text-grid-muted">
        {t("reports.budget.allHint", { money: data.finance ? t("reports.budget.allHintMoney") : "" })} {t("reports.budget.levels")}
      </p>
      {list.length === 0 ? (
        <EmptyState title={t("reports.budget.empty")} body={t("reports.budget.emptyBody")} />
      ) : (
        <ul>
          {list.map((b) => (
            <BudgetRow key={b.project_id} b={b} finance={data.finance} />
          ))}
        </ul>
      )}
    </div>
  );
}

function BudgetRow({ b, finance }: { b: Budget; finance: boolean }) {
  const { t, number } = useI18n();
  const { navigate } = useRouter();
  const pct = (p: number | null | undefined) => (p == null ? "" : `${number(Math.round(p))}%`);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-start gap-4 border-b border-line/60 px-4 py-3" data-budget={b.project_id} data-level={b.level}>
      <div className="min-w-0">
        <button type="button" onClick={() => navigate({ name: "project", id: b.project_id })} className="flex min-w-0 items-center gap-2 text-[13.5px] font-medium hover:underline">
          <ColorDot color={b.project_color} />
          <span className="truncate" dir="auto">
            {b.project_name}
          </span>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-grid-muted">
          <Badge tone={TONE[b.level]}>{t(`reports.budget.level.${b.level}`)}</Badge>
          {b.client_name ? <span dir="auto">{b.client_name}</span> : null}
          <span>{t(`reports.budget.billing.${b.billing_mode}`)}</span>
          {b.archived ? <Badge>{t("reports.budget.archived")}</Badge> : null}
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <Meter
          label={t("reports.budget.hours")}
          empty={t("reports.budget.noHours")}
          has={b.budget_minutes != null}
          value={b.spent_s}
          total={(b.budget_minutes ?? 0) * 60}
          text={t("reports.budget.spentOf", { spent: hmCell(b.spent_s), budget: hmCell((b.budget_minutes ?? 0) * 60) })}
          pct={pct(b.hours_percent)}
          color={BAR[b.level]}
        />
        {finance ? (
          <Meter
            label={t("reports.budget.money")}
            empty={t("reports.budget.noMoney")}
            has={b.budget_minor != null}
            value={b.spent_minor ?? 0}
            total={b.budget_minor ?? 0}
            text={t("reports.budget.spentOf", { spent: `${moneyCell(b.spent_minor ?? 0)} ${b.currency}`, budget: `${moneyCell(b.budget_minor ?? 0)} ${b.currency}` })}
            pct={pct(b.money_percent)}
            color={BAR[b.level]}
          />
        ) : null}
      </div>
    </li>
  );
}

function Meter({ label, empty, has, value, total, text, pct, color }: { label: string; empty: string; has: boolean; value: number; total: number; text: string; pct: string; color?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-grid-muted">{label}</span>
        {has ? (
          <span className="flex items-baseline gap-2">
            <LtrText className="font-mono tabular-nums">{text}</LtrText>
            <span className="font-medium tabular-nums">{pct}</span>
          </span>
        ) : (
          <span className="text-grid-muted">{empty}</span>
        )}
      </div>
      {has ? <ProgressBar value={value} total={total} color={color} className="h-1.5" /> : null}
    </div>
  );
}
