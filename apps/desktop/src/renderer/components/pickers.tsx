// Property pickers, the same everywhere (quick create, the issue view, a row's context menu): a
// compact trigger showing the current value, a menu with a filter field, keyboard-navigable.
// ↓ from the filter field moves into the list, ↵ picks the first match.
import { CheckIcon, TagIcon, UserIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { Label, Member, Project, Status } from "../../shared/types";
import { Avatar, ColorDot, PRIORITIES, PriorityIcon, ProjectMark, StatusIcon } from "@/components/kit";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Option<V> = { value: V; label: string; icon?: ReactNode; hint?: string };

/** What every picker accepts on top of its value: controlled opening (S/P/A/L), a trigger style. */
export interface PickerChrome {
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  /** Replaces the pill look, e.g. a bare icon in a list row or a full-width row in a panel. */
  triggerClassName?: string;
  align?: "start" | "end" | "center";
  disabled?: boolean;
}

const PILL =
  "inline-flex h-7 max-w-56 items-center gap-1.5 rounded-md border border-line bg-background px-2 text-[13px] text-grid-body hover:bg-grid-soft hover:text-grid-fg [&_svg]:shrink-0";

/** A pill trigger + menu. `multiple` keeps the menu open and toggles. */
export function PropertyMenu<V extends string>({
  options,
  value,
  onChange,
  multiple,
  trigger,
  placeholder,
  searchable,
  label,
  open,
  onOpenChange,
  align = "start",
  triggerClassName,
  disabled,
  footer,
}: {
  options: Option<V>[];
  value: V | V[] | null;
  onChange: (v: V) => void;
  multiple?: boolean;
  trigger: ReactNode;
  placeholder?: string;
  searchable?: boolean;
  label: string;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  align?: "start" | "end" | "center";
  triggerClassName?: string;
  disabled?: boolean;
  footer?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const selected = (v: V) => (Array.isArray(value) ? value.includes(v) : value === v);
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        if (!o) setQ("");
        onOpenChange?.(o);
      }}
    >
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            aria-label={label}
            title={label}
            onClick={(e) => e.stopPropagation()}
            className={triggerClassName ?? PILL}
          />
        }
      >
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-60" onClick={(e) => e.stopPropagation()}>
        {searchable ? (
          <div className="p-1 pb-1.5">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                const menu = e.currentTarget.closest("[data-slot=dropdown-menu-content]");
                const first = menu?.querySelector<HTMLElement>("[role^=menuitem]");
                if (e.key === "ArrowDown" && first) {
                  e.preventDefault();
                  first.focus();
                  return;
                }
                if (e.key === "Enter" && first) {
                  e.preventDefault();
                  first.click();
                  return;
                }
                if (e.key !== "Escape") e.stopPropagation();
              }}
              placeholder={placeholder}
              className="h-7 w-full rounded-md border border-line bg-background px-2 text-[13.5px] outline-none placeholder:text-grid-muted"
            />
          </div>
        ) : null}
        <DropdownMenuGroup>
          {shown.map((o) => (
            <DropdownMenuItem key={o.value} closeOnClick={!multiple} onClick={() => onChange(o.value)} className="gap-2 text-[13.5px]" data-option={o.value}>
              <span className="flex size-4 items-center justify-center">{o.icon}</span>
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint ? <span className="text-[12px] text-grid-muted">{o.hint}</span> : null}
              <CheckIcon className={cn("size-3.5", selected(o.value) ? "opacity-100" : "opacity-0")} />
            </DropdownMenuItem>
          ))}
          {shown.length === 0 ? <p className="px-2 py-1.5 text-[13px] text-grid-muted">{placeholder}</p> : null}
        </DropdownMenuGroup>
        {footer}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function StatusPicker({
  statuses,
  value,
  onChange,
  compact,
  ...chrome
}: { statuses: Status[]; value: string | null; onChange: (id: string) => void; compact?: boolean } & PickerChrome) {
  const { t } = useI18n();
  const cur = statuses.find((s) => s.id === value) ?? null;
  return (
    <PropertyMenu
      label={t("issue.status")}
      options={statuses.map((s) => ({ value: s.id, label: s.name, icon: <StatusIcon status={s} /> }))}
      value={value}
      onChange={onChange}
      searchable
      placeholder={t("issue.changeStatus")}
      {...chrome}
      trigger={
        <>
          <StatusIcon status={cur} />
          {compact ? null : <span className="truncate">{cur?.name ?? t("issue.status")}</span>}
        </>
      }
    />
  );
}

