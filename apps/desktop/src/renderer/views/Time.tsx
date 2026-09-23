// Time: the timer bar, the week in numbers, the week as a timesheet, and every entry by day.
// Keyboard-first — J/K move through entries, Enter edits, S continues, ⌫ deletes, L logs time,
// [ and ] change week, T comes back to this week. Days and clock times are the workspace's timezone.
import { ChevronLeftIcon, ChevronRightIcon, ClockIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import type { TimeEntry } from "../../shared/types";
import { EmptyState, ErrorState, Kbd, RowsSkeleton, Spinner, ViewHeader } from "@/components/kit";
import { Confirm, type ConfirmRequest } from "@/components/time/Confirm";
import { continueInput, useTimesheet, useTimeWrites } from "@/components/time/data";
import { EntryList, type DayGroup } from "@/components/time/EntryList";
import { addDays, dayDate, dayIn, entryTitle, errorText, hm } from "@/components/time/format";
import { LogTime, type LogPreset } from "@/components/time/LogTime";
import { Summary, type Stat } from "@/components/time/Summary";
import { TimerBar } from "@/components/time/TimerBar";
import { rowKey, WeekGrid } from "@/components/time/WeekGrid";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/app";
import { useHotkey } from "@/lib/hotkeys";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useNow } from "@/shell/Timer";

