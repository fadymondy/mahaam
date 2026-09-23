// What time is for: a project, or one of its issues (which implies the project), or neither. One
// field that searches both — your open issues when empty, every issue matching what you type.
import { useQuery } from "@tanstack/react-query";
import { FolderIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { LtrText, ProjectMark } from "@/components/kit";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useProjectMap, useProjects, useUserId } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { cn } from "@/lib/utils";

export interface Target {
  project: string | null;
  task: { id: string; key: string; title: string } | null;
}

export const NO_TARGET: Target = { project: null, task: null };

export const sameTarget = (a: Target, b: Target) => a.project === b.project && (a.task?.id ?? null) === (b.task?.id ?? null);

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

export function TargetPicker({
  value,
  onChange,
  className,
  disabled,
  variant = "pill",
}: {
  value: Target;
  onChange: (t: Target) => void;
  className?: string;
  disabled?: boolean;
  /** "pill" is a bordered control; "ghost" sits in a row with no frame until hovered. */
  variant?: "pill" | "ghost";
}) {
  const { t } = useI18n();
  const { ws } = useApp();
  const me = useUserId();
  const projects = useProjects();
  const byId = useProjectMap();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 150);
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const mine = useQuery({
    queryKey: qk.tasks(ws, { assignee: me, open: true }),
    queryFn: () => api.tasks({ assignee: me, limit: 200 }),
    enabled: open && !!ws && !!me,
  });
  const found = useQuery({
    queryKey: qk.tasks(ws, { q: dq, limit: 20 }),
    queryFn: () => api.tasks({ q: dq, limit: 20 }),
    enabled: open && !!ws && dq.length > 0,
  });
  const needle = q.trim().toLowerCase();
  const tasks = useMemo(() => {
    const list = needle ? (found.data ?? []) : (mine.data ?? []).filter((x) => !x.completed_at);
    return list.slice(0, 12);
  }, [needle, found.data, mine.data]);
  const projs = (projects.data ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle)).slice(0, 8);

  const cur = value.project ? byId.get(value.project) : undefined;
  const pick = (next: Target) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            data-target-picker
            className={cn(
              "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-[13.5px] text-grid-body outline-none hover:bg-grid-soft hover:text-grid-fg focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 [&_svg]:shrink-0",
              variant === "pill" && "border border-line bg-background",
              className,
            )}
          />
        }
      >
        {cur ? <ProjectMark name={cur.name} color={cur.color} id={cur.id} size={14} /> : <FolderIcon className="size-3.5 text-grid-muted" />}
        {value.task ? (
          <>
            <LtrText className="font-mono text-[12px] text-grid-muted">{value.task.key}</LtrText>
            <span className="truncate">{value.task.title}</span>
          </>
        ) : (
          <span className={cn("truncate", !cur && "text-grid-muted")}>{cur?.name ?? t("time.noProject")}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-0" data-target-menu>
        <Command shouldFilter={false} className="rounded-lg!">
          <CommandInput autoFocus placeholder={t("time.pickTarget")} value={q} onValueChange={setQ} />
          <CommandList className="max-h-80">
            <CommandEmpty className="py-4 text-[13.5px] text-grid-muted">{t("palette.noResults")}</CommandEmpty>
            {value.project || value.task ? (
              <CommandGroup>
                <CommandItem value="__none" onSelect={() => pick({ project: null, task: null })} className="text-[13.5px] text-grid-muted data-[selected=false]:bg-transparent!">
                  <XIcon className="size-3.5" />
                  {t("time.clearTarget")}
                </CommandItem>
              </CommandGroup>
            ) : null}
            {tasks.length ? (
              <CommandGroup heading={needle ? t("palette.issues") : t("nav.myIssues")}>
                {tasks.map((task) => {
                  const p = byId.get(task.project_id);
                  return (
                    <CommandItem
                      key={task.id}
                      value={`t:${task.id}`}
                      data-checked={value.task?.id === task.id}
                      onSelect={() => pick({ project: task.project_id, task: { id: task.id, key: task.key, title: task.title } })}
                      className="text-[13.5px] data-[selected=false]:bg-transparent!"
                    >
                      <ProjectMark name={p?.name ?? "?"} color={p?.color} id={p?.id} size={14} />
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
                  <CommandItem
                    key={p.id}
                    value={`p:${p.id}`}
                    data-checked={!value.task && value.project === p.id}
                    onSelect={() => pick({ project: p.id, task: null })}
                    className="text-[13.5px] data-[selected=false]:bg-transparent!"
                  >
                    <ProjectMark name={p.name} color={p.color} id={p.id} size={14} />
                    <span className="truncate">{p.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** An entry's target, as the picker holds it. */
export const targetOf = (e: { project_id: string | null; task_id: string | null; task_key: string | null; task_title: string | null }): Target => ({
  project: e.project_id,
  task: e.task_id ? { id: e.task_id, key: e.task_key ?? "", title: e.task_title ?? "" } : null,
});
