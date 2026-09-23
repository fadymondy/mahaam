// A project's filter row: text, priority, assignee and label — all client-side, over the board the
// view already has. F focuses the text field, Esc in it clears and leaves.
import { SearchIcon, TagIcon, UserIcon, XIcon } from "lucide-react";
import { useRef } from "react";

import type { Label, Member, Task } from "../../../shared/types";
import { Avatar, ColorDot, PRIORITIES, PriorityIcon } from "@/components/kit";
import { assignable, PropertyMenu } from "@/components/pickers";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { useKeys } from "./util";

export interface Filters {
  q: string;
  priorities: string[];
  assignees: string[]; // "none" = unassigned
  labels: string[];
}

export const NO_FILTERS: Filters = { q: "", priorities: [], assignees: [], labels: [] };

export const filtersActive = (f: Filters) => !!(f.q.trim() || f.priorities.length || f.assignees.length || f.labels.length);

export function applyFilters(tasks: Task[], f: Filters): Task[] {
  const q = f.q.trim().toLowerCase();
  return tasks.filter((x) => {
    if (q && !x.title.toLowerCase().includes(q) && !x.key.toLowerCase().includes(q)) return false;
    if (f.priorities.length && !f.priorities.includes(x.priority)) return false;
    if (f.assignees.length) {
      const ids = x.assignee_ids ?? [];
      if (!f.assignees.some((a) => (a === "none" ? ids.length === 0 : ids.includes(a)))) return false;
    }
    if (f.labels.length && !f.labels.some((l) => (x.label_ids ?? []).includes(l))) return false;
    return true;
  });
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

const PILL = "inline-flex h-6 items-center gap-1.5 rounded-md border border-dashed border-line px-2 text-[12px] text-grid-muted hover:bg-grid-soft hover:text-grid-fg [&_svg]:size-3.5 [&_svg]:shrink-0";
const PILL_ON = "border-solid bg-grid-soft text-grid-fg";

export function FilterBar({
  value,
  onChange,
  members,
  labels,
  shown,
  total,
}: {
  value: Filters;
  onChange: (f: Filters) => void;
  members: Member[];
  labels: Label[];
  shown: number;
  total: number;
}) {
  const { t, number } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  useKeys({ f: () => input.current?.focus() });
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  const active = filtersActive(value);

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line ps-4 pe-3" data-filter-bar>
      <label className="flex h-6 min-w-0 flex-1 items-center gap-1.5 text-grid-muted">
        <SearchIcon className="size-3.5 shrink-0" />
        <input
          ref={input}
          value={value.q}
          onChange={(e) => set({ q: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              set({ q: "" });
              e.currentTarget.blur();
            }
            if (e.key === "Enter" || e.key === "ArrowDown") e.currentTarget.blur();
          }}
          placeholder={t("issues.find.placeholder")}
          dir="auto"
          className="h-6 min-w-0 flex-1 bg-transparent text-[12.5px] text-grid-fg outline-none placeholder:text-grid-muted"
          data-filter-text
        />
      </label>
      <PropertyMenu
        label={t("issue.priority")}
        multiple
        options={PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`), icon: <PriorityIcon priority={p} /> }))}
        value={value.priorities}
        onChange={(p) => set({ priorities: toggle(value.priorities, p) })}
        align="end"
        triggerClassName={cn(PILL, value.priorities.length && PILL_ON)}
        trigger={
          <>
            <PriorityIcon priority={value.priorities.length === 1 ? value.priorities[0] : "high"} />
            {value.priorities.length ? t("issues.find.count", { what: t("issue.priority"), n: value.priorities.length }) : t("issue.priority")}
          </>
        }
      />
      <PropertyMenu
        label={t("issue.assignees")}
        multiple
        searchable
        placeholder={t("issue.assignTo")}
        options={[
          { value: "none", label: t("issue.unassigned"), icon: <UserIcon className="size-3.5 text-grid-muted" /> },
          ...assignable(members).map((m) => ({ value: m.user_id, label: m.email, icon: <Avatar id={m.user_id} email={m.email} size={16} /> })),
        ]}
        value={value.assignees}
        onChange={(a) => set({ assignees: toggle(value.assignees, a) })}
        align="end"
        triggerClassName={cn(PILL, value.assignees.length && PILL_ON)}
        trigger={
          <>
            <UserIcon />
            {value.assignees.length ? t("issues.find.count", { what: t("issues.find.assignee"), n: value.assignees.length }) : t("issues.find.assignee")}
          </>
        }
      />
      <PropertyMenu
        label={t("issue.labels")}
        multiple
        searchable
        placeholder={labels.length ? t("issue.addLabel") : t("issue.noLabelsYet")}
        options={labels.map((l) => ({ value: l.id, label: l.name, icon: <ColorDot color={l.color} /> }))}
        value={value.labels}
        onChange={(l) => set({ labels: toggle(value.labels, l) })}
        align="end"
        triggerClassName={cn(PILL, value.labels.length && PILL_ON)}
        trigger={
          <>
            <TagIcon />
            {value.labels.length ? t("issues.find.count", { what: t("issues.find.label"), n: value.labels.length }) : t("issues.find.label")}
          </>
        }
      />
      {active ? (
        <>
          <span className="text-[11.5px] text-grid-muted tabular-nums" data-filter-count>
            {t("issues.find.shown", { n: number(shown), total: number(total) })}
          </span>
          <button
            type="button"
            onClick={() => onChange(NO_FILTERS)}
            title={t("issues.find.clear")}
            aria-label={t("issues.find.clear")}
            className="flex size-6 items-center justify-center rounded-md text-grid-muted hover:bg-grid-soft hover:text-grid-fg"
          >
            <XIcon className="size-3.5" />
          </button>
        </>
      ) : null}
    </div>
  );
}
