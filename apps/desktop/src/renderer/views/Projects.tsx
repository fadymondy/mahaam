// All projects as a dense table: name, client, status, progress, people and dates. J/K or ↑/↓ and
// ↵ (or a click) open one; the switch shows archived projects.
import { useQuery } from "@tanstack/react-query";
import { ArchiveIcon, LayersIcon, UsersIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Project } from "../../shared/types";
import { EmptyState, ErrorState, LtrText, ProjectMark, RowsSkeleton, ViewHeader } from "@/components/kit";
import { ProgressBar } from "@/components/issues/controls";
import { ProjectStatusChip, useDay } from "@/components/issues/ProjectAbout";
import { pointerMoved, revealFocused, useKeys } from "@/components/issues/util";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useProjects } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { useRouter } from "@/lib/router";
import { cn } from "@/lib/utils";

const ARCHIVED_KEY = "mahaam.projects.archived";

const COLS = "grid grid-cols-[minmax(0,1fr)_104px_148px] @2xl:grid-cols-[minmax(0,1fr)_140px_104px_148px_72px] @4xl:grid-cols-[minmax(0,1fr)_160px_104px_168px_72px_170px] items-center gap-4";

export function ProjectsView() {
  const { t, number } = useI18n();
  const { navigate } = useRouter();
  const [archived, setArchivedState] = useState(() => localStorage.getItem(ARCHIVED_KEY) === "1");
  const setArchived = (on: boolean) => {
    localStorage.setItem(ARCHIVED_KEY, on ? "1" : "0");
    setArchivedState(on);
  };
  const { ws } = useApp();
  const active = useProjects(false);
  const arch = useQuery({ queryKey: qk.projects(ws, true), queryFn: () => api.projects(true), enabled: !!ws && archived, staleTime: 60_000 });
  const q = archived ? arch : active;
  // The archived listing is the archived ones; with the switch on, show them after the live ones.
  const rows = useMemo<Project[]>(() => {
    const live = [...(active.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    if (!archived) return live;
    const ids = new Set(live.map((p) => p.id));
    const gone = (arch.data ?? []).filter((p) => !ids.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
    return [...live, ...gone];
  }, [active.data, arch.data, archived]);

  const [focus, setFocus] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const keyboard = useRef(false);
  useEffect(() => {
    if (keyboard.current && focus) revealFocused(scroller.current, `[data-project-row="${focus}"]`);
    keyboard.current = false;
  }, [focus]);
  const step = (d: number) => {
    if (!rows.length) return;
    keyboard.current = true;
    const i = rows.findIndex((p) => p.id === focus);
    const n = i < 0 ? (d > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, i + d));
    setFocus(rows[n]!.id);
  };
  const open = (p: Project) => navigate({ name: "project", id: p.id });
  useKeys({
    j: () => step(1),
    arrowdown: () => step(1),
    k: () => step(-1),
    arrowup: () => step(-1),
    enter: () => {
      const p = rows.find((x) => x.id === focus);
      if (p) open(p);
      else step(1);
    },
    escape: () => setFocus(null),
  });

  return (
    <>
      <ViewHeader
        title={t("nav.allProjects")}
        icon={<LayersIcon className="size-3.5 text-grid-muted" />}
        actions={
          <label className="flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-grid-muted hover:text-grid-fg" data-archived-toggle>
            <ArchiveIcon className="size-3.5" />
            {t("issues.projects.archived")}
            <Switch size="sm" checked={archived} onCheckedChange={setArchived} />
          </label>
        }
      >
        {active.data ? <span className="text-[13px] text-grid-muted tabular-nums">{number(rows.length)}</span> : null}
      </ViewHeader>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : active.isPending || (archived && arch.isPending) ? (
        <RowsSkeleton rows={6} />
      ) : !rows.length ? (
        <EmptyState icon={<LayersIcon />} title={t("issues.projects.empty")} body={t("issues.projects.emptyBody")} />
      ) : (
        <div ref={scroller} className="@container min-h-0 flex-1 overflow-y-auto" role="grid" aria-label={t("nav.allProjects")} data-projects>
          <div className={cn(COLS, "sticky top-0 z-[1] h-8 border-b border-line bg-background ps-4 pe-4 text-[12.5px] text-grid-muted")} role="row">
            <span role="columnheader">{t("issues.projects.name")}</span>
            <span role="columnheader" className="hidden @2xl:block">
              {t("issues.project.client")}
            </span>
            <span role="columnheader">{t("issues.projects.status")}</span>
            <span role="columnheader">{t("issues.project.progress")}</span>
            <span role="columnheader" className="hidden text-end @2xl:block">
              {t("issues.project.members")}
            </span>
            <span role="columnheader" className="hidden @4xl:block">
              {t("issues.projects.dates")}
            </span>
          </div>
          {rows.map((p) => (
            <ProjectRow key={p.id} project={p} focused={focus === p.id} onOpen={() => open(p)} onHover={() => focus !== p.id && setFocus(p.id)} />
          ))}
        </div>
      )}
    </>
  );
}

function ProjectRow({ project: p, focused, onOpen, onHover }: { project: Project; focused: boolean; onOpen: () => void; onHover: () => void }) {
  const { t, number } = useI18n();
  const day = useDay();
  const total = p.tasks.todo + p.tasks.doing + p.tasks.done;
  const year = new Date().getFullYear();
  const sameYear = (d: string | null) => !d || d.startsWith(String(year));
  return (
    <div
      role="row"
      data-project-row={p.id}
      data-focused={focused || undefined}
      onClick={onOpen}
      onMouseMove={(e) => pointerMoved(e) && onHover()}
      className={cn(
        COLS,
        "relative h-9 border-b border-line/50 ps-4 pe-4 text-[14px]",
        focused && "bg-grid-soft/70 before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-grid-action",
        p.archived_at && "text-grid-muted",
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5" role="gridcell">
        <ProjectMark name={p.name} color={p.color} size={18} />
        <span className={cn("truncate font-medium", p.archived_at ? "text-grid-muted" : "text-grid-fg")}>{p.name}</span>
        {p.archived_at ? <ArchiveIcon className="size-3 shrink-0 text-grid-muted" aria-label={t("issues.projects.archivedOne")} /> : null}
      </span>
      <span className="hidden truncate text-[13.5px] text-grid-body @2xl:block" role="gridcell">
        {p.client_name ?? <span className="text-grid-muted">—</span>}
      </span>
      <span role="gridcell">
        <ProjectStatusChip status={p.status} />
      </span>
      <span className="flex items-center gap-2.5" role="gridcell" title={t("issues.project.doneOf", { done: number(p.tasks.done), total: number(total) })}>
        <ProgressBar value={p.tasks.done} total={total} className="flex-1" />
        <LtrText className="w-11 shrink-0 text-end text-[12.5px] text-grid-muted tabular-nums">
          {p.tasks.done}/{total}
        </LtrText>
      </span>
      <span className="hidden items-center justify-end gap-1 text-[13px] text-grid-muted @2xl:flex" role="gridcell">
        <UsersIcon className="size-3.5" />
        <span className="tabular-nums">{number(p.member_count)}</span>
      </span>
      <span className="hidden truncate text-[13px] text-grid-muted @4xl:block" role="gridcell">
        {p.starts_on || p.ends_on ? (
          <LtrText>
            {day(p.starts_on, !sameYear(p.starts_on))} – {day(p.ends_on, !sameYear(p.ends_on))}
          </LtrText>
        ) : (
          "—"
        )}
      </span>
    </div>
  );
}
