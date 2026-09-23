// One right-click menu for a whole list or board (not one per row): the row under the pointer is
// found by its data-task-id. Status, priority, assignees and labels as submenus, the timer, copy,
// open in the browser, and delete behind a confirmation.
import { CopyIcon, ExternalLinkIcon, PlayIcon, SquareIcon, Trash2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import type { Label, Member, Status, Task } from "../../../shared/types";
import { Avatar, ColorDot, Kbd, LtrText, PRIORITIES, PriorityIcon, StatusIcon } from "@/components/kit";
import { assignable } from "@/components/pickers";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useI18n } from "@/lib/i18n";
import { useTimer } from "@/shell/Timer";

import type { IssueActions } from "./data";

/** Start/stop a timer on an issue, with the toasts. */
export function useIssueTimer() {
  const { t } = useI18n();
  const timer = useTimer();
  const isRunning = (task: Pick<Task, "id">) => !!timer.running && timer.running.task_id === task.id;
  const start = async (task: Pick<Task, "id" | "key">) => {
    if (isRunning(task)) {
      toast(t("issue.timerAlready", { key: task.key }));
      return;
    }
    try {
      await timer.start({ task: task.id });
      toast.success(t("issue.timerStarted", { key: task.key }));
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("common.error"));
    }
  };
  const stop = async () => {
    try {
      await timer.stop();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("common.error"));
    }
  };
  const toggle = (task: Pick<Task, "id" | "key">) => (isRunning(task) ? stop() : start(task));
  return { running: timer.running, busy: timer.busy, isRunning, start, stop, toggle };
}

const ITEM = "text-[13.5px] gap-2";

