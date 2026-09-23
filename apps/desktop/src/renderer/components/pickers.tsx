// Property pickers, the same everywhere (quick create, the issue view, a row's context menu): a
// compact trigger showing the current value, a menu with a filter field, keyboard-navigable.
import { CheckIcon, UserIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { Member, Project, Status } from "../../shared/types";
import { Avatar, PRIORITIES, PriorityIcon, ProjectMark, StatusIcon } from "@/components/kit";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Option<V> = { value: V; label: string; icon?: ReactNode; hint?: string };

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
        render={
          <button
            type="button"
            aria-label={label}
            title={label}
            className="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-md border border-line bg-background px-2 text-[12px] text-grid-body hover:bg-grid-soft hover:text-grid-fg [&_svg]:shrink-0"
          />
        }
      >
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-60">
        {searchable ? (
          <div className="p-1 pb-1.5">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder={placeholder}
              className="h-7 w-full rounded-md border border-line bg-background px-2 text-[12.5px] outline-none placeholder:text-grid-muted"
            />
          </div>
        ) : null}
        <DropdownMenuGroup>
          {shown.map((o) => (
            <DropdownMenuItem
              key={o.value}
              closeOnClick={!multiple}
              onClick={() => onChange(o.value)}
              className="gap-2 text-[12.5px]"
            >
              <span className="flex size-4 items-center justify-center">{o.icon}</span>
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint ? <span className="text-[11px] text-grid-muted">{o.hint}</span> : null}
              <CheckIcon className={cn("size-3.5", selected(o.value) ? "opacity-100" : "opacity-0")} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function StatusPicker({ statuses, value, onChange, compact }: { statuses: Status[]; value: string | null; onChange: (id: string) => void; compact?: boolean }) {
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
      trigger={
        <>
          <StatusIcon status={cur} />
          {compact ? null : <span className="truncate">{cur?.name ?? t("issue.status")}</span>}
        </>
      }
    />
  );
}

export function PriorityPicker({ value, onChange, compact }: { value: string | null; onChange: (p: string) => void; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <PropertyMenu
      label={t("issue.priority")}
      options={PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`), icon: <PriorityIcon priority={p} /> }))}
      value={value ?? "none"}
      onChange={onChange}
      trigger={
        <>
          <PriorityIcon priority={value} />
          {compact ? null : <span className="truncate">{t(`priority.${value ?? "none"}`)}</span>}
        </>
      }
    />
  );
}

export function AssigneePicker({ members, value, onToggle, compact }: { members: Member[]; value: string[]; onToggle: (userId: string) => void; compact?: boolean }) {
  const { t } = useI18n();
  const people = members.filter((m) => m.role !== "client" && m.status === "active");
  const first = people.find((m) => m.user_id === value[0]);
  return (
    <PropertyMenu
      label={t("issue.assignees")}
      multiple
      searchable
      placeholder={t("issue.assignTo")}
      options={people.map((m) => ({ value: m.user_id, label: m.email, icon: <Avatar id={m.user_id} email={m.email} size={16} /> }))}
      value={value}
      onChange={onToggle}
      trigger={
        first ? (
          <>
            <Avatar id={first.user_id} email={first.email} size={16} />
            {compact ? null : <span className="truncate" dir="ltr">{value.length > 1 ? `${first.email.split("@")[0]} +${value.length - 1}` : first.email.split("@")[0]}</span>}
          </>
        ) : (
          <>
            <UserIcon className="size-3.5 text-grid-muted" />
            {compact ? null : <span className="text-grid-muted">{t("issue.unassigned")}</span>}
          </>
        )
      }
    />
  );
}

export function ProjectPicker({ projects, value, onChange }: { projects: Project[]; value: string | null; onChange: (id: string) => void }) {
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
      trigger={
        <>
          {cur ? <ProjectMark name={cur.name} color={cur.color} size={14} /> : null}
          <span className="truncate">{cur?.name ?? t("create.project")}</span>
        </>
      }
    />
  );
}
