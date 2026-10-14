// Pieces the project Overview, Settings and Reports tabs share: the project query, formatters,
// the budget meters, a confirm dialog, form controls and a file download helper.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";

import type { Budget, DownloadedFile } from "../../../main/api-project";
import type { ProjectDetail } from "../../../shared/types";
import { LtrText } from "@/components/kit";
import { Badge } from "@/components/settings/parts";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/app";
import { ApiError, api } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { cn } from "@/lib/utils";

/** The project with members, teams, statuses and can_manage (shared with the project header). */
export function useProjectDetail(projectId: string) {
  const { ws } = useApp();
  return useQuery<ProjectDetail>({ queryKey: qk.project(ws, projectId), queryFn: () => api.project(projectId), enabled: !!ws, staleTime: 60_000 });
}

/** Everything that reads the project: its detail, lists, board, activity and our own keys. */
export function useInvalidateProject(projectId: string) {
  const { ws } = useApp();
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.project(ws, projectId) });
    void qc.invalidateQueries({ queryKey: ["w", ws, "projects"] });
    void qc.invalidateQueries({ queryKey: qk.board(ws, projectId) });
    void qc.invalidateQueries({ queryKey: qk.projectActivity(ws, projectId) });
    void qc.invalidateQueries({ queryKey: ["w", ws, "project-tab", projectId] });
  };
}

export const isManager = (role?: string | null) => role === "owner" || role === "admin" || role === "manager";

export function errorText(err: unknown, t: (k: string) => string): string {
  if (err instanceof ApiError && err.status === 403) return t("project.forbidden");
  return err instanceof Error && err.message ? err.message : t("common.error");
}

/** Runs a mutation, toasts the outcome. Resolves true on success. */
export function useRun() {
  const { t } = useI18n();
  return async (fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    try {
      await fn();
      if (ok) toast.success(ok);
      return true;
    } catch (err) {
      toast.error(errorText(err, t));
      return false;
    }
  };
}

/** Formatters: durations and money in the locale's digits. */
export function useFormat() {
  const { t, number, locale } = useI18n();
  const hours = (seconds: number) => {
    const m = Math.round(seconds / 60);
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h ? (r ? t("project.fmt.hm", { h: number(h), m: number(r) }) : t("project.fmt.h", { h: number(h) })) : t("project.fmt.m", { m: number(r) });
  };
  const money = (minor: number | null | undefined, currency?: string | null) => {
    if (minor === null || minor === undefined) return "—";
    try {
      return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-GB", { style: "currency", currency: currency || "USD" }).format(minor / 100);
    } catch {
      return `${number(minor / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? ""}`;
    }
  };
  return { hours, money };
}

export function LevelBadge({ level }: { level: string }) {
  const { t } = useI18n();
  return <Badge tone={level === "over" ? "warn" : level === "warning" ? "warn" : "ok"}>{t(`project.budget.level.${level}`)}</Badge>;
}

function Meter({ label, pct, spent, of }: { label: string; pct: number | null | undefined; spent: string; of: string }) {
  const { number } = useI18n();
  const v = pct ?? 0;
  const tone = v >= 100 ? "bg-grid-danger" : v >= 80 ? "bg-grid-warn" : "bg-grid-action";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-grid-muted">{label}</span>
        <span className="text-grid-body tabular-nums">
          <LtrText>{spent}</LtrText> / <LtrText>{of}</LtrText>
          <span className="ms-2 text-grid-muted">
            <LtrText>{number(Math.round(v))}%</LtrText>
          </span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-grid-soft">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, Math.max(0, v))}%` }} />
      </div>
    </div>
  );
}

/** Hours (and money, for finance roles) spent against the budget. */
export function BudgetMeters({ b }: { b: Budget }) {
  const { t } = useI18n();
  const f = useFormat();
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-budget-meters>
      {b.budget_minutes ? <Meter label={t("project.budget.hours")} pct={b.hours_percent} spent={f.hours(b.spent_s)} of={f.hours(b.budget_minutes * 60)} /> : null}
      {b.budget_minor ? (
        <Meter label={t("project.budget.money")} pct={b.money_percent} spent={f.money(b.spent_minor ?? 0, b.currency)} of={f.money(b.budget_minor, b.currency)} />
      ) : null}
    </div>
  );
}

export function Confirm({
  open,
  onOpenChange,
  title,
  body,
  label,
  onConfirm,
  children,
  destructive = true,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  body?: string;
  label: string;
  onConfirm: () => void;
  children?: ReactNode;
  destructive?: boolean;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {body ? <AlertDialogDescription>{body}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel variant="ghost">{t("common.cancel")}</AlertDialogCancel>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {label}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export const inputCls =
  "h-7 w-full rounded-md border border-line bg-background px-2 text-[14px] text-grid-fg outline-none placeholder:text-grid-muted focus:border-grid-action/60 focus:ring-2 focus:ring-grid-action/20 disabled:opacity-60";

export function NativeSelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(inputCls, "w-auto pe-6", className)} {...props} />;
}

/** Saves a downloaded file with an <a download>. */
export function saveFile(f: DownloadedFile) {
  const bin = atob(f.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: f.type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

/** A tab's scrolling page: centred column, desktop density. */
export function TabPage({ children, className, ...rest }: { children: ReactNode; className?: string; [d: `data-${string}`]: string | boolean | undefined }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" {...rest}>
      <div className={cn("mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-5", className)}>{children}</div>
    </div>
  );
}
