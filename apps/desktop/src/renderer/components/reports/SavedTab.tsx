// Saved report views: open one (its tab with its filters), save the current tab, rename, share
// (reports:share, manager+) and delete (the owner — `mine` shows the controls; the API decides).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkIcon, PencilIcon, Share2Icon, Trash2Icon, UsersIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import type { ReportFilters, ReportKind, SavedReport, SavedReportInput } from "../../../main/api-reports";
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/kit";
import { Badge, SmallButton } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { nativeConfirm } from "@/lib/native";

import { reportError, useReportRole } from "./util";

export function useSavedReports(enabled = true) {
  const { ws } = useApp();
  return useQuery({ queryKey: ["w", ws, "saved-reports"], queryFn: () => api.savedReports(), enabled: !!ws && enabled });
}

function useSavedWrites() {
  const { ws } = useApp();
  const qc = useQueryClient();
  const { t } = useI18n();
  const done = () => void qc.invalidateQueries({ queryKey: ["w", ws, "saved-reports"] });
  const fail = (err: unknown) => toast.error(reportError(err, t));
  return {
    create: useMutation({ mutationFn: (input: SavedReportInput) => api.createSavedReport(input), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: SavedReportInput }) => api.updateSavedReport(id, input), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api.deleteSavedReport(id), onSuccess: done, onError: fail }),
  };
}

