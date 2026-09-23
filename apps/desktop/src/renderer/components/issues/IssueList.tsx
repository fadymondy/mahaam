// The issue list every view uses (My issues, a project's List): 36px rows under sticky, collapsible
// group headers. Keyboard-first — J/K or ↑/↓ move the focus, ↵ opens, S/P/A/L open that row's
// status, priority, assignee and label menus, T starts a timer, ⌘⇧C copies the key, ⌘⌫ deletes.
// Hovering moves the focus too, so the keyboard carries on from wherever the pointer is.
import { ChevronDownIcon, GitBranchIcon, PlusIcon, UserIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

import type { Label, Member, Project, Status, Task } from "../../../shared/types";
import { AvatarStack, LtrText, PriorityIcon, ProjectMark, StatusIcon } from "@/components/kit";
import { AssigneePicker, LabelPicker, PriorityPicker, StatusPicker } from "@/components/pickers";
import { useLabels, useMembers, useProjectMap } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { useRouter } from "@/lib/router";
import { useShell } from "@/lib/shell";
import { cn } from "@/lib/utils";
import { openCreateIn } from "@/shell/CreateIssue";

import { DueDate, LabelChips } from "./controls";
import { useIssueActions, type IssueActions } from "./data";
import { IssueContextArea, useIssueTimer } from "./IssueContext";
import { pointerMoved, revealFocused, useKeys } from "./util";

export interface IssueGroup {
  id: string;
  title: string;
  icon?: ReactNode;
  tasks: Task[];
  /** The group's "+" opens quick create here. */
  add?: { projectId: string; statusId?: string | null };
}

export type RowMenu = "status" | "priority" | "assignee" | "label";

const ICON_BTN = "flex size-6 shrink-0 items-center justify-center rounded-[5px] text-grid-muted outline-none hover:bg-grid-soft focus-visible:ring-1 focus-visible:ring-grid-action";

export function IssueList({
  groups,
  storageKey,
  statusOf,
  statusesFor,
  showProject = false,
  hideEmptyGroups = false,
  empty,
}: {
  groups: IssueGroup[];
  /** Where the collapsed groups are remembered (localStorage). */
  storageKey: string;
  statusOf: (t: Task) => Status | undefined;
  statusesFor: (t: Task) => Status[];
  showProject?: "chip" | "mark" | false;
  hideEmptyGroups?: boolean;
  empty?: ReactNode;
}) {
  const { navigate } = useRouter();
  const shell = useShell();
  const members = useMembers().data ?? [];
  const labelList = useLabels().data ?? [];
  const projects = useProjectMap();
  const actions = useIssueActions();
  const timer = useIssueTimer();

  const memberMap = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);
  const labelMap = useMemo(() => new Map(labelList.map((l) => [l.id, l])), [labelList]);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const toggleGroup = useCallback(
    (id: string) =>
      setCollapsed((c) => {
        const n = new Set(c);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        localStorage.setItem(storageKey, JSON.stringify([...n]));
        return n;
      }),
    [storageKey],
  );

  const shown = useMemo(() => (hideEmptyGroups ? groups.filter((g) => g.tasks.length) : groups), [groups, hideEmptyGroups]);
  const flat = useMemo(() => shown.flatMap((g) => (collapsed.has(g.id) ? [] : g.tasks)), [shown, collapsed]);
  const byId = useMemo(() => new Map(groups.flatMap((g) => g.tasks.map((x) => [x.id, x] as const))), [groups]);

  const [focusId, setFocusId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; kind: RowMenu } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const keyboard = useRef(false);

  const focused = focusId ? flat.find((x) => x.id === focusId) : undefined;
  useEffect(() => {
    if (keyboard.current && focusId) revealFocused(scroller.current, `[data-task-id="${focusId}"]`);
    keyboard.current = false;
  }, [focusId]);
  // When the focused row leaves the list (moved to Done under "Active", deleted, filtered out), the
  // focus stays where it was: on the row that took its place, so triage can carry on with J/K.
  const lastIndex = useRef(-1);
  useEffect(() => {
    if (!focusId) return;
    const i = flat.findIndex((x) => x.id === focusId);
    if (i >= 0) lastIndex.current = i;
    else if (lastIndex.current >= 0 && flat.length) setFocusId(flat[Math.min(lastIndex.current, flat.length - 1)]!.id);
    else setFocusId(null);
  }, [flat, focusId]);

  const step = (d: number) => {
    if (!flat.length) return;
    keyboard.current = true;
    const i = focused ? flat.findIndex((x) => x.id === focused.id) : -1;
    const next = i < 0 ? (d > 0 ? 0 : flat.length - 1) : Math.min(flat.length - 1, Math.max(0, i + d));
    setFocusId(flat[next]!.id);
  };
  const open = useCallback((task: Task) => navigate({ name: "issue", key: task.key }), [navigate]);
  const withFocused = (fn: (t: Task) => void) => () => {
    if (focused) fn(focused);
    else step(1);
  };

  useKeys({
    j: () => step(1),
    arrowdown: () => step(1),
    k: () => step(-1),
    arrowup: () => step(-1),
    enter: withFocused(open),
    o: withFocused(open),
    s: withFocused((x) => setMenu({ id: x.id, kind: "status" })),
    p: withFocused((x) => setMenu({ id: x.id, kind: "priority" })),
    a: withFocused((x) => setMenu({ id: x.id, kind: "assignee" })),
    l: withFocused((x) => setMenu({ id: x.id, kind: "label" })),
    t: withFocused((x) => void timer.start(x)),
    "mod+shift+c": withFocused((x) => void actions.copyKey(x)),
    "mod+backspace": withFocused((x) => setConfirmDelete(x)),
    escape: () => setFocusId(null),
  });

  const onHover = useCallback((id: string) => setFocusId((cur) => (cur === id ? cur : id)), []);
  const onMenu = useCallback((id: string, kind: RowMenu | null) => {
    setFocusId(id);
    setMenu(kind ? { id, kind } : null);
  }, []);

  if (!flat.length && shown.every((g) => !g.tasks.length) && empty) return <>{empty}</>;

  return (
    <IssueContextArea
      resolve={(id) => byId.get(id)}
      statusesFor={statusesFor}
      members={members}
      labels={labelList}
      actions={actions}
      onTarget={(x) => setFocusId(x.id)}
      confirmDelete={confirmDelete}
      onConfirmDelete={setConfirmDelete}
      className="@container min-h-0 flex-1 overflow-y-auto outline-none"
      data-issue-list={storageKey}
    >
      <div ref={scroller} className="flex min-h-full flex-col pb-10" role="grid">
        {shown.map((g) => {
          const isCollapsed = collapsed.has(g.id);
          return (
            <section key={g.id} data-group={g.id} aria-label={g.title}>
              <GroupHeader group={g} collapsed={isCollapsed} onToggle={() => toggleGroup(g.id)} onAdd={g.add ? () => openCreateIn(shell.openCreate, g.add!.projectId, g.add!.statusId) : undefined} />
              {isCollapsed
                ? null
                : g.tasks.map((task) => (
                    <IssueRow
                      key={task.id}
                      task={task}
                      status={statusOf(task)}
                      statuses={statusesFor(task)}
                      project={showProject ? projects.get(task.project_id) : undefined}
                      projectStyle={showProject || undefined}
                      focused={focusId === task.id}
                      menu={menu?.id === task.id ? menu.kind : null}
                      members={members}
                      memberMap={memberMap}
                      labels={labelList}
                      labelMap={labelMap}
                      actions={actions}
                      onOpen={open}
                      onHover={onHover}
                      onMenu={onMenu}
                    />
                  ))}
            </section>
          );
        })}
      </div>
    </IssueContextArea>
  );
}