export function PriorityPicker({ value, onChange, compact, ...chrome }: { value: string | null; onChange: (p: string) => void; compact?: boolean } & PickerChrome) {
  const { t } = useI18n();
  return (
    <PropertyMenu
      label={t("issue.priority")}
      options={PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`), icon: <PriorityIcon priority={p} /> }))}
      value={value ?? "none"}
      onChange={onChange}
      {...chrome}
      trigger={
        <>
          <PriorityIcon priority={value} />
          {compact ? null : <span className="truncate">{t(`priority.${value ?? "none"}`)}</span>}
        </>
      }
    />
  );
}

/** Staff who can be assigned: active, not clients. */
export const assignable = (members: Member[]) => members.filter((m) => m.role !== "client" && m.status === "active");

export function AssigneePicker({
  members,
  value,
  onToggle,
  compact,
  trigger,
  ...chrome
}: { members: Member[]; value: string[]; onToggle: (userId: string) => void; compact?: boolean; trigger?: ReactNode } & PickerChrome) {
  const { t } = useI18n();
  const people = assignable(members);
  const first = members.find((m) => m.user_id === value[0]);
  return (
    <PropertyMenu
      label={t("issue.assignees")}
      multiple
      searchable
      placeholder={t("issue.assignTo")}
      options={people.map((m) => ({ value: m.user_id, label: m.email, icon: <Avatar id={m.user_id} email={m.email} size={16} /> }))}
      value={value}
      onChange={onToggle}
      {...chrome}
      trigger={
        trigger ??
        (first ? (
          <>
            <Avatar id={first.user_id} email={first.email} size={16} />
            {compact ? null : <span className="truncate" dir="ltr">{value.length > 1 ? `${first.email.split("@")[0]} +${value.length - 1}` : first.email.split("@")[0]}</span>}
          </>
        ) : (
          <>
            <UserIcon className="size-3.5 text-grid-muted" />
            {compact ? null : <span className="text-grid-muted">{t("issue.unassigned")}</span>}
          </>
        ))
      }
    />
  );
}

export function LabelPicker({
  labels,
  value,
  onToggle,
  trigger,
  ...chrome
}: { labels: Label[]; value: string[]; onToggle: (labelId: string) => void; trigger?: ReactNode } & PickerChrome) {
  const { t } = useI18n();
  const cur = labels.filter((l) => value.includes(l.id));
  return (
    <PropertyMenu
      label={t("issue.labels")}
      multiple
      searchable
      placeholder={labels.length ? t("issue.addLabel") : t("issue.noLabelsYet")}
      options={labels.map((l) => ({ value: l.id, label: l.name, icon: <ColorDot color={l.color} /> }))}
      value={value}
      onChange={onToggle}
      {...chrome}
      trigger={
        trigger ??
        (cur.length ? (
          <>
            {cur.slice(0, 3).map((l) => (
              <ColorDot key={l.id} color={l.color} className="size-2" />
            ))}
            <span className="truncate">{cur.length === 1 ? cur[0]!.name : t("issue.labelCount", { n: cur.length })}</span>
          </>
        ) : (
          <>
            <TagIcon className="size-3.5 text-grid-muted" />
            <span className="text-grid-muted">{t("issue.labels")}</span>
          </>
        ))
      }
    />
  );
}

export function ProjectPicker({ projects, value, onChange, ...chrome }: { projects: Project[]; value: string | null; onChange: (id: string) => void } & PickerChrome) {
  const { t } = useI18n();
  const cur = projects.find((p) => p.id === value);
  return (
    <PropertyMenu
      label={t("create.project")}
      searchable
      placeholder={t("create.project")}
      options={projects.map((p) => ({ value: p.id, label: p.name, icon: <ProjectMark name={p.name} color={p.color} size={14} /> }))}
      value={value}
      onChange={onChange}
      {...chrome}
      trigger={
        <>
          {cur ? <ProjectMark name={cur.name} color={cur.color} size={14} /> : null}
          <span className="truncate">{cur?.name ?? t("create.project")}</span>
        </>
      }
    />
  );
}
