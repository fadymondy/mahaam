// A project's board: a column per status, cards in board order. Drag a card within a column or
// across columns (dnd-kit); the move is shown at once and sent as moveTask(key, status, index).
// Keyboard: arrows (or J/K) move the focus — ←/→ between columns, mirrored in RTL — ↵ opens,
// S/P/A open the card's menus, T starts a timer, ⌘⇧C copies the key.
import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GitBranchIcon, ListChecksIcon, PlusIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Label, Member, Status, Task } from "../../../shared/types";
import { AvatarStack, LtrText, PriorityIcon, StatusIcon } from "@/components/kit";
import { AssigneePicker, LabelPicker, PriorityPicker, StatusPicker } from "@/components/pickers";
import { useLabels, useMembers } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { useRouter } from "@/lib/router";
import { useShell } from "@/lib/shell";
import { cn } from "@/lib/utils";
import { openCreateIn } from "@/shell/CreateIssue";

import { DueDate, LabelChips } from "./controls";
import { useIssueActions, type IssueActions } from "./data";
import { IssueContextArea, useIssueTimer } from "./IssueContext";
import type { RowMenu } from "./IssueList";
import { between, byPosition, pointerMoved, revealFocused, useKeys } from "./util";

type Columns = Record<string, string[]>;
const COL = "col:";

/**
 * `tasks` may be a filtered subset of `all` (the whole board): a drop is placed among the whole
 * column, next to the card it landed by, and empty columns are not an invitation to add.
 */
