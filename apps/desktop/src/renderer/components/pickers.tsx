// Property pickers, the same everywhere (quick create, the issue view, a row's context menu): a
// compact trigger showing the current value, and a NATIVE menu — the operating system's own, with
// its type-to-select, keyboard navigation and checkmarks (main/native.ts). Multi-select pickers
// (assignees, labels) reopen after each toggle, so several can be picked in a row.
import { TagIcon, UserIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import type { Label, Member, Project, Status } from "../../shared/types";
import { Avatar, ColorDot, PRIORITIES, PriorityIcon, ProjectMark, soft, solid, StatusIcon } from "@/components/kit";
import { useI18n } from "@/lib/i18n";
import { nativeMenu, projectMenuImage } from "@/lib/native";

type Option<V> = {
  value: V;
  label: string;
  icon?: ReactNode;
  hint?: string;
  /** The row's image in the native menu (a data URL), e.g. a project's avatar. */
  menuImage?: () => Promise<string | undefined>;
};

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

/** A trigger that opens a native menu of `options`. `multiple` keeps it coming back after each pick. */
export function PropertyMenu<V extends string>({
  options,
  value,
  onChange,
  multiple,
  trigger,
  placeholder,
  label,
  open,
  onOpenChange,
  triggerClassName,
  disabled,
}: {
  options: Option<V>[];
  value: V | V[] | null;
  onChange: (v: V) => void;
  multiple?: boolean;
  trigger: ReactNode;
  placeholder?: string;
  /** Kept for callers; native menus type-select instead of a filter field. */
  searchable?: boolean;
  label: string;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  align?: "start" | "end" | "center";
  triggerClassName?: string;
  disabled?: boolean;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const showing = useRef(false);
  // Always the latest value, so a multi-select reopened after a toggle shows the new checks.
  const current = useRef(value);
  current.current = value;

  async function show() {
    if (showing.current || disabled || !ref.current) return;
    showing.current = true;
    onOpenChange?.(true);
    try {
      let picked: string | null;
      do {
        const sel = current.current;
        const isOn = (v: V) => (Array.isArray(sel) ? sel.includes(v) : sel === v);
        const images = await Promise.all(options.map((o) => o.menuImage?.()));
        const items = options.length
          ? options.map((o, i) => ({ id: o.value, label: o.label, sublabel: o.hint, image: images[i], type: (multiple ? "checkbox" : "radio") as "checkbox" | "radio", checked: isOn(o.value) }))
          : [{ label: placeholder ?? label, enabled: false }];
        picked = await nativeMenu(items, ref.current);
        if (picked !== null) {
          onChange(picked as V);
          // Let the caller's state settle before the menu reopens with the new checks.
          if (multiple) await new Promise((r) => setTimeout(r, 30));
        }
      } while (multiple && picked !== null);
    } finally {
      showing.current = false;
      onOpenChange?.(false);
    }
  }

  // Opened from the keyboard (S / P / A / L on a row).
  useEffect(() => {
    if (open) void show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        void show();
      }}
      className={triggerClassName ?? PILL}
    >
      {trigger}
    </button>
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
      options={projects.map((p) => ({
        value: p.id,
        label: p.name,
        icon: <ProjectMark name={p.name} color={p.color} id={p.id} size={14} />,
        menuImage: () => projectMenuImage(p, { soft: soft(p.color), solid: solid(p.color) }),
      }))}
      value={value}
      onChange={onChange}
      {...chrome}
      trigger={
        <>
          {cur ? <ProjectMark name={cur.name} color={cur.color} id={cur.id} size={14} /> : null}
          <span className="truncate">{cur?.name ?? t("create.project")}</span>
        </>
      }
    />
  );
}