export function IssueContextArea({
  resolve,
  statusesFor,
  members,
  labels,
  actions,
  onTarget,
  confirmDelete,
  onConfirmDelete,
  className,
  children,
  ...rest
}: {
  resolve: (id: string) => Task | undefined;
  statusesFor: (task: Task) => Status[];
  members: Member[];
  labels: Label[];
  actions: IssueActions;
  /** The row that was right-clicked, so the focus follows it. */
  onTarget?: (task: Task) => void;
  /** Delete confirmation, lifted so a keyboard shortcut (⌘⌫) can ask for it too. */
  confirmDelete: Task | null;
  onConfirmDelete: (task: Task | null) => void;
  className?: string;
  children: ReactNode;
  "data-issue-list"?: string;
  "data-board"?: string;
}) {
  const { t } = useI18n();
  const timer = useIssueTimer();
  const [targetId, setTargetId] = useState<string | null>(null);
  const task = targetId ? resolve(targetId) : undefined;
  const statuses = task ? statusesFor(task) : [];
  const people = assignable(members);

  return (
    <>
      <ContextMenu open={!!task} onOpenChange={(o) => (o ? null : setTargetId(null))}>
        <ContextMenuTrigger
          render={
            <div
              className={className}
              {...rest}
              onContextMenuCapture={(e) => {
                const id = (e.target as HTMLElement).closest("[data-task-id]")?.getAttribute("data-task-id");
                const hit = id ? resolve(id) : undefined;
                if (!hit) {
                  e.preventDefault();
                  e.stopPropagation();
                  setTargetId(null);
                  return;
                }
                setTargetId(hit.id);
                onTarget?.(hit);
              }}
            />
          }
        >
          {children}
        </ContextMenuTrigger>
        {task ? (
          <ContextMenuContent className="w-56" onClick={(e) => e.stopPropagation()} data-issue-menu={task.key}>
            <div className="flex items-center gap-2 px-2 pt-1 pb-1.5 text-[12.5px] text-grid-muted">
              <LtrText className="shrink-0 font-mono whitespace-nowrap">{task.key}</LtrText>
              <span className="truncate">{task.title}</span>
            </div>
            <ContextMenuSub>
              <ContextMenuSubTrigger className={ITEM}>
                <StatusIcon status={statuses.find((s) => s.id === task.status_id)} />
                {t("issue.status")}
                <Kbd combo="s" className="ms-auto" />
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-52">
                <ContextMenuRadioGroup
                  value={task.status_id}
                  onValueChange={(v) => {
                    const s = statuses.find((x) => x.id === v);
                    if (s) void actions.setStatus(task, s);
                  }}
                >
                  {statuses.map((s) => (
                    <ContextMenuRadioItem key={s.id} value={s.id} closeOnClick className={ITEM} data-option={s.name}>
                      <StatusIcon status={s} />
                      {s.name}
                    </ContextMenuRadioItem>
                  ))}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger className={ITEM}>
                <PriorityIcon priority={task.priority} />
                {t("issue.priority")}
                <Kbd combo="p" className="ms-auto" />
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-44">
                <ContextMenuRadioGroup value={task.priority} onValueChange={(v) => void actions.setPriority(task, v as Task["priority"])}>
                  {PRIORITIES.map((p) => (
                    <ContextMenuRadioItem key={p} value={p} closeOnClick className={ITEM}>
                      <PriorityIcon priority={p} />
                      {t(`priority.${p}`)}
                    </ContextMenuRadioItem>
                  ))}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger className={ITEM}>
                <span className="flex size-4 items-center justify-center text-grid-muted">
                  <Avatar id={task.assignee_ids?.[0] ?? "-"} email={members.find((m) => m.user_id === task.assignee_ids?.[0])?.email ?? "?"} size={14} />
                </span>
                {t("issue.assignees")}
                <Kbd combo="a" className="ms-auto" />
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-60">
                {people.map((m) => (
                  <ContextMenuCheckboxItem
                    key={m.user_id}
                    checked={(task.assignee_ids ?? []).includes(m.user_id)}
                    onCheckedChange={() => void actions.toggleAssignee(task, m.user_id)}
                    className={ITEM}
                  >
                    <Avatar id={m.user_id} email={m.email} size={16} />
                    <span className="truncate" dir="ltr">
                      {m.email}
                    </span>
                  </ContextMenuCheckboxItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            {labels.length ? (
              <ContextMenuSub>
                <ContextMenuSubTrigger className={ITEM}>
                  <ColorDot color={labels.find((l) => task.label_ids?.includes(l.id))?.color ?? "slate"} />
                  {t("issue.labels")}
                  <Kbd combo="l" className="ms-auto" />
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-52">
                  {labels.map((l) => (
                    <ContextMenuCheckboxItem
                      key={l.id}
                      checked={(task.label_ids ?? []).includes(l.id)}
                      onCheckedChange={() => void actions.toggleLabel(task, l.id)}
                      className={ITEM}
                    >
                      <ColorDot color={l.color} />
                      <span className="truncate">{l.name}</span>
                    </ContextMenuCheckboxItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            ) : null}
            <ContextMenuSeparator />
            {timer.isRunning(task) ? (
              <ContextMenuItem className={ITEM} onClick={() => void timer.stop()}>
                <SquareIcon />
                {t("issue.stopTimer")}
                <Kbd combo="t" className="ms-auto" />
              </ContextMenuItem>
            ) : (
              <ContextMenuItem className={ITEM} onClick={() => void timer.start(task)} data-menu-action="timer">
                <PlayIcon />
                {t("issue.startTimer")}
                <Kbd combo="t" className="ms-auto" />
              </ContextMenuItem>
            )}
            <ContextMenuItem className={ITEM} onClick={() => void actions.copyKey(task)}>
              <CopyIcon />
              {t("issue.copyKey")}
              <Kbd combo="mod+shift+c" className="ms-auto" />
            </ContextMenuItem>
            <ContextMenuItem className={ITEM} onClick={() => actions.openInBrowser(task)}>
              <ExternalLinkIcon />
              {t("common.openInBrowser")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem className={ITEM} variant="destructive" onClick={() => onConfirmDelete(task)} data-menu-action="delete">
              <Trash2Icon />
              {t("issue.delete")}
              <Kbd combo="mod+⌫" className="ms-auto" />
            </ContextMenuItem>
          </ContextMenuContent>
        ) : null}
      </ContextMenu>
      <DeleteIssueDialog task={confirmDelete} onClose={() => onConfirmDelete(null)} actions={actions} />
    </>
  );
}

export function DeleteIssueDialog({ task, onClose, actions, onDeleted }: { task: Task | null; onClose: () => void; actions: IssueActions; onDeleted?: () => void }) {
  const { t } = useI18n();
  return (
    <AlertDialog open={!!task} onOpenChange={(o) => (o ? null : onClose())}>
      <AlertDialogContent size="sm" data-confirm-delete>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[15px]">{task ? t("issue.deleteConfirm", { key: task.key }) : ""}</AlertDialogTitle>
          <AlertDialogDescription className="text-[13.5px]">{t("issue.deleteBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">{t("common.cancel")}</AlertDialogCancel>
          <Button
            size="sm"
            variant="destructive"
            autoFocus
            data-confirm
            onClick={() => {
              const x = task;
              onClose();
              if (x) void actions.remove(x).then((ok) => ok && onDeleted?.());
            }}
          >
            {t("common.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
