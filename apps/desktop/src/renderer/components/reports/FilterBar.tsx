// The report filter row: range preset and dates, grouping, projects/clients/labels/members, billable
// and rounding. Every choice is a native menu (checkbox items for the multi-selects), like the rest
// of the desktop app. Also the export buttons (CSV, Excel, PDF, Markdown).
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, FileCodeIcon, FileSpreadsheetIcon, FileTextIcon, FileTypeIcon, RotateCcwIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import type { ExportFormat, ExportRequest, ReportFilters, ReportGroup } from "../../../main/api-reports";
import { Spinner } from "@/components/kit";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useLabels, useMembers, useProjects } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { nativeMenu, type NativeMenuItem } from "@/lib/native";
import { cn } from "@/lib/utils";

import { PRESETS, presetOf, presetRange, reportError, saveFile, useReportRole, useWorkspaceTime } from "./util";

const GROUPS: ReportGroup[] = ["project", "member", "client", "label", "task", "day", "week"];
const ROUNDINGS = [-1, 0, 1, 5, 6, 10, 15, 30, 60];

const BTN =
  "inline-flex h-7 max-w-56 items-center gap-1.5 rounded-md border border-line bg-background px-2.5 text-[13px] text-grid-fg hover:bg-grid-soft aria-expanded:bg-grid-soft [&_svg]:size-3.5 [&_svg]:shrink-0";

function MenuButton({ label, value, active, onOpen, attr }: { label: string; value: ReactNode; active?: boolean; onOpen: (el: HTMLElement) => void; attr: string }) {
  return (
    <button type="button" className={cn(BTN, active && "border-grid-action/40 bg-grid-action/8")} onClick={(e) => onOpen(e.currentTarget)} data-filter={attr}>
      <span className="text-grid-muted">{label}</span>
      <span className="min-w-0 truncate">{value}</span>
      <ChevronDownIcon className="text-grid-muted" />
    </button>
  );
}

export function useClientOptions(enabled: boolean) {
  const { ws } = useApp();
  return useQuery({ queryKey: ["w", ws, "reports", "clients"], queryFn: () => api.reportClients(), enabled: !!ws && enabled, staleTime: 5 * 60_000 });
}

