// A project: a row of tabs under its header (Issues, Overview, Reports, GitHub, Vault, Billing,
// Settings), each its own file under views/project/. Issues is the list or board with a filter row
// and an About panel; the List/Board choice is remembered per project, and so is whether About is
// open. The tab is part of the route, so back/forward walk between tabs too.
import { useQuery } from "@tanstack/react-query";
import { KanbanIcon, ListIcon, PanelRightIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ProjectTab, Task } from "../../shared/types";
import { EmptyState, ErrorState, Kbd, ProjectMark, RowsSkeleton, StatusIcon, ViewHeader } from "@/components/kit";
import { Board } from "@/components/issues/Board";
import { HeaderButton, Segmented } from "@/components/issues/controls";
import { applyFilters, FilterBar, filtersActive, NO_FILTERS, type Filters } from "@/components/issues/FilterBar";
import { IssueList, type IssueGroup } from "@/components/issues/IssueList";
import { ProjectAbout } from "@/components/issues/ProjectAbout";
import { byPosition, sortStatuses, useKeys } from "@/components/issues/util";
import { useApp } from "@/lib/app";
import { ApiError, api } from "@/lib/bridge";
import { useBoard, useLabels, useMembers, useProjectMap } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { useRouter } from "@/lib/router";
import { useShell } from "@/lib/shell";
import { cn } from "@/lib/utils";
import { ProjectBilling } from "./project/Billing";
import { ProjectGitHub } from "./project/GitHub";
import { ProjectOverview } from "./project/Overview";
import { ProjectReports } from "./project/Reports";
import { ProjectSettings } from "./project/Settings";
import { ProjectVault } from "./project/Vault";

const TABS: ProjectTab[] = ["issues", "overview", "reports", "github", "vault", "billing", "settings"];

type Mode = "list" | "board";
const modeKey = (id: string) => `mahaam.projectView.${id}`;
const ABOUT_KEY = "mahaam.projectAbout";