function GroupHeader({ group, collapsed, onToggle, onAdd }: { group: IssueGroup; collapsed: boolean; onToggle: () => void; onAdd?: () => void }) {
  const { t, number } = useI18n();
  return (
    <div
      className="group/header sticky top-0 z-[2] flex h-9 items-center gap-2 border-b border-line bg-grid-card ps-2 pe-3"
      onClick={onToggle}
      data-group-header={group.id}
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-label={group.title}
        className="flex size-5 items-center justify-center rounded text-grid-muted hover:bg-grid-soft hover:text-grid-fg"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <ChevronDownIcon className={cn("size-3.5 transition-transform duration-150", collapsed && "-rotate-90 rtl:rotate-90")} />
      </button>
      {group.icon}
      <span className="truncate text-[13.5px] font-medium text-grid-fg">{group.title}</span>
      <span className="text-[13px] text-grid-muted tabular-nums">{number(group.tasks.length)}</span>
      <span className="flex-1" />
      {onAdd ? (
        <button
          type="button"
          title={t("issues.addHere")}
          aria-label={t("issues.addHere")}
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
          className="flex size-6 items-center justify-center rounded-md text-grid-muted opacity-60 group-hover/header:opacity-100 hover:bg-grid-soft hover:text-grid-fg"
          data-group-add={group.id}
        >
          <PlusIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

interface RowProps {
  task: Task;
  status: Status | undefined;
  statuses: Status[];
  project?: Project;
  projectStyle?: "chip" | "mark";
  focused: boolean;
  menu: RowMenu | null;
  members: Member[];
  memberMap: Map<string, Member>;
  labels: Label[];
  labelMap: Map<string, Label>;
  actions: IssueActions;
  onOpen: (t: Task) => void;
  onHover: (id: string) => void;
  onMenu: (id: string, kind: RowMenu | null) => void;
}

const IssueRow = memo(function IssueRow({ task, status, statuses, project, projectStyle, focused, menu, members, memberMap, labels, labelMap, actions, onOpen, onHover, onMenu }: RowProps) {
  const { t, relative, date } = useI18n();
  const done = status?.category === "done";
  const people = (task.assignee_ids ?? []).map((id) => ({ id, email: memberMap.get(id)?.email ?? "?" }));
  const close = (o: boolean) => (o ? null : onMenu(task.id, null));
  const opener = (kind: RowMenu) => (e: MouseEvent) => {
    e.stopPropagation();
    onMenu(task.id, kind);
  };

  return (
    <div
      role="row"
      data-task-id={task.id}
      data-issue-row={task.key}
      data-focused={focused || undefined}
      aria-selected={focused}
      onClick={() => onOpen(task)}
      onMouseMove={(e) => pointerMoved(e) && !focused && onHover(task.id)}
      className={cn(
        "relative flex h-9 items-center gap-2 border-b border-line/50 ps-3 pe-4 text-[14px]",
        focused && "bg-grid-soft/70 before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-grid-action",
      )}
    >
      {menu === "priority" ? (
        <PriorityPicker value={task.priority} onChange={(p) => void actions.setPriority(task, p as Task["priority"])} compact open onOpenChange={close} triggerClassName={ICON_BTN} />
      ) : (
        <button type="button" className={ICON_BTN} onClick={opener("priority")} aria-label={t("issue.priority")} title={t(`priority.${task.priority}`)}>
          <PriorityIcon priority={task.priority} />
        </button>
      )}
      {projectStyle === "mark" && project ? (
        <span title={project.name} className="flex shrink-0">
          <ProjectMark name={project.name} color={project.color} size={14} />
        </span>
      ) : null}
      <LtrText className="w-[52px] shrink-0 truncate font-mono text-[12.5px] text-grid-muted">{task.key}</LtrText>
      {menu === "status" ? (
        <StatusPicker
          statuses={statuses}
          value={task.status_id}
          onChange={(id) => {
            const s = statuses.find((x) => x.id === id);
            if (s) void actions.setStatus(task, s);
          }}
          compact
          open
          onOpenChange={close}
          triggerClassName={ICON_BTN}
        />
      ) : (
        <button type="button" className={ICON_BTN} onClick={opener("status")} aria-label={t("issue.status")} title={status?.name} data-row-status={status?.name}>
          <StatusIcon status={status} />
        </button>
      )}
      <span className={cn("min-w-0 flex-1 truncate", done ? "text-grid-muted" : "text-grid-fg")} dir="auto" data-row-title>
        {task.title}
      </span>
      {task.subtask_count > 0 ? (
        <span className="hidden shrink-0 items-center gap-1 text-[12px] text-grid-muted @xl:flex" title={t("issue.subtasks")}>
          <GitBranchIcon className="size-3" />
          <LtrText className="tabular-nums">
            {task.subtask_done}/{task.subtask_count}
          </LtrText>
        </span>
      ) : null}
      {menu === "label" ? (
        <LabelPicker
          labels={labels}
          value={task.label_ids ?? []}
          onToggle={(id) => void actions.toggleLabel(task, id)}
          open
          onOpenChange={close}
          align="end"
          triggerClassName="flex h-6 items-center rounded-md"
          trigger={<LabelChips ids={task.label_ids} labels={labelMap} />}
        />
      ) : (
        <LabelChips ids={task.label_ids} labels={labelMap} className="hidden @2xl:flex" />
      )}
      {projectStyle === "chip" && project ? (
        <span className="hidden h-5 max-w-36 shrink-0 items-center gap-1.5 rounded-full border border-line ps-1 pe-2 text-[12px] text-grid-body @2xl:inline-flex" title={project.name}>
          <ProjectMark name={project.name} color={project.color} size={12} />
          <span className="truncate">{project.name}</span>
        </span>
      ) : null}
      <DueDate due={task.due_at} done={done} className="hidden @lg:inline-flex" />
      {menu === "assignee" ? (
        <AssigneePicker
          members={members}
          value={task.assignee_ids ?? []}
          onToggle={(id) => void actions.toggleAssignee(task, id)}
          open
          onOpenChange={close}
          align="end"
          triggerClassName="flex h-6 min-w-6 items-center justify-center rounded-[5px] px-0.5 hover:bg-grid-soft"
          trigger={people.length ? <AvatarStack people={people} size={18} max={2} /> : <UserIcon className="size-3.5 text-grid-muted" />}
        />
      ) : (
        <button
          type="button"
          onClick={opener("assignee")}
          aria-label={t("issue.assignees")}
          title={people.map((p) => p.email).join(", ") || t("issue.unassigned")}
          className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-[5px] px-0.5 hover:bg-grid-soft"
        >
          {people.length ? <AvatarStack people={people} size={18} max={2} /> : <UserIcon className="size-3.5 text-grid-muted/70" />}
        </button>
      )}
      <time
        dateTime={task.updated_at}
        title={date(task.updated_at, { dateStyle: "medium", timeStyle: "short" })}
        className="hidden w-[68px] shrink-0 truncate text-end text-[12.5px] text-grid-muted @3xl:block"
      >
        {relative(task.updated_at)}
      </time>
    </div>
  );
});