export function FilterBar({
  filters: f,
  onChange,
  onReset,
  group = true,
  labels = true,
  billable = true,
  members = true,
}: {
  filters: ReportFilters;
  onChange: (next: Partial<ReportFilters>) => void;
  onReset: () => void;
  group?: boolean;
  labels?: boolean;
  billable?: boolean;
  members?: boolean;
}) {
  const { t, number } = useI18n();
  const role = useReportRole();
  const time = useWorkspaceTime();
  const projects = useProjects();
  const archived = useProjects(true);
  const labelList = useLabels();
  const memberList = useMembers();
  const clients = useClientOptions(role.clients);

  const preset = presetOf(f.from, f.to, time.today, time.weekStart);
  const roundLabel = (n: number) => (n === 0 ? t("reports.rounding.none") : t("reports.rounding.minutes", { n }));
  const roundingText = (n: number | null | undefined) => (n == null || n < 0 ? t("reports.rounding.default", { n: roundLabel(time.rounding) }) : roundLabel(n));

  async function pick<V extends string>(el: HTMLElement, items: { id: V; label: string; checked: boolean }[]): Promise<V | null> {
    const menu: NativeMenuItem[] = items.map((i) => ({ id: i.id, label: i.label, type: "radio", checked: i.checked }));
    return (await nativeMenu(menu, el)) as V | null;
  }

  async function multi(el: HTMLElement, key: "projects" | "clients" | "labels" | "users", options: { id: string; label: string }[]) {
    const current = f[key] ?? [];
    const menu: NativeMenuItem[] = [
      { id: "__all", label: t("reports.any"), type: "checkbox", checked: current.length === 0 },
      { type: "separator" },
      ...options.map((o) => ({ id: o.id, label: o.label, type: "checkbox" as const, checked: current.includes(o.id) })),
    ];
    const id = await nativeMenu(menu, el);
    if (!id) return;
    if (id === "__all") return onChange({ [key]: [] });
    onChange({ [key]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] });
  }

  const summary = (ids: string[] | undefined, options: { id: string; label: string }[]) => {
    if (!ids?.length) return t("reports.any");
    if (ids.length === 1) return options.find((o) => o.id === ids[0])?.label ?? t("reports.nSelected", { n: number(1) });
    return t("reports.nSelected", { n: number(ids.length) });
  };

  const projectOptions = [...(projects.data ?? []), ...(archived.data ?? [])]
    .filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i)
    .map((p) => ({ id: p.id, label: p.name }));
  const clientOptions = (clients.data ?? []).map((c) => ({ id: c.id, label: c.name }));
  const labelOptions = (labelList.data ?? []).map((l) => ({ id: l.id, label: l.name }));
  const memberOptions = (memberList.data ?? []).filter((m) => m.role !== "client").map((m) => ({ id: m.user_id, label: m.email }));

  const dateInput = "h-7 rounded-md border border-line bg-background px-2 font-mono text-[13px] text-grid-fg [color-scheme:light] dark:[color-scheme:dark]";

  return (
    <section aria-label={t("reports.filters")} className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5" data-filter-bar>
      <MenuButton
        attr="range"
        label={t("reports.range")}
        value={t(`reports.preset.${preset}`)}
        onOpen={async (el) => {
          const v = await pick(el, PRESETS.map((p) => ({ id: p, label: t(`reports.preset.${p}`), checked: p === preset })));
          if (v) onChange(presetRange(v, time.today, time.weekStart));
        }}
      />
      <label className="flex items-center gap-1.5 text-[13px] text-grid-muted">
        {t("reports.from")}
        <input
          type="date"
          dir="ltr"
          className={dateInput}
          value={f.from ?? ""}
          onChange={(e) => e.target.value && onChange({ from: e.target.value, ...(f.to && e.target.value > f.to ? { to: e.target.value } : {}) })}
          data-filter="from"
        />
      </label>
      <label className="flex items-center gap-1.5 text-[13px] text-grid-muted">
        {t("reports.to")}
        <input
          type="date"
          dir="ltr"
          className={dateInput}
          value={f.to ?? ""}
          onChange={(e) => e.target.value && onChange({ to: e.target.value, ...(f.from && e.target.value < f.from ? { from: e.target.value } : {}) })}
          data-filter="to"
        />
      </label>
      {group ? (
        <MenuButton
          attr="group"
          label={t("reports.groupBy")}
          value={t(`reports.group.${f.group_by ?? "project"}`)}
          onOpen={async (el) => {
            const v = await pick(el, GROUPS.map((g) => ({ id: g, label: t(`reports.group.${g}`), checked: (f.group_by ?? "project") === g })));
            if (v) onChange({ group_by: v });
          }}
        />
      ) : null}
      <MenuButton attr="projects" label={t("reports.projects")} value={summary(f.projects, projectOptions)} active={!!f.projects?.length} onOpen={(el) => void multi(el, "projects", projectOptions)} />
      {role.clients ? (
        <MenuButton attr="clients" label={t("reports.clients")} value={summary(f.clients, clientOptions)} active={!!f.clients?.length} onOpen={(el) => void multi(el, "clients", clientOptions)} />
      ) : null}
      {labels ? (
        <MenuButton attr="labels" label={t("reports.labels")} value={summary(f.labels, labelOptions)} active={!!f.labels?.length} onOpen={(el) => void multi(el, "labels", labelOptions)} />
      ) : null}
      {members && role.all && memberOptions.length ? (
        <MenuButton attr="members" label={t("reports.members")} value={summary(f.users, memberOptions)} active={!!f.users?.length} onOpen={(el) => void multi(el, "users", memberOptions)} />
      ) : null}
      {billable ? (
        <MenuButton
          attr="billable"
          label={t("reports.billableFilter")}
          value={t(`reports.billable.${f.billable || "all"}`)}
          active={!!f.billable}
          onOpen={async (el) => {
            const v = await pick(
              el,
              (["all", "billable", "non_billable"] as const).map((b) => ({ id: b, label: t(`reports.billable.${b}`), checked: (f.billable || "all") === b })),
            );
            if (v) onChange({ billable: v === "all" ? "" : v });
          }}
        />
      ) : null}
      <MenuButton
        attr="rounding"
        label={t("reports.rounding")}
        value={roundingText(f.rounding)}
        active={f.rounding != null && f.rounding >= 0}
        onOpen={async (el) => {
          const v = await pick(el, ROUNDINGS.map((n) => ({ id: String(n), label: roundingText(n), checked: String(f.rounding ?? -1) === String(n) })));
          if (v != null) onChange({ rounding: Number(v) < 0 ? null : Number(v) });
        }}
      />
      <button type="button" onClick={onReset} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-grid-muted hover:bg-grid-soft hover:text-grid-fg [&_svg]:size-3.5" data-reset-filters>
        <RotateCcwIcon />
        {t("reports.reset")}
      </button>
    </section>
  );
}

const FORMATS: ExportFormat[] = ["csv", "xlsx", "pdf", "md"];
const ICONS = { csv: FileTextIcon, xlsx: FileSpreadsheetIcon, pdf: FileTypeIcon, md: FileCodeIcon } as const;

/** CSV, Excel, PDF and Markdown of what the table shows. */
export function ExportButtons({ request, label }: { request: Omit<ExportRequest, "format" | "lang">; label?: string }) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  async function run(format: ExportFormat) {
    setBusy(format);
    try {
      const file = await api.exportReport({ ...request, format, lang: locale === "ar" ? "ar" : "en" });
      saveFile(file);
      toast.success(t("reports.exported", { name: file.name }));
    } catch (err) {
      toast.error(reportError(err, t));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label ? `${t("reports.export")} · ${label}` : t("reports.export")}>
      {label ? <span className="me-1 text-[12.5px] text-grid-muted">{label}</span> : null}
      {FORMATS.map((f) => {
        const Icon = ICONS[f];
        return (
          <button key={f} type="button" disabled={!!busy} onClick={() => void run(f)} className={cn(BTN, "disabled:opacity-50")} title={`${t("reports.export")} ${t(`reports.format.${f}`)}`} data-export={f}>
            {busy === f ? <Spinner /> : <Icon />}
            {t(`reports.format.${f}`)}
          </button>
        );
      })}
    </div>
  );
}
