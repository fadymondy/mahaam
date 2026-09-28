// Clients: the workspace's customers. Search, currency / work filters and the archived switch as on
// the web; managers can create, edit, archive / restore and import. J/K or ↑/↓ and ↵ open one.
import { useQuery } from "@tanstack/react-query";
import { ArchiveIcon, ArchiveRestoreIcon, BriefcaseIcon, PencilIcon, PlusIcon, SearchIcon, UploadIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { Client } from "../../../main/api-clients";
import { ClientFormDialog } from "@/components/clients/ClientForm";
import { ClientImportDialog } from "@/components/clients/ClientImport";
import { clientCaps, clientErrorText, money } from "@/components/clients/util";
import { EmptyState, ErrorState, LtrText, RowsSkeleton, ViewHeader } from "@/components/kit";
import { HeaderButton } from "@/components/issues/controls";
import { pointerMoved, revealFocused, useKeys } from "@/components/issues/util";
import { fieldClass } from "@/components/time/TimeField";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { queryClient } from "@/lib/query";
import { useRouter } from "@/lib/router";
import { cn } from "@/lib/utils";

const COLS = "grid grid-cols-[minmax(0,1fr)_80px_64px] @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px_80px_64px] items-center gap-4";

export function ClientsView() {
  const { t, number, locale } = useI18n();
  const { navigate } = useRouter();
  const { ws, workspace } = useApp();
  const caps = clientCaps(workspace?.role);
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState("");
  const [currency, setCurrency] = useState("");
  const [work, setWork] = useState("");
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const [importing, setImporting] = useState(false);

  const clients = useQuery({ queryKey: ["w", ws, "clients", { archived }], queryFn: () => api.clients(archived), enabled: !!ws && caps.read });
  const all = useMemo(() => clients.data ?? [], [clients.data]);
  const currencies = useMemo(() => [...new Set(all.map((c) => c.currency).filter(Boolean))].sort(), [all]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((c) => {
      if (needle && !`${c.name} ${c.email ?? ""} ${c.phone ?? ""} ${c.company ?? ""} ${c.country ?? ""}`.toLowerCase().includes(needle)) return false;
      if (currency && c.currency !== currency) return false;
      if (work === "with" && !c.project_count) return false;
      if (work === "without" && c.project_count) return false;
      return true;
    });
  }, [all, q, currency, work]);
  const filtered = !!(q.trim() || currency || work);

  const [focus, setFocus] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const keyboard = useRef(false);
  useEffect(() => {
    if (keyboard.current && focus) revealFocused(scroller.current, `[data-client-row="${focus}"]`);
    keyboard.current = false;
  }, [focus]);
  const step = (d: number) => {
    if (!rows.length) return;
    keyboard.current = true;
    const i = rows.findIndex((c) => c.id === focus);
    const n = i < 0 ? (d > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, i + d));
    setFocus(rows[n]!.id);
  };
  const open = (c: Client) => navigate({ name: "client", id: c.id });
  useKeys({
    j: () => step(1),
    arrowdown: () => step(1),
    k: () => step(-1),
    arrowup: () => step(-1),
    enter: () => {
      const c = rows.find((x) => x.id === focus);
      if (c) open(c);
      else step(1);
    },
    escape: () => setFocus(null),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["w", ws, "clients"] });
  async function toggleArchive(c: Client) {
    try {
      if (c.archived_at) await api.restoreClient(c.id);
      else await api.archiveClient(c.id);
      toast.success(c.archived_at ? t("clients.restored") : t("clients.archivedDone"));
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["w", ws, "client", c.id] });
    } catch (e) {
      toast.error(clientErrorText(e, t));
    }
  }

  const header = (
    <ViewHeader
      title={t("clients.title")}
      icon={<BriefcaseIcon className="size-3.5 text-grid-muted" />}
      actions={
        caps.read ? (
          <>
            <label className="flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-grid-muted hover:text-grid-fg" data-archived-toggle>
              <ArchiveIcon className="size-3.5" />
              {t("clients.showArchived")}
              <Switch size="sm" checked={archived} onCheckedChange={setArchived} />
            </label>
            {caps.write ? (
              <>
                <HeaderButton icon={<UploadIcon />} label={t("clients.import")} onClick={() => setImporting(true)} data-action="import" />
                <HeaderButton icon={<PlusIcon />} label={t("clients.new")} onClick={() => setEditing("new")} data-action="new" />
              </>
            ) : null}
          </>
        ) : null
      }
    >
      {clients.data ? <span className="text-[13px] text-grid-muted tabular-nums">{number(rows.length)}</span> : null}
    </ViewHeader>
  );

  if (!caps.read) {
    return (
      <>
        {header}
        <EmptyState icon={<BriefcaseIcon />} title={t("clients.noPermission")} />
      </>
    );
  }

  return (
    <>
      {header}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-grid-muted" aria-hidden />
          <input type="search" dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("clients.search")} aria-label={t("clients.search")} className={cn(fieldClass, "w-full ps-7")} data-clients-search />
        </div>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label={t("clients.filterCurrency")} className={cn(fieldClass, "w-40")}>
          <option value="">{t("clients.allCurrencies")}</option>
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={work} onChange={(e) => setWork(e.target.value)} aria-label={t("clients.filterWork")} className={cn(fieldClass, "w-44")}>
          <option value="">{t("clients.allClients")}</option>
          <option value="with">{t("clients.withProjects")}</option>
          <option value="without">{t("clients.withoutProjects")}</option>
        </select>
      </div>

      {clients.isError ? (
        <ErrorState error={new Error(clientErrorText(clients.error, t))} onRetry={() => void clients.refetch()} />
      ) : clients.isPending ? (
        <RowsSkeleton rows={6} />
      ) : !rows.length && filtered ? (
        <EmptyState icon={<SearchIcon />} title={t("clients.noMatch")} />
      ) : !rows.length ? (
        <EmptyState icon={<BriefcaseIcon />} title={t("clients.empty")} body={caps.write ? t("clients.emptyBody") : undefined} />
      ) : (
        <div ref={scroller} className="@container min-h-0 flex-1 overflow-y-auto" role="grid" aria-label={t("clients.title")} data-clients>
          <div className={cn(COLS, "sticky top-0 z-[1] h-8 border-b border-line bg-background ps-4 pe-4 text-[12.5px] text-grid-muted")} role="row">
            <span role="columnheader">{t("clients.name")}</span>
            <span role="columnheader" className="hidden @2xl:block">
              {t("clients.email")}
            </span>
            <span role="columnheader" className="hidden @2xl:block">
              {t("clients.rate")}
            </span>
            <span role="columnheader" className="text-end">
              {t("clients.projects")}
            </span>
            <span role="columnheader" className="sr-only">
              {t("clients.actions")}
            </span>
          </div>
          {rows.map((c) => (
            <div
              key={c.id}
              role="row"
              data-client-row={c.id}
              data-focused={focus === c.id || undefined}
              onClick={() => open(c)}
              onMouseMove={(e) => pointerMoved(e) && focus !== c.id && setFocus(c.id)}
              className={cn(
                COLS,
                "group relative h-9 border-b border-line/50 ps-4 pe-4 text-[14px]",
                focus === c.id && "bg-grid-soft/70 before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-grid-action",
              )}
            >
              <span className="flex min-w-0 items-center gap-2" role="gridcell">
                <span className={cn("truncate font-medium", c.archived_at ? "text-grid-muted" : "text-grid-fg")} dir="auto">
                  {c.name}
                </span>
                {c.company ? (
                  <span className="truncate text-[13px] text-grid-muted" dir="auto">
                    {c.company}
                  </span>
                ) : null}
                {c.archived_at ? <ArchiveIcon className="size-3 shrink-0 text-grid-muted" aria-label={t("clients.archivedBadge")} /> : null}
              </span>
              <span className="hidden truncate text-[13.5px] text-grid-body @2xl:block" role="gridcell">
                {c.email ? <LtrText>{c.email}</LtrText> : <span className="text-grid-muted">—</span>}
              </span>
              <span className="hidden truncate text-[13px] text-grid-muted @2xl:block" role="gridcell">
                {c.default_rate_minor != null ? (
                  <LtrText>
                    {money(c.default_rate_minor, c.currency, locale)}/{t("clients.hourShort")}
                  </LtrText>
                ) : (
                  <LtrText className="font-mono">{c.currency}</LtrText>
                )}
              </span>
              <span className="text-end text-[13px] text-grid-muted tabular-nums" role="gridcell">
                {number(c.project_count)}
              </span>
              <span className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 group-data-[focused]:opacity-100" role="gridcell">
                {caps.write ? (
                  <>
                    <RowButton label={t("clients.edit")} onClick={() => setEditing(c)}>
                      <PencilIcon />
                    </RowButton>
                    <RowButton label={c.archived_at ? t("clients.restore") : t("clients.archive")} onClick={() => void toggleArchive(c)}>
                      {c.archived_at ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                    </RowButton>
                  </>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}

      {caps.write ? (
        <>
          <ClientFormDialog client={editing === "new" ? null : editing} open={!!editing} onOpenChange={(o) => !o && setEditing(null)} />
          <ClientImportDialog open={importing} onOpenChange={setImporting} onImported={refresh} />
        </>
      ) : null}
    </>
  );
}

function RowButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex size-6 items-center justify-center rounded text-grid-muted hover:bg-grid-soft hover:text-grid-fg [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}
