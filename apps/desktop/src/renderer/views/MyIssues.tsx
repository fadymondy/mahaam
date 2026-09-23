// My issues: everything assigned to me across projects. Active / Backlog / Done, grouped by
// workflow stage (the same stages every project's columns map to) or by project.
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CircleDotIcon, SlidersHorizontalIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { Status, Task } from "../../shared/types";
import { EmptyState, ErrorState, Kbd, ProjectMark, RowsSkeleton, StatusIcon, ViewHeader } from "@/components/kit";
import { HEADER_BTN, Segmented } from "@/components/issues/controls";
import { useStatuses } from "@/components/issues/data";
import { IssueList, type IssueGroup } from "@/components/issues/IssueList";
import { byPriorityThenUpdated } from "@/components/issues/util";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useProjectMap, useUserId } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";

type Filter = "active" | "backlog" | "done";
type Grouping = "status" | "project";

const FILTER_KEY = "mahaam.myIssues.filter";
const GROUP_KEY = "mahaam.myIssues.group";

/** Stages in the order work moves up the list: what's in flight first. */
const STAGES = ["in_progress", "waiting_approval", "in_review", "todo", "backlog", "done", "canceled"] as const;

function stageOf(s: Status | undefined): string {
  if (!s) return "todo";
  if (s.stage === "cancelled") return "canceled";
  if ((STAGES as readonly string[]).includes(s.stage)) return s.stage;
  return s.category === "done" ? "done" : s.category === "doing" ? "in_progress" : "todo";
}

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = localStorage.getItem(key) as T | null;
  return v && allowed.includes(v) ? v : fallback;
}

export function MyIssuesView() {
  const { t } = useI18n();
  const { ws } = useApp();
  const me = useUserId();
  const projects = useProjectMap();
  const [filter, setFilterState] = useState<Filter>(() => stored(FILTER_KEY, ["active", "backlog", "done"], "active"));
  const [grouping, setGroupingState] = useState<Grouping>(() => stored(GROUP_KEY, ["status", "project"], "status"));
  const setFilter = (f: Filter) => {
    localStorage.setItem(FILTER_KEY, f);
    setFilterState(f);
  };
  const setGrouping = (g: Grouping) => {
    localStorage.setItem(GROUP_KEY, g);
    setGroupingState(g);
  };

  const q = useQuery({ queryKey: qk.tasks(ws, { assignee: me, limit: 500 }), queryFn: () => api.tasks({ assignee: me, limit: 500 }), enabled: !!ws && !!me });
  // Assigned tasks can be dropped from the list by a change elsewhere (unassigned, deleted):
  // the list is what the server says, the optimistic engine only patches it in place.
  const tasks = useMemo(() => (q.data ?? []).filter((x) => x.assignee_ids?.includes(me)), [q.data, me]);
  const statuses = useStatuses(tasks.map((x) => x.project_id));

  const statusOf = (x: Task) => statuses.byId.get(x.status_id);
  const statusesFor = (x: Task) => statuses.byProject.get(x.project_id) ?? [];

  const buckets = useMemo(() => {
    const out: Record<Filter, Task[]> = { active: [], backlog: [], done: [] };
    for (const x of tasks) {
      const s = statuses.byId.get(x.status_id);
      const done = s ? s.category === "done" : !!x.completed_at;
      if (done) out.done.push(x);
      else {
        out.active.push(x);
        if (s?.stage === "backlog") out.backlog.push(x);
      }
    }
    return out;
  }, [tasks, statuses.byId]);

  const groups = useMemo<IssueGroup[]>(() => {
    const list = buckets[filter];
    if (grouping === "project") {
      const by = new Map<string, Task[]>();
      for (const x of list) by.set(x.project_id, [...(by.get(x.project_id) ?? []), x]);
      return [...by.entries()]
        .map(([pid, items]) => {
          const p = projects.get(pid);
          const pos = (x: Task) => statuses.byId.get(x.status_id)?.position ?? 0;
          return {
            id: `p:${pid}`,
            title: p?.name ?? "…",
            icon: <ProjectMark name={p?.name ?? "?"} color={p?.color} size={14} />,
            tasks: items.sort((a, b) => pos(a) - pos(b) || byPriorityThenUpdated(a, b)),
            add: { projectId: pid },
          };
        })
        .sort((a, b) => a.title.localeCompare(b.title));
    }
    const by = new Map<string, { status: Status | undefined; tasks: Task[] }>();
    for (const x of list) {
      const s = statuses.byId.get(x.status_id);
      const k = stageOf(s);
      const g = by.get(k) ?? { status: s, tasks: [] };
      g.tasks.push(x);
      by.set(k, g);
    }
    return STAGES.filter((k) => by.has(k)).map((k) => {
      const g = by.get(k)!;
      return {
        id: `s:${k}`,
        title: t(`issues.stage.${k}`),
        icon: <StatusIcon status={g.status ?? { category: k === "done" ? "done" : "todo", stage: k, color: "slate" }} />,
        tasks: g.tasks.sort(byPriorityThenUpdated),
      };
    });
  }, [buckets, filter, grouping, projects, statuses.byId, t]);

  const loading = q.isPending || (tasks.length > 0 && statuses.loading && statuses.byId.size === 0);

  return (
    <>
      <ViewHeader
        title={t("nav.myIssues")}
        icon={<CircleDotIcon className="size-3.5 text-grid-muted" />}
        actions={<DisplayMenu grouping={grouping} onGrouping={setGrouping} />}
      >
        <Segmented
          label={t("issues.filter")}
          value={filter}
          onChange={setFilter}
          className="ms-2"
          options={[
            { value: "active", label: t("issues.filter.active"), count: q.data ? buckets.active.length : undefined },
            { value: "backlog", label: t("issues.filter.backlog"), count: q.data ? buckets.backlog.length : undefined },
            { value: "done", label: t("issues.filter.done"), count: q.data ? buckets.done.length : undefined },
          ]}
        />
      </ViewHeader>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : loading ? (
        <RowsSkeleton rows={10} />
      ) : (
        <IssueList
          key={grouping}
          groups={groups}
          storageKey={`mahaam.myIssues.collapsed.${grouping}`}
          statusOf={statusOf}
          statusesFor={statusesFor}
          showProject={grouping === "project" ? false : "chip"}
          hideEmptyGroups
          empty={
            <EmptyState
              icon={<CircleDotIcon />}
              title={t(`issues.empty.${filter}`)}
              body={t(`issues.empty.${filter}Body`)}
              action={
                <p className="flex items-center gap-1.5 text-[12px] text-grid-muted">
                  {t("issues.empty.create")} <Kbd combo="c" />
                </p>
              }
            />
          }
        />
      )}
    </>
  );
}

function DisplayMenu({ grouping, onGrouping }: { grouping: Grouping; onGrouping: (g: Grouping) => void }) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" className={HEADER_BTN} data-action="display" />}>
        <SlidersHorizontalIcon />
        {t("issues.display")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11.5px]">{t("issues.groupBy")}</DropdownMenuLabel>
          {(["status", "project"] as const).map((g) => (
            <DropdownMenuItem key={g} onClick={() => onGrouping(g)} className="gap-2 text-[12.5px]" data-grouping={g}>
              <span className="flex-1">{t(`issues.groupBy.${g}`)}</span>
              {grouping === g ? <CheckIcon className="size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