export function Board({ projectId, statuses, tasks, all, filtering }: { projectId: string; statuses: Status[]; tasks: Task[]; all?: Task[]; filtering?: boolean }) {
  const { navigate } = useRouter();
  const { dir } = useI18n();
  const shell = useShell();
  const actions = useIssueActions();
  const timer = useIssueTimer();
  const members = useMembers().data ?? [];
  const labels = useLabels().data ?? [];
  const memberMap = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);
  const labelMap = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const byId = useMemo(() => new Map(tasks.map((x) => [x.id, x])), [tasks]);
  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);

  const derived = useMemo<Columns>(() => {
    const out: Columns = Object.fromEntries(statuses.map((s) => [s.id, [] as string[]]));
    for (const x of [...tasks].sort(byPosition)) out[x.status_id]?.push(x.id);
    return out;
  }, [statuses, tasks]);

  // While dragging (and until the drop is in the cache) the columns are ours, not the server's.
  const [drag, setDrag] = useState<{ active: string | null; columns: Columns } | null>(null);
  const columns = drag?.columns ?? derived;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const containerOf = (id: string, cols: Columns): string | undefined => (id.startsWith(COL) ? id.slice(COL.length) : Object.keys(cols).find((k) => cols[k]!.includes(id)));

  const onDragStart = (e: DragStartEvent) => setDrag({ active: String(e.active.id), columns: structuredClone(derived) });

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setDrag((d) => {
      if (!d) return d;
      const a = String(active.id);
      const o = String(over.id);
      const from = containerOf(a, d.columns);
      const to = containerOf(o, d.columns);
      if (!from || !to || from === to) return d;
      const src = d.columns[from]!.filter((x) => x !== a);
      const dst = [...d.columns[to]!];
      const at = o.startsWith(COL) ? dst.length : Math.max(0, dst.indexOf(o));
      dst.splice(at, 0, a);
      return { ...d, columns: { ...d.columns, [from]: src, [to]: dst } };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const d = drag;
    const a = String(active.id);
    const task = byId.get(a);
    if (!d || !over || !task) return setDrag(null);
    let cols = d.columns;
    const to = containerOf(String(over.id), cols);
    if (!to) return setDrag(null);
    const o = String(over.id);
    if (!o.startsWith(COL) && o !== a) {
      const list = cols[to]!;
      const fromIdx = list.indexOf(a);
      const toIdx = list.indexOf(o);
      if (fromIdx >= 0 && toIdx >= 0) cols = { ...cols, [to]: arrayMove(list, fromIdx, toIdx) };
    }
    const list = cols[to]!;
    const at = list.indexOf(a);
    const status = statusById.get(to);
    const unchanged = to === task.status_id && derived[to]!.indexOf(a) === at;
    if (!status || at < 0 || unchanged) return setDrag(null);
    // The server's index counts every issue in the column, shown or filtered out: place it right
    // after the card above the drop (or before the one below).
    const column = (all ?? tasks).filter((x) => x.status_id === to && x.id !== a).sort(byPosition);
    const above = list[at - 1];
    const below = list[at + 1];
    const index = above ? column.findIndex((x) => x.id === above) + 1 : below ? Math.max(0, column.findIndex((x) => x.id === below)) : column.length;
    setDrag({ active: null, columns: cols });
    setFocusId(a);
    void actions.move(task, status, index, between(column[index - 1]?.position, column[index]?.position)).finally(() => setDrag(null));
  };

  // ── keyboard focus ──
  const [focusId, setFocusId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; kind: RowMenu } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const keyboard = useRef(false);
  useEffect(() => {
    if (keyboard.current && focusId) revealFocused(scroller.current, `[data-task-id="${focusId}"]`);
    keyboard.current = false;
  }, [focusId]);

  const order = statuses.map((s) => s.id);
  const where = (id: string | null) => {
    if (!id) return null;
    const c = order.findIndex((s) => columns[s]?.includes(id));
    return c < 0 ? null : { c, r: columns[order[c]!]!.indexOf(id) };
  };
  const moveFocus = (dc: number, dr: number) => {
    keyboard.current = true;
    const at = where(focusId);
    if (!at) {
      const first = order.map((s) => columns[s]![0]).find(Boolean);
      if (first) setFocusId(first);
      return;
    }
    if (dr) {
      const col = columns[order[at.c]!]!;
      const r = Math.min(col.length - 1, Math.max(0, at.r + dr));
      setFocusId(col[r]!);
      return;
    }
    // Next non-empty column that way, at the nearest row.
    for (let c = at.c + dc; c >= 0 && c < order.length; c += dc) {
      const col = columns[order[c]!]!;
      if (col.length) {
        setFocusId(col[Math.min(at.r, col.length - 1)]!);
        return;
      }
    }
  };
  const focused = focusId ? byId.get(focusId) : undefined;
  const withFocused = (fn: (t: Task) => void) => () => (focused ? fn(focused) : moveFocus(0, 1));
  const ahead = dir === "rtl" ? -1 : 1;
  useKeys(
    {
      arrowdown: () => moveFocus(0, 1),
      j: () => moveFocus(0, 1),
      arrowup: () => moveFocus(0, -1),
      k: () => moveFocus(0, -1),
      arrowright: () => moveFocus(ahead, 0),
      arrowleft: () => moveFocus(-ahead, 0),
      enter: withFocused((x) => navigate({ name: "issue", key: x.key })),
      s: withFocused((x) => setMenu({ id: x.id, kind: "status" })),
      p: withFocused((x) => setMenu({ id: x.id, kind: "priority" })),
      a: withFocused((x) => setMenu({ id: x.id, kind: "assignee" })),
      l: withFocused((x) => setMenu({ id: x.id, kind: "label" })),
      t: withFocused((x) => void timer.start(x)),
      "mod+shift+c": withFocused((x) => void actions.copyKey(x)),
      "mod+backspace": withFocused((x) => setConfirmDelete(x)),
      escape: () => setFocusId(null),
    },
    !drag,
  );

  const onOpen = useCallback((x: Task) => navigate({ name: "issue", key: x.key }), [navigate]);
  const onHover = useCallback((id: string) => setFocusId(id), []);
  const onMenuClose = useCallback(() => setMenu(null), []);
  const active = drag?.active ? byId.get(drag.active) : undefined;

  return (
    <IssueContextArea
      resolve={(id) => byId.get(id)}
      statusesFor={() => statuses}
      members={members}
      labels={labels}
      actions={actions}
      onTarget={(x) => setFocusId(x.id)}
      confirmDelete={confirmDelete}
      onConfirmDelete={setConfirmDelete}
      className="min-h-0 min-w-0 flex-1"
      data-board={projectId}
    >
      <div ref={scroller} className="flex h-full gap-3 overflow-x-auto px-4 pt-3" data-board-scroll>
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setDrag(null)}>
          {statuses.map((s) => (
            <Column key={s.id} status={s} ids={columns[s.id] ?? []} quiet={filtering} onAdd={() => openCreateIn(shell.openCreate, projectId, s.id)}>
              {(columns[s.id] ?? []).map((id) => {
                const x = byId.get(id);
                if (!x) return null;
                return (
                  <SortableCard
                    key={id}
                    task={x}
                    status={s}
                    statuses={statuses}
                    focused={focusId === id}
                    menu={menu?.id === id ? menu.kind : null}
                    members={members}
                    memberMap={memberMap}
                    labels={labels}
                    labelMap={labelMap}
                    actions={actions}
                    onOpen={onOpen}
                    onHover={onHover}
                    onMenuClose={onMenuClose}
                  />
                );
              })}
            </Column>
          ))}
          <DragOverlay dropAnimation={{ duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
            {active ? (
              <div className="rotate-[1.5deg] cursor-grabbing">
                <CardBody task={active} status={statusById.get(active.status_id)} memberMap={memberMap} labelMap={labelMap} lifted />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
        <div className="w-1 shrink-0" aria-hidden />
      </div>
    </IssueContextArea>
  );
}

function Column({ status, ids, quiet, onAdd, children }: { status: Status; ids: string[]; quiet?: boolean; onAdd: () => void; children: ReactNode }) {
  const { t, number } = useI18n();
  const { setNodeRef, isOver } = useDroppable({ id: COL + status.id });
  return (
    <section className="flex h-full w-[272px] shrink-0 flex-col" data-column={status.name} aria-label={status.name}>
      <header className="group/col flex h-8 shrink-0 items-center gap-2 px-1.5">
        <StatusIcon status={status} />
        <span className="truncate text-[13.5px] font-medium text-grid-fg">{status.name}</span>
        <span className="text-[13px] text-grid-muted tabular-nums">{number(ids.length)}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onAdd}
          title={t("issues.addHere")}
          aria-label={t("issues.addHere")}
          className="flex size-6 items-center justify-center rounded-md text-grid-muted opacity-60 group-hover/col:opacity-100 hover:bg-grid-soft hover:text-grid-fg"
          data-column-add={status.name}
        >
          <PlusIcon className="size-3.5" />
        </button>
      </header>
      <SortableContext id={status.id} items={ids} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn("flex min-h-24 flex-1 flex-col gap-1.5 overflow-y-auto rounded-lg p-1 pb-6 transition-colors", isOver && "bg-grid-soft/60")}
          data-column-body={status.id}
        >
          {children}
          {ids.length === 0 && !quiet ? (
            <button
              type="button"
              onClick={onAdd}
              className="flex h-16 items-center justify-center rounded-lg border border-dashed border-line text-[13px] text-grid-muted hover:bg-grid-soft/60 hover:text-grid-fg"
            >
              <PlusIcon className="me-1 size-3.5" />
              {t("issues.addHere")}
            </button>
          ) : null}
        </div>
      </SortableContext>
    </section>
  );
}

interface CardProps {
  task: Task;
  status: Status;
  statuses: Status[];
  focused: boolean;
  menu: RowMenu | null;
  members: Member[];
  memberMap: Map<string, Member>;
  labels: Label[];
  labelMap: Map<string, Label>;
  actions: IssueActions;
  onOpen: (t: Task) => void;
  onHover: (id: string) => void;
  onMenuClose: () => void;
}

const ANCHOR = "pointer-events-none absolute top-2 end-2 size-0 overflow-hidden";

const SortableCard = memo(function SortableCard({ task, status, statuses, focused, menu, members, memberMap, labels, labelMap, actions, onOpen, onHover, onMenuClose }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const close = (o: boolean) => (o ? null : onMenuClose());
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      tabIndex={-1}
      role="button"
      aria-roledescription="card"
      data-task-id={task.id}
      data-card={task.key}
      data-focused={focused || undefined}
      onClick={() => onOpen(task)}
      onMouseMove={(e) => pointerMoved(e) && !focused && onHover(task.id)}
      className={cn("relative outline-none", isDragging && "opacity-40")}
    >
      <CardBody task={task} status={status} memberMap={memberMap} labelMap={labelMap} focused={focused} />
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
          align="end"
          triggerClassName={ANCHOR}
        />
      ) : menu === "priority" ? (
        <PriorityPicker value={task.priority} onChange={(p) => void actions.setPriority(task, p as Task["priority"])} compact open onOpenChange={close} align="end" triggerClassName={ANCHOR} />
      ) : menu === "assignee" ? (
        <AssigneePicker members={members} value={task.assignee_ids ?? []} onToggle={(id) => void actions.toggleAssignee(task, id)} open onOpenChange={close} align="end" triggerClassName={ANCHOR} />
      ) : menu === "label" ? (
        <LabelPicker labels={labels} value={task.label_ids ?? []} onToggle={(id) => void actions.toggleLabel(task, id)} open onOpenChange={close} align="end" triggerClassName={ANCHOR} />
      ) : null}
    </div>
  );
});