export function ProjectView({ id, view, tab = "issues" }: { id: string; view?: Mode; tab?: ProjectTab }) {
  const { t } = useI18n();
  const { ws } = useApp();
  const { navigate } = useRouter();
  const shell = useShell();
  const listed = useProjectMap().get(id);
  const detail = useQuery({ queryKey: qk.project(ws, id), queryFn: () => api.project(id), enabled: !!ws, staleTime: 60_000 });
  const board = useBoard(id);
  const members = useMembers().data ?? [];
  const labels = useLabels().data ?? [];
  const memberMap = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);

  const [mode, setModeState] = useState<Mode>(() => view ?? ((localStorage.getItem(modeKey(id)) as Mode | null) === "board" ? "board" : "list"));
  useEffect(() => {
    if (view) setModeState(view);
  }, [view]);
  const setMode = (m: Mode) => {
    localStorage.setItem(modeKey(id), m);
    setModeState(m);
    navigate({ name: "project", id, view: m, tab: "issues" }, { replace: true });
  };
  const [about, setAboutState] = useState(() => localStorage.getItem(ABOUT_KEY) === "1");
  const toggleAbout = () =>
    setAboutState((a) => {
      localStorage.setItem(ABOUT_KEY, a ? "0" : "1");
      return !a;
    });
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);

  useKeys(tab === "issues" ? { "mod+i": toggleAbout, v: () => setMode(mode === "list" ? "board" : "list") } : {});

  const statuses = useMemo(() => sortStatuses(board.data?.statuses), [board.data]);
  const all = board.data?.tasks ?? [];
  const tasks = useMemo(() => applyFilters(board.data?.tasks ?? [], filters), [board.data, filters]);
  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);

  const groups = useMemo<IssueGroup[]>(
    () =>
      statuses.map((s) => ({
        id: s.id,
        title: s.name,
        icon: <StatusIcon status={s} />,
        tasks: tasks.filter((x) => x.status_id === s.id).sort(byPosition),
        add: { projectId: id, statusId: s.id },
      })),
    [statuses, tasks, id],
  );

  const project = detail.data;
  const name = project?.name ?? listed?.name ?? "";
  const color = project?.color ?? listed?.color;
  const notFound = (detail.error instanceof ApiError && detail.error.status === 404) || (board.error instanceof ApiError && board.error.status === 404);

  if (notFound) {
    return (
      <>
        <ViewHeader title={t("issues.project.notFound")} />
        <EmptyState title={t("issues.project.notFound")} body={t("issues.project.notFoundBody")} />
      </>
    );
  }

  const filtering = filtersActive(filters);
  const empty = (
    <EmptyState
      title={filtering ? t("issues.find.noMatch") : t("issues.project.empty")}
      body={filtering ? t("issues.find.noMatchBody") : t("issues.project.emptyBody")}
      action={
        filtering ? (
          <button type="button" onClick={() => setFilters(NO_FILTERS)} className="rounded-md border border-line px-3 py-1 text-[13.5px] hover:bg-grid-soft">
            {t("issues.find.clear")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => shell.openCreate(id)}
            className="flex items-center gap-2 rounded-md border border-line px-3 py-1 text-[13.5px] hover:bg-grid-soft"
          >
            {t("create.title")} <Kbd combo="c" />
          </button>
        )
      }
    />
  );

  return (
    <>
      <ViewHeader
        icon={name ? <ProjectMark name={name} color={color} size={18} id={id} /> : null}
        title={name}
        actions={
          tab !== "issues" ? null : (
          <>
            <HeaderButton icon={<PanelRightIcon className="rtl:-scale-x-100" />} label={t("issues.project.about")} showLabel={false} active={about} onClick={toggleAbout} data-action="about" />
            <button
              type="button"
              onClick={() => shell.openCreate(id)}
              className="ms-1 flex h-7 items-center gap-1.5 rounded-md bg-grid-action ps-2 pe-1.5 text-[13px] font-medium text-grid-on-action hover:opacity-90"
              data-new-issue-here
            >
              <PlusIcon className="size-3.5" />
              {t("issues.project.newIssue")}
              <Kbd combo="c" className="border-grid-on-action/30 bg-transparent text-grid-on-action/80" />
            </button>
          </>
          )
        }
      >
        {tab === "issues" ? (
        <Segmented
          label={t("issues.project.layout")}
          value={mode}
          onChange={setMode}
          className="ms-2"
          options={[
            { value: "list", label: t("issues.project.list"), icon: <ListIcon /> },
            { value: "board", label: t("issues.project.board"), icon: <KanbanIcon /> },
          ]}
        />
        ) : null}
      </ViewHeader>
      <ProjectTabs id={id} tab={tab} mode={mode} />
      {tab === "overview" ? (
        <ProjectOverview projectId={id} />
      ) : tab === "reports" ? (
        <ProjectReports projectId={id} />
      ) : tab === "github" ? (
        <ProjectGitHub projectId={id} />
      ) : tab === "vault" ? (
        <ProjectVault projectId={id} />
      ) : tab === "billing" ? (
        <ProjectBilling projectId={id} />
      ) : tab === "settings" ? (
        <ProjectSettings projectId={id} />
      ) : (
      <>
      <FilterBar value={filters} onChange={setFilters} members={members} labels={labels} shown={tasks.length} total={all.length} />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col" data-project-mode={mode}>
          {board.isError ? (
            <ErrorState error={board.error} onRetry={() => void board.refetch()} />
          ) : board.isPending ? (
            mode === "board" ? <BoardSkeleton /> : <RowsSkeleton rows={10} />
          ) : mode === "board" ? (
            tasks.length || !filtering ? <Board projectId={id} statuses={statuses} tasks={tasks} all={all} filtering={filtering} /> : empty
          ) : (
            <IssueList
              groups={groups}
              storageKey={`mahaam.project.collapsed.${id}`}
              statusOf={(x: Task) => statusById.get(x.status_id)}
              statusesFor={() => statuses}
              hideEmptyGroups={filtering}
              empty={empty}
            />
          )}
        </div>
        {about ? <ProjectAbout project={project} memberMap={memberMap} /> : null}
      </div>
      </>
      )}
    </>
  );
}

/** The project's sections, as a tab row under the header. */
function ProjectTabs({ id, tab, mode }: { id: string; tab: ProjectTab; mode: Mode }) {
  const { t } = useI18n();
  const { navigate } = useRouter();
  return (
    <nav role="tablist" aria-label={t("project.tabs")} className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-3" data-project-tabs>
      {TABS.map((x) => (
        <button
          key={x}
          type="button"
          role="tab"
          aria-selected={x === tab}
          data-project-tab={x}
          onClick={() => navigate({ name: "project", id, tab: x, ...(x === "issues" ? { view: mode } : {}) }, { replace: false })}
          className={cn(
            "-mb-px h-9 shrink-0 border-b-2 px-2.5 text-[13.5px]",
            x === tab ? "border-grid-action font-medium text-grid-fg" : "border-transparent text-grid-muted hover:text-grid-fg",
          )}
        >
          {t(`project.tab.${x}`)}
        </button>
      ))}
    </nav>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 px-4 pt-3">
      {[4, 2, 3, 1].map((n, c) => (
        <div key={c} className="flex w-[272px] shrink-0 flex-col gap-1.5">
          <div className="flex h-8 items-center gap-2 px-1.5">
            <span className="size-3.5 rounded-full bg-grid-soft" />
            <span className="h-2.5 w-20 rounded bg-grid-soft" />
          </div>
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="h-[76px] rounded-lg border border-line bg-grid-card/60" />
          ))}
        </div>
      ))}
    </div>
  );
}
