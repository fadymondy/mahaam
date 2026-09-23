// The week's entries, newest day first, each day headed by its total. A row opens in place into an
// editor (description, what it was for, start–end in the workspace timezone, billable; Enter saves,
// Esc cancels). Right-click: edit, continue, delete. Locked (invoiced or approved) entries are
// read-only and say so.
import { DollarSignIcon, LockIcon, PencilIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { EntryPatch, TimeEntry } from "../../../shared/types";
import { Kbd, LtrText, ProjectMark } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { useTimeWrites } from "./data";
import { addDays, dayDate, dayIn, entrySeconds, errorText, hm, timeIn, zonedToUtc } from "./format";
import { Span } from "./LogTime";
import { fieldClass, TimeField } from "./TimeField";
import { sameTarget, TargetPicker, targetOf, type Target } from "./TargetPicker";

export interface DayGroup {
  day: string;
  total: number;
  entries: TimeEntry[];
}

interface Actions {
  onFocus: (id: string) => void;
  onEdit: (id: string | null) => void;
  onDelete: (e: TimeEntry) => void;
  onContinue: (e: TimeEntry) => void;
}

export function EntryList({
  groups,
  tz,
  today,
  now,
  focusId,
  editingId,
  ...actions
}: { groups: DayGroup[]; tz: string; today: string; now: number; focusId: string | null; editingId: string | null } & Actions) {
  const { t, date } = useI18n();
  const dayName = (d: string) =>
    d === today ? t("time.today") : d === addDays(today, -1) ? t("time.yesterday") : date(dayDate(d), { weekday: "long", day: "numeric", month: "short", timeZone: "UTC", numberingSystem: "latn" });
  return (
    <div data-time-entries>
      {groups.map((g) => (
        <section key={g.day} data-entry-day={g.day}>
          <header className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-line bg-grid-card ps-4 pe-4">
            <span className="text-[12px] font-medium text-grid-fg">{dayName(g.day)}</span>
            <span className="text-[11.5px] text-grid-muted">{g.entries.length === 1 ? t("time.entryOne") : t("time.entryCount", { n: g.entries.length })}</span>
            <LtrText className="ms-auto font-mono text-[12px] font-medium text-grid-fg tabular-nums">
              <span data-day-total>{hm(g.total, "0:00")}</span>
            </LtrText>
          </header>
          {g.entries.map((e) =>
            editingId === e.id ? (
              <EntryEditor key={e.id} entry={e} tz={tz} onDone={() => actions.onEdit(null)} onDelete={() => actions.onDelete(e)} />
            ) : (
              <EntryRow key={e.id} entry={e} tz={tz} now={now} focused={focusId === e.id} {...actions} />
            ),
          )}
        </section>
      ))}
    </div>
  );
}

function EntryRow({ entry: e, tz, now, focused, onFocus, onEdit, onDelete, onContinue }: { entry: TimeEntry; tz: string; now: number; focused: boolean } & Actions) {
  const { t } = useI18n();
  const running = !e.ended_at;
  const title = e.description || e.task_title || "";
  const secs = entrySeconds(e, now);
  const startDay = dayIn(e.started_at, tz);
  const crosses = e.ended_at && dayIn(e.ended_at, tz) !== startDay;
  return (
    <ContextMenu onOpenChange={(o) => o && onFocus(e.id)}>
      <ContextMenuTrigger
        render={
          <div
            role="row"
            tabIndex={-1}
            aria-selected={focused}
            data-entry={e.id}
            data-focused={focused || undefined}
            data-locked={e.locked || undefined}
            onMouseMove={() => !focused && onFocus(e.id)}
            onClick={() => {
              onFocus(e.id);
              if (!e.locked) onEdit(e.id);
            }}
            className={cn(
              "group/entry relative flex h-9 items-center gap-2.5 border-b border-line ps-4 pe-3 outline-none",
              focused && "bg-grid-soft/70",
              running && "bg-grid-action/[0.04]",
            )}
          />
        }
      >
        {focused ? <span className="absolute inset-y-0 start-0 w-0.5 bg-grid-action" aria-hidden /> : null}
        {e.project_id ? <ProjectMark name={e.project_name ?? "?"} color={e.project_color} size={14} /> : <span className="size-3.5 shrink-0 rounded-[4px] border border-dashed border-line" />}
        <span className={cn("min-w-0 truncate text-[13px]", title ? "text-grid-fg" : "text-grid-muted")} dir="auto">
          {title || t("time.noDescription")}
        </span>
        {e.task_key ? <LtrText className="shrink-0 font-mono text-[11px] text-grid-muted">{e.task_key}</LtrText> : null}
        {e.project_name ? <span className="min-w-0 shrink truncate text-[12px] text-grid-muted">{e.project_name}</span> : null}
        <span className="flex-1" />
        {e.billable ? (
          <span title={t("time.billable")} className="flex size-4 shrink-0 items-center justify-center text-grid-muted" data-billable>
            <DollarSignIcon className="size-3.5" />
          </span>
        ) : null}
        {e.locked ? (
          <span title={t("time.locked")} className="flex size-4 shrink-0 items-center justify-center text-grid-muted" data-lock>
            <LockIcon className="size-3.5" />
          </span>
        ) : null}
        <LtrText className="w-[104px] shrink-0 text-end font-mono text-[12px] text-grid-muted tabular-nums">
          {timeIn(e.started_at, tz)}–{running ? t("time.now") : timeIn(e.ended_at!, tz)}
          {crosses ? <sup className="ms-px text-[9px]">+1</sup> : null}
        </LtrText>
        <LtrText className={cn("w-[64px] shrink-0 text-end font-mono text-[13px] tabular-nums", running ? "font-medium text-grid-action" : "text-grid-fg")}>
          {running ? clockShort(secs) : hm(secs, "0:00")}
        </LtrText>
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            onContinue(e);
          }}
          disabled={running}
          title={t("time.continue")}
          aria-label={t("time.continue")}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded text-grid-muted hover:bg-background hover:text-grid-fg",
            running ? "invisible" : focused ? "visible" : "invisible group-hover/entry:visible",
          )}
          data-entry-continue
        >
          <PlayIcon className="size-3.5" />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <MenuItem icon={<PencilIcon />} disabled={e.locked} onClick={() => onEdit(e.id)} label={t("common.edit")} combo="enter" />
        <MenuItem icon={<PlayIcon />} disabled={running} onClick={() => onContinue(e)} label={t("time.continue")} combo="s" />
        <ContextMenuSeparator />
        <MenuItem icon={<Trash2Icon />} disabled={e.locked} destructive onClick={() => onDelete(e)} label={t("common.delete")} combo="backspace" />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function MenuItem({ icon, label, combo, onClick, disabled, destructive }: { icon: ReactNode; label: string; combo: string; onClick: () => void; disabled?: boolean; destructive?: boolean }) {
  return (
    <ContextMenuItem onClick={onClick} disabled={disabled} variant={destructive ? "destructive" : "default"} className="text-[12.5px] [&_svg]:size-3.5">
      {icon}
      <span className="flex-1">{label}</span>
      <Kbd combo={combo === "backspace" ? "⌫" : combo} className="border-transparent bg-transparent" />
    </ContextMenuItem>
  );
}