export function SavedTab({ onOpen }: { onOpen: (v: SavedReport) => void }) {
  const { t, date } = useI18n();
  const role = useReportRole();
  const q = useSavedReports();
  const writes = useSavedWrites();
  const [renaming, setRenaming] = useState<SavedReport | null>(null);
  if (q.error) return <ErrorState error={new Error(reportError(q.error, t))} onRetry={() => void q.refetch()} />;
  if (!q.data) return <RowsSkeleton rows={4} />;
  // A profitability view is useless to someone who cannot open that tab.
  const views = q.data.filter((v) => v.kind !== "profitability" || role.finance);
  if (!views.length) return <EmptyState icon={<BookmarkIcon />} title={t("reports.saved.title")} body={t("reports.saved.empty")} />;
  const mine = views.filter((v) => v.mine);
  const others = views.filter((v) => !v.mine);

  async function remove(v: SavedReport) {
    const ok = await nativeConfirm({ message: t("reports.saved.deleteTitle", { name: v.name }), detail: t("reports.saved.deleteBody"), confirm: t("reports.saved.delete"), cancel: t("common.cancel"), destructive: true });
    if (ok) writes.remove.mutate(v.id, { onSuccess: () => toast.success(t("reports.saved.deleted")) });
  }

  const row = (v: SavedReport) => (
    <li key={v.id} className="group flex items-center gap-3 border-b border-line/60 px-4 py-2.5 hover:bg-grid-soft/50" data-saved-view={v.id}>
      <button type="button" onClick={() => onOpen(v)} className="flex min-w-0 flex-1 items-center gap-2 text-start">
        <BookmarkIcon className="size-3.5 shrink-0 text-grid-muted" />
        <span className="min-w-0 truncate text-[13.5px] font-medium" dir="auto">
          {v.name}
        </span>
        <Badge>{t(`reports.saved.kind.${v.kind}`)}</Badge>
        {v.shared ? (
          <Badge tone="action">
            <UsersIcon className="me-1 size-3" />
            {t("reports.saved.shared")}
          </Badge>
        ) : null}
        {v.filters.from && v.filters.to ? (
          <span className="truncate text-[12px] text-grid-muted">
            {date(`${v.filters.from}T00:00:00Z`, { day: "numeric", month: "short", timeZone: "UTC" })} – {date(`${v.filters.to}T00:00:00Z`, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
          </span>
        ) : null}
      </button>
      {v.mine ? (
        <div className="flex shrink-0 items-center gap-1">
          {role.share ? (
            <SmallButton
              onClick={() => writes.update.mutate({ id: v.id, input: { shared: !v.shared } }, { onSuccess: () => toast.success(t("reports.saved.updated")), onError: (err) => toast.error(reportError(err, t)) })}
              title={v.shared ? t("reports.saved.unshare") : t("reports.saved.makeShared")}
              data-saved-share={v.id}
            >
              <Share2Icon />
              {v.shared ? t("reports.saved.unshare") : t("reports.saved.share")}
            </SmallButton>
          ) : null}
          <SmallButton onClick={() => setRenaming(v)} title={t("reports.saved.rename")}>
            <PencilIcon />
          </SmallButton>
          <SmallButton tone="danger" onClick={() => void remove(v)} title={t("reports.saved.delete")} data-saved-delete={v.id}>
            <Trash2Icon />
          </SmallButton>
        </div>
      ) : null}
    </li>
  );

  return (
    <div data-saved-views>
      {mine.length ? (
        <>
          <h2 className="px-4 pt-4 pb-1.5 text-[12px] font-semibold text-grid-muted">{t("reports.saved.mine")}</h2>
          <ul className="border-t border-line/60">{mine.map(row)}</ul>
        </>
      ) : null}
      {others.length ? (
        <>
          <h2 className="px-4 pt-4 pb-1.5 text-[12px] font-semibold text-grid-muted">{t("reports.saved.fromOthers")}</h2>
          <ul className="border-t border-line/60">{others.map(row)}</ul>
        </>
      ) : null}
      <SaveDialog
        open={!!renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        initial={renaming ?? undefined}
        onSubmit={async (name) => {
          if (!renaming) return;
          await writes.update.mutateAsync({ id: renaming.id, input: { name } });
          toast.success(t("reports.saved.updated"));
          setRenaming(null);
        }}
      />
    </div>
  );
}

/** "Save view": the current tab's filters under a name, optionally shared. */
export function SaveViewButton({ kind, filters }: { kind: ReportKind; filters: ReportFilters }) {
  const { t } = useI18n();
  const writes = useSavedWrites();
  const [open, setOpen] = useState(false);
  return (
    <>
      <SmallButton onClick={() => setOpen(true)} data-save-view>
        <BookmarkIcon />
        {t("reports.saved.save")}
      </SmallButton>
      <SaveDialog
        open={open}
        onOpenChange={setOpen}
        withShare
        onSubmit={async (name, shared) => {
          await writes.create.mutateAsync({ name, kind, filters, shared });
          toast.success(t("reports.saved.saved"));
          setOpen(false);
        }}
      />
    </>
  );
}

function SaveDialog({
  open,
  onOpenChange,
  initial,
  withShare,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: SavedReport;
  withShare?: boolean;
  onSubmit: (name: string, shared: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  const role = useReportRole();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setShared(false);
      setError(null);
    }
  }, [open, initial]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError(t("reports.saved.nameRequired"));
    setBusy(true);
    try {
      await onSubmit(name.trim(), shared);
    } catch (err) {
      setError(reportError(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" data-save-view-dialog>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{initial ? t("reports.saved.renameTitle") : t("reports.saved.saveTitle")}</DialogTitle>
            {initial ? null : <DialogDescription>{t("reports.saved.saveHint")}</DialogDescription>}
          </DialogHeader>
          <label className="flex flex-col gap-1.5 text-[13px]">
            <span className="text-grid-muted">{t("reports.saved.name")}</span>
            <Input autoFocus dir="auto" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t("reports.saved.namePlaceholder")} />
          </label>
          {withShare && role.share ? (
            <label className="flex items-start justify-between gap-3 text-[13px]">
              <span>
                <span className="block">{t("reports.saved.share")}</span>
                <span className="block text-[12px] text-grid-muted">{t("reports.saved.shareHint")}</span>
              </span>
              <Switch checked={shared} onCheckedChange={setShared} />
            </label>
          ) : null}
          {error ? <p className="text-[12.5px] text-grid-danger">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