function CardBody({
  task,
  status,
  memberMap,
  labelMap,
  focused,
  lifted,
}: {
  task: Task;
  status: Status | undefined;
  memberMap: Map<string, Member>;
  labelMap: Map<string, Label>;
  focused?: boolean;
  lifted?: boolean;
}) {
  const { t } = useI18n();
  const people = (task.assignee_ids ?? []).map((id) => ({ id, email: memberMap.get(id)?.email ?? "?" }));
  const done = status?.category === "done";
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border border-line bg-grid-card px-2.5 pt-2 pb-2.5 text-[13.5px] transition-[border-color,box-shadow] duration-100",
        "hover:border-[color-mix(in_oklab,var(--grid-muted)_45%,transparent)]",
        focused && "border-grid-action/70 shadow-[0_0_0_1px_color-mix(in_oklab,var(--grid-action)_60%,transparent)]",
        lifted && "shadow-lg shadow-black/10 dark:shadow-black/40",
      )}
    >
      <div className="flex h-5 items-center gap-2">
        <LtrText className="font-mono text-[12px] text-grid-muted">{task.key}</LtrText>
        <span className="flex-1" />
        {people.length ? <AvatarStack people={people} size={18} max={3} /> : null}
      </div>
      <p className={cn("line-clamp-2 text-[14px] leading-snug", done ? "text-grid-muted" : "text-grid-fg")} dir="auto">
        {task.title}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex h-5 w-6 items-center justify-center rounded-[4px] border border-line" title={t(`priority.${task.priority}`)}>
          <PriorityIcon priority={task.priority} size={12} />
        </span>
        <DueDate due={task.due_at} done={done} />
        {task.subtask_count > 0 ? (
          <span className="inline-flex h-5 items-center gap-1 rounded-[4px] border border-line px-1.5 text-[12px] text-grid-muted">
            <GitBranchIcon className="size-3" />
            <LtrText className="tabular-nums">
              {task.subtask_done}/{task.subtask_count}
            </LtrText>
          </span>
        ) : null}
        {task.checklist_total > 0 ? (
          <span className="inline-flex h-5 items-center gap-1 rounded-[4px] border border-line px-1.5 text-[12px] text-grid-muted">
            <ListChecksIcon className="size-3" />
            <LtrText className="tabular-nums">
              {task.checklist_done}/{task.checklist_total}
            </LtrText>
          </span>
        ) : null}
        <LabelChips ids={task.label_ids} labels={labelMap} max={3} />
      </div>
    </div>
  );
}