const clockShort = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

function EntryEditor({ entry: e, tz, onDone, onDelete }: { entry: TimeEntry; tz: string; onDone: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  const { update } = useTimeWrites();
  const running = !e.ended_at;
  const startDay = dayIn(e.started_at, tz);
  const orig = { start: timeIn(e.started_at, tz), end: e.ended_at ? timeIn(e.ended_at, tz) : "" };
  const [desc, setDesc] = useState(e.description);
  const [target, setTarget] = useState<Target>(targetOf(e));
  const [start, setStart] = useState(orig.start);
  const [end, setEnd] = useState(orig.end);
  const [billable, setBillable] = useState(e.billable);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const descRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    descRef.current?.focus();
    descRef.current?.select();
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const save = () => {
    const patch: EntryPatch = {};
    if (desc.trim() !== e.description) patch.description = desc.trim();
    if (!sameTarget(target, targetOf(e))) {
      patch.project = target.project ?? "";
      patch.task = target.task?.id ?? "";
    }
    if (billable !== e.billable) patch.billable = billable;
    if (start && start !== orig.start) patch.started_at = zonedToUtc(startDay, start, tz);
    if (!running && end && (end !== orig.end || start !== orig.start)) {
      // An end at or before the start is on the next day (23:00–01:00).
      const endDay = end <= start ? addDays(startDay, 1) : startDay;
      const iso = zonedToUtc(endDay, end, tz);
      if (end !== orig.end || iso !== e.ended_at) patch.ended_at = iso;
    }
    if (!Object.keys(patch).length) return onDone();
    setError(null);
    update.mutate({ id: e.id, patch }, { onSuccess: onDone, onError: (err) => setError(errorText(err, t("common.error"))) });
  };

  const durMin = (() => {
    if (running || !start || !end) return 0;
    const toMin = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
    let m = toMin(end) - toMin(start);
    if (m <= 0) m += 1440;
    return m;
  })();

  return (
    <div
      ref={ref}
      data-entry-editor={e.id}
      className="relative border-b border-line bg-grid-card px-4 py-3"
      onKeyDown={(ev) => {
        if (ev.key === "Enter" && !ev.nativeEvent.isComposing && !(ev.target as HTMLElement).closest("[data-target-picker]")) {
          ev.preventDefault();
          ev.stopPropagation();
          save();
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation();
          onDone();
        }
      }}
    >
      <span className="absolute inset-y-0 start-0 w-0.5 bg-grid-action" aria-hidden />
      <div className="flex items-center gap-2">
        <input
          ref={descRef}
          dir="auto"
          value={desc}
          onChange={(ev) => setDesc(ev.target.value)}
          placeholder={e.task_title || t("time.whatDidYouDo")}
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-background px-2 text-[13px] text-grid-fg outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          data-edit-description
        />
        <TargetPicker value={target} onChange={setTarget} className="max-w-64" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5" dir="ltr">
          <TimeField value={start} onChange={setStart} aria-label={t("time.start")} data-edit-start />
          <span className="text-grid-muted">–</span>
          {running ? (
            <span className={cn(fieldClass, "flex w-[64px] items-center justify-center text-grid-muted")}>{t("time.now")}</span>
          ) : (
            <TimeField value={end} onChange={setEnd} aria-label={t("time.end")} data-edit-end />
          )}
        </div>
        <Span seconds={durMin * 60} />
        <span className="text-[11.5px] text-grid-muted" title={tz}>
          {tz}
        </span>
        <label className="ms-2 flex items-center gap-2 text-[12px] text-grid-muted">
          <Switch checked={billable} onCheckedChange={setBillable} size="sm" data-edit-billable />
          {t("time.billable")}
        </label>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" className="text-grid-muted hover:text-grid-danger" onClick={onDelete} data-edit-delete>
          <Trash2Icon />
          {t("common.delete")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" onClick={save} disabled={update.isPending} data-edit-save>
          {t("common.save")}
          <Kbd combo="enter" className="border-primary-foreground/30 bg-transparent text-primary-foreground/80" />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] text-grid-danger" data-edit-error>
          {error}
        </p>
      ) : null}
    </div>
  );
}
