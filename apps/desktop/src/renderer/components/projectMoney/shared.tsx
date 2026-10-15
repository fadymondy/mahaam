// Pieces the project GitHub, vault and billing tabs share: the plan / permission gates, a quiet
// load state, a confirm dialog and form field styling.
import { LockIcon, SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState, ErrorState, RowsSkeleton } from "@/components/kit";
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
import { ApiError } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";

export const inputCls =
  "h-8 w-full rounded-md border border-line bg-background px-2 text-[13.5px] text-grid-fg outline-none placeholder:text-grid-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 [color-scheme:light] dark:[color-scheme:dark]";
export const areaCls = inputCls.replace("h-8", "min-h-16 py-1.5");

const STAFF = ["owner", "admin", "manager"];
export const isManager = (role?: string | null) => !!role && STAFF.includes(role);
export const isMember = (role?: string | null) => isManager(role) || role === "member";

/** 402 plan_feature: the workspace's plan does not include this. */
export const isPlanError = (e: unknown) => e instanceof ApiError && e.status === 402;
export const isForbidden = (e: unknown) => e instanceof ApiError && (e.status === 403 || e.status === 404);

export function errText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** A load/error/plan gate in front of a query's data. */
export function Gate<T>({ q, rows = 4, render }: { q: { data?: T; error: unknown; refetch: () => unknown }; rows?: number; render: (d: T) => ReactNode }) {
  if (q.error) {
    if (isPlanError(q.error)) return <PlanState />;
    if (isForbidden(q.error)) return <NoAccess />;
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  }
  if (q.data === undefined) return <RowsSkeleton rows={rows} />;
  return <>{render(q.data)}</>;
}

export function PlanState() {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={<SparklesIcon />}
      title={t("projectMoney.plan.title")}
      body={t("projectMoney.plan.body")}
    />
  );
}

export function NoAccess() {
  const { t } = useI18n();
  return <EmptyState icon={<LockIcon />} title={t("projectMoney.noAccess.title")} body={t("projectMoney.noAccess.body")} />;
}

export function Confirm({
  open,
  onOpenChange,
  title,
  body,
  label,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  body: string;
  label: string;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel variant="ghost">{t("projectMoney.cancel")}</AlertDialogCancel>
          <Button
            variant="destructive"
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

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-grid-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[12px] text-grid-muted">{hint}</p> : null}
    </div>
  );
}