const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function TimeView() {
  const { t, date } = useI18n();
  const app = useApp();
  const [week, setWeek] = useState<string | undefined>(undefined);
  const sheet = useTimesheet(week);
  const ts = sheet.data;
  const tz = ts?.timezone || localTz();
  const writes = useTimeWrites();

  // The running timer: the main process's (instant), with the server's copy when it is newer
  // (an edit to its description arrives as entry.changed, which refreshes the sheet).
  const running = useMemo<TimeEntry | null>(() => {
    const a = app.running;
    const b = ts?.running;
    if (!a) return null;
    if (b && b.id === a.id && Date.parse(b.updated_at) > Date.parse(a.updated_at)) return b;
    return a;
  }, [app.running, ts?.running]);

  const now = useNow(!!running);
  const today = dayIn(now, tz);
  const days = ts?.days ?? [];
  const isCurrent = days.includes(today);

  // Counting up: the sheet was computed at ts.now; a running entry has run on since.
  const live = useMemo(() => {
    const base = { rows: ts?.rows ?? [], dayTotals: ts?.day_totals ?? [0, 0, 0, 0, 0, 0, 0], total: ts?.total_s ?? 0, billable: ts?.billable_s ?? 0 };
    const r = ts?.running;
    if (!ts || !r || !running || r.id !== running.id) return base;
    const extra = Math.max(0, Math.floor((now - Date.parse(ts.now)) / 1000));
    const i = days.indexOf(today);
    if (!extra || i < 0) return base;
    const k = rowKey(r);
    return {
      rows: base.rows.map((row) =>
        rowKey(row) === k ? { ...row, seconds: (row.seconds ?? []).map((s, j) => (j === i ? s + extra : s)), total_s: row.total_s + extra } : row,
      ),
      dayTotals: base.dayTotals.map((s, j) => (j === i ? s + extra : s)),
      total: base.total + extra,
      billable: base.billable + (r.billable ? extra : 0),
    };
  }, [ts, running, now, days, today]);

  const groups = useMemo<DayGroup[]>(() => {
    const by = new Map<string, TimeEntry[]>();
    const list = [...(ts?.entries ?? [])].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
    for (const e of list) {
      const d = dayIn(e.started_at, tz);
      by.set(d, [...(by.get(d) ?? []), e]);
    }
    return [...by.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, entries]) => {
        const i = days.indexOf(day);
        const total = i >= 0 ? (live.dayTotals[i] ?? 0) : entries.reduce((s, e) => s + (e.duration_s ?? 0), 0);
        return { day, total, entries };
      });
  }, [ts?.entries, tz, days, live.dayTotals]);
  const flat = useMemo(() => groups.flatMap((g) => g.entries), [groups]);

  // ── selection, editing, dialogs ──
  const [focusId, setFocusId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [log, setLog] = useState<{ open: boolean; preset: LogPreset }>({ open: false, preset: {} });
  useEffect(() => {
    if (focusId && !flat.some((e) => e.id === focusId)) setFocusId(null);
    if (editingId && !flat.some((e) => e.id === editingId)) setEditingId(null);
  }, [flat, focusId, editingId]);
  useEffect(() => {
    if (focusId) document.querySelector(`[data-entry="${focusId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focusId]);

  const openLog = (preset: LogPreset = {}) => setLog({ open: true, preset });
  const askDelete = (e: TimeEntry) => {
    if (e.locked) return void toast.error(t("time.locked"));
    const running = !e.ended_at;
    setConfirm({
      title: running ? t("time.discardTitle") : t("time.deleteTitle"),
      body: running ? t("time.discardBody") : t("time.deleteBody", { what: entryTitle(e) || t("time.noDescription"), time: hm(e.duration_s ?? 0, "0:00") }),
      action: running ? t("time.discard") : t("common.delete"),
      run: () =>
        writes.remove.mutate(e.id, {
          onSuccess: () => toast.success(running ? t("time.discarded") : t("time.deleted")),
          onError: (err) => toast.error(errorText(err, t("common.error"))),
        }),
    });
  };
  const doContinue = (e: TimeEntry) => {
    if (!e.ended_at) return;
    writes.start.mutate(continueInput(e), {
      onSuccess: () => toast.success(t("time.continued", { what: entryTitle(e) || t("time.noDescription") })),
      onError: (err) => toast.error(errorText(err, t("common.error"))),
    });
  };

  // ── keyboard ──
  const quiet = !log.open && !confirm;
  const keys = quiet && !editingId;
  const move = (d: 1 | -1) => {
    if (!flat.length) return;
    const i = flat.findIndex((e) => e.id === focusId);
    const next = i < 0 ? (d === 1 ? 0 : flat.length - 1) : Math.min(flat.length - 1, Math.max(0, i + d));
    setFocusId(flat[next]!.id);
  };
  const focused = flat.find((e) => e.id === focusId) ?? null;
  useHotkey(["j", "arrowdown"], () => move(1), { enabled: keys });
  useHotkey(["k", "arrowup"], () => move(-1), { enabled: keys });
  useHotkey("enter", () => focused && !focused.locked && setEditingId(focused.id), { enabled: keys && !!focused });
  useHotkey(["backspace", "delete"], () => focused && askDelete(focused), { enabled: keys && !!focused });
  useHotkey("s", () => focused && doContinue(focused), { enabled: keys && !!focused });
  useHotkey("l", () => openLog(), { enabled: keys });
  useHotkey("[", () => days[0] && setWeek(addDays(days[0], -7)), { enabled: keys && !!days.length });
  useHotkey("]", () => days[0] && setWeek(addDays(days[0], 7)), { enabled: keys && !!days.length });
  useHotkey("t", () => setWeek(undefined), { enabled: keys });
  useHotkey("esc", () => setFocusId(null), { enabled: keys && !!focusId });

  // ── header ──
  const rangeLabel = days.length
    ? `${date(dayDate(days[0]!), { day: "numeric", month: "short", timeZone: "UTC", numberingSystem: "latn" })} – ${date(dayDate(days[6]!), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC", numberingSystem: "latn" })}`
    : "";
  const weekName = !days.length ? "" : isCurrent ? t("time.thisWeek") : days.includes(addDays(today, -7)) ? t("time.lastWeek") : "";
  const navBtn = "flex size-7 items-center justify-center rounded-md text-grid-muted hover:bg-grid-soft hover:text-grid-fg disabled:opacity-40";

  const header = (
    <ViewHeader
      title={t("nav.time")}
      icon={<ClockIcon className="size-4 text-grid-muted" />}
      actions={
        <Button size="sm" onClick={() => openLog()} className="h-7 gap-1.5 text-[13.5px]" data-time-log>
          <PlusIcon />
          {t("time.logTime")}
          <Kbd combo="l" className="border-primary-foreground/30 bg-transparent text-primary-foreground/80" />
        </Button>
      }
    >
      <div className="ms-3 flex items-center gap-0.5" data-week-nav>
        <button type="button" className={navBtn} onClick={() => days[0] && setWeek(addDays(days[0], -7))} title={`${t("time.prevWeek")} ([)`} aria-label={t("time.prevWeek")} data-week-prev>
          <ChevronLeftIcon className="size-4 rtl:rotate-180" />
        </button>
        <button type="button" className={navBtn} onClick={() => days[0] && setWeek(addDays(days[0], 7))} title={`${t("time.nextWeek")} (])`} aria-label={t("time.nextWeek")} data-week-next>
          <ChevronRightIcon className="size-4 rtl:rotate-180" />
        </button>
        <span className="ms-1.5 flex items-baseline gap-2 truncate text-[13.5px]" data-week-label>
          {weekName ? <span className="font-medium text-grid-fg">{weekName}</span> : null}
          <span className={cn(weekName ? "text-grid-muted" : "font-medium text-grid-fg")}>{rangeLabel}</span>
        </span>
        {sheet.isFetching && sheet.isPlaceholderData ? <Spinner className="ms-2" /> : null}
        {!isCurrent && days.length ? (
          <Button size="xs" variant="outline" className="ms-2 h-6 text-[13px]" onClick={() => setWeek(undefined)} data-week-today>
            {t("time.today")}
            <Kbd combo="t" className="h-4 border-transparent bg-transparent" />
          </Button>
        ) : null}
      </div>
    </ViewHeader>
  );

  if (sheet.isError && !ts)
    return (
      <>
        {header}
        <ErrorState error={sheet.error} onRetry={() => void sheet.refetch()} />
      </>
    );

  const todayIdx = days.indexOf(today);
  const tracked = live.dayTotals.filter((s) => s > 0).length;
  const stats: Stat[] = [
    isCurrent
      ? { key: "today", label: t("time.today"), seconds: live.dayTotals[todayIdx] ?? 0, accent: true }
      : { key: "avg", label: t("time.perDay"), seconds: tracked ? live.total / tracked : 0, hint: t("time.daysTracked", { n: tracked }) },
    { key: "week", label: isCurrent ? t("time.thisWeek") : t("time.week"), seconds: live.total, accent: true },
    { key: "billable", label: t("time.billable"), seconds: live.billable, hint: live.total ? `${Math.round((live.billable / live.total) * 100)}%` : undefined },
  ];
  if (ts && ts.rounding_minutes > 0 && ts.rounded_total_s !== ts.total_s)
    stats.push({ key: "rounded", label: t("time.rounded"), seconds: ts.rounded_total_s, hint: t("time.roundedTo", { n: ts.rounding_minutes }) });

  return (
    <>
      {header}
      <TimerBar running={running} tz={tz} onDiscard={askDelete} />
      {!ts ? (
        <RowsSkeleton rows={10} />
      ) : (
        <div className={cn("min-h-0 flex-1 overflow-y-auto transition-opacity", sheet.isPlaceholderData && "opacity-60")} data-time-body data-week-start={days[0]}>
          <Summary stats={stats} />

          <SectionTitle label={t("time.timesheet")} right={tz !== localTz() ? <span className="text-[12px] text-grid-muted">{tz}</span> : null} />
          <WeekGrid
            days={days}
            rows={live.rows}
            dayTotals={live.dayTotals}
            total={live.total}
            today={today}
            runningKey={running && ts.running?.id === running.id ? rowKey(running) : null}
            onCell={(day, row) =>
              openLog({
                date: day > today ? today : day,
                target: row ? { project: row.project_id, task: row.task_id ? { id: row.task_id, key: row.task_key ?? "", title: row.task_title ?? "" } : null } : undefined,
              })
            }
          />

          <SectionTitle
            label={t("time.entries")}
            right={
              flat.length ? (
                <span className="hidden items-center gap-1.5 text-[12px] text-grid-muted md:flex">
                  <Kbd combo="j" />
                  <Kbd combo="k" />
                  {t("time.hintMove")}
                  <Kbd combo="enter" className="ms-2" />
                  {t("common.edit")}
                  <Kbd combo="s" className="ms-2" />
                  {t("time.continue")}
                </span>
              ) : null
            }
          />
          {groups.length ? (
            <EntryList
              groups={groups}
              tz={tz}
              today={today}
              now={now}
              focusId={focusId}
              editingId={editingId}
              onFocus={setFocusId}
              onEdit={setEditingId}
              onDelete={askDelete}
              onContinue={doContinue}
            />
          ) : (
            <div className="border-b border-line">
              <EmptyState
                icon={<ClockIcon />}
                title={isCurrent ? t("time.emptyWeek") : t("time.emptyPast")}
                body={isCurrent ? t("time.emptyWeekBody") : undefined}
                action={
                  <Button size="sm" variant="outline" onClick={() => openLog()} className="gap-1.5">
                    <PlusIcon />
                    {t("time.logTime")}
                  </Button>
                }
              />
            </div>
          )}
          <div className="grid-hatch h-16 opacity-60" aria-hidden />
        </div>
      )}
      <LogTime open={log.open} onOpenChange={(open) => setLog((l) => ({ ...l, open }))} preset={log.preset} today={today} />
      <Confirm request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

function SectionTitle({ label, right }: { label: string; right?: ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-2 border-b border-line bg-background ps-4 pe-4">
      <span className="grid-micro">{label}</span>
      <span className="flex-1" />
      {right}
    </div>
  );
}
