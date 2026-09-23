// The running timer at the foot of the sidebar, and the "start a timer on…" palette (⌘⇧T, the
// menu bar's Start Timer, T on an issue): what you did recently, your issues, your projects. The
// main process owns the timer; this shows it and asks for changes. The clock is recomputed from
// started_at every second — the server owns the time.
import { useQuery } from "@tanstack/react-query";
import { HistoryIcon, PlayIcon, SquareIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { StartInput, TimeEntry } from "../../shared/types";
import { ColorDot, Kbd, LtrText, ProjectMark } from "@/components/kit";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useProjectMap, useProjects, useUserId } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { cn } from "@/lib/utils";

// cmdk sets data-selected="true" or "false" on every item, and the shared CommandItem styles the
// attribute's mere presence, so without this every row of the palette looks highlighted.
const ITEM = "data-[selected=false]:bg-transparent!";

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function useNow(enabled: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [enabled, ms]);
  return now;
}

/** Start/stop, shared by the pill, the palette and the issue views. */
export function useTimer() {
  const { running } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return {
    running,
    busy,
    start: (input: StartInput) => run(() => api.start(input)),
    stop: () => run(() => api.stop()),
  };
}

export function TimerPill() {
  const { t } = useI18n();
  const { running, busy, stop } = useTimer();
  const now = useNow(!!running);
  if (!running) {
    return (
      <div className="border-t border-line p-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("mahaam:timer-palette"))}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13.5px] text-grid-muted hover:bg-grid-soft hover:text-grid-fg"
          data-timer-start
        >
          <PlayIcon className="size-3.5" />
          <span className="flex-1 text-start">{t("timer.start")}</span>
          <Kbd combo="mod+shift+t" />
        </button>
      </div>
    );
  }
  const label = running.description || running.task_title || running.project_name || t("timer.untitled");
  const where = [running.task_key, running.project_name].filter(Boolean).join(" · ");
  const secs = (now - Date.parse(running.started_at)) / 1000;
  return (
    <div className="border-t border-line p-2" data-timer-running={running.id}>
      <div className="flex items-center gap-2 rounded-md bg-grid-soft px-2 py-1.5">
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-grid-action opacity-60 motion-reduce:animate-none" />
          <ColorDot color={running.project_color ?? "violet"} className="relative size-2" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] text-grid-fg" title={label}>
            {label}
          </p>
          {where ? <p className="truncate text-[12px] text-grid-muted">{where}</p> : null}
        </div>
        <LtrText className="font-mono text-[13px] text-grid-fg tabular-nums" >
          <span data-timer-clock>{clock(secs)}</span>
        </LtrText>
        <button
          type="button"
          onClick={() => void stop()}
          disabled={busy}
          title={t("timer.stop")}
          aria-label={t("timer.stop")}
          className="flex size-6 items-center justify-center rounded text-grid-muted hover:bg-background hover:text-grid-fg"
          data-timer-stop
        >
          <SquareIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}

/** Type what you're doing, pick one of your issues or a project (or neither), Enter starts it. */
export function TimerPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { ws } = useApp();
  const me = useUserId();
  const { start } = useTimer();
  const projects = useProjects();
  const byId = useProjectMap();
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const mine = useQuery({
    queryKey: qk.tasks(ws, { assignee: me, open: true }),
    queryFn: () => api.tasks({ assignee: me, limit: 200 }),
    enabled: open && !!ws && !!me,
  });
  // What you worked on lately, newest first, one line per distinct thing — resume it in a keystroke.
  const latest = useQuery({
    queryKey: qk.entries(ws, { recent: true, limit: 40 }),
    queryFn: () => api.entries({ limit: 40 }),
    enabled: open && !!ws,
    staleTime: 10_000,
  });
  const text = query.trim();
  const q = text.toLowerCase();
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: TimeEntry[] = [];
    for (const e of latest.data ?? []) {
      if (!e.ended_at) continue;
      const k = `${e.project_id ?? ""}|${e.task_id ?? ""}|${e.description.trim().toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const hay = [e.description, e.task_key, e.task_title, e.project_name].filter(Boolean).join(" ").toLowerCase();
      if (q && !hay.includes(q)) continue;
      out.push(e);
      if (out.length >= 5) break;
    }
    return out;
  }, [latest.data, q]);
  const tasks = useMemo(
    () =>
      (mine.data ?? [])
        .filter((x) => !x.completed_at)
        .filter((x) => !q || x.title.toLowerCase().includes(q) || x.key.toLowerCase().includes(q))
        .slice(0, 8),
    [mine.data, q],
  );
  const projs = (projects.data ?? []).filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, 6);
  const go = async (input: StartInput) => {
    onOpenChange(false);
    await start(input);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl" data-timer-palette>
        <DialogHeader className="sr-only">
          <DialogTitle>{t("timer.palette")}</DialogTitle>
          <DialogDescription>{t("timer.paletteHint")}</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false}>
          <CommandInput autoFocus placeholder={t("timer.palette")} value={query} onValueChange={setQuery} />
          <CommandList className="max-h-96">
            <CommandEmpty>{t("palette.noResults")}</CommandEmpty>
            <CommandGroup>
              <CommandItem className={ITEM} value="__free" onSelect={() => void go(text ? { description: text } : {})}>
                <PlayIcon />
                <span className="truncate">{text ? t("timer.startFree", { text }) : t("timer.startBlank")}</span>
              </CommandItem>
            </CommandGroup>
            {recent.length ? (
              <CommandGroup heading={t("timer.recent")} data-timer-recent>
                {recent.map((e) => (
                  <CommandItem className={ITEM}
                    key={e.id}
                    value={`r:${e.id}`}
                    onSelect={() =>
                      void go({
                        ...(e.task_id ? { task: e.task_id } : e.project_id ? { project: e.project_id } : {}),
                        ...(e.description ? { description: e.description } : {}),
                        billable: e.billable,
                      })
                    }
                  >
                    {e.project_id ? <ProjectMark name={e.project_name ?? "?"} color={e.project_color} size={14} /> : <HistoryIcon className="text-grid-muted" />}
                    <span className="min-w-0 truncate">{e.description || e.task_title || e.project_name || t("timer.untitled")}</span>
                    {e.task_key ? <LtrText className="shrink-0 font-mono text-[12px] text-grid-muted">{e.task_key}</LtrText> : null}
                    {e.project_name && (e.description || e.task_title) ? <span className="min-w-0 shrink truncate text-[12.5px] text-grid-muted">{e.project_name}</span> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {tasks.length ? (
              <CommandGroup heading={t("nav.myIssues")}>
                {tasks.map((task) => {
                  const p = byId.get(task.project_id);
                  return (
                    <CommandItem className={ITEM} key={task.id} value={`t:${task.id}`} onSelect={() => void go({ task: task.id, ...(text ? { description: text } : {}) })}>
                      <ProjectMark name={p?.name ?? "?"} color={p?.color} size={14} />
                      <LtrText className="font-mono text-[12px] text-grid-muted">{task.key}</LtrText>
                      <span className="truncate">{task.title}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
            {projs.length ? (
              <CommandGroup heading={t("nav.projects")}>
                {projs.map((p) => (
                  <CommandItem className={ITEM} key={p.id} value={`p:${p.id}`} onSelect={() => void go({ project: p.id, ...(text ? { description: text } : {}) })}>
                    <ProjectMark name={p.name} color={p.color} size={14} />
                    <span className={cn("truncate")}>{p.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
