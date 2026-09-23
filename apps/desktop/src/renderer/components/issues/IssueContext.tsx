// One right-click menu for a whole list or board (not one per row): the row under the pointer is
// found by its data-task-id. It is the operating system's own menu (main/native.ts): status,
// priority, assignees and labels as submenus, the timer, open in a new window, share, copy, open in
// the browser, and delete behind a native confirmation.
import { useEffect, type ReactNode } from "react";
import { toast } from "sonner";

import type { Label, Member, Status, Task } from "../../../shared/types";
import { PRIORITIES } from "@/components/kit";
import { assignable } from "@/components/pickers";
import { useApp } from "@/lib/app";
import { useI18n } from "@/lib/i18n";
import { nativeConfirm, nativeMenu, nativeShare, openIssueWindow, type NativeMenuItem } from "@/lib/native";
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
  const { session } = useApp();
  const timer = useIssueTimer();
  const people = assignable(members);

  async function open(task: Task) {
    const statuses = statusesFor(task);
    const items: NativeMenuItem[] = [
      { label: `${task.key} · ${task.title}`.slice(0, 60), enabled: false },
      { type: "separator" },
      {
        label: t("issue.status"),
        accelerator: "S",
        submenu: statuses.map((s) => ({ id: `status:${s.id}`, label: s.name, type: "radio", checked: s.id === task.status_id })),
      },
      {
        label: t("issue.priority"),
        accelerator: "P",
        submenu: PRIORITIES.map((p) => ({ id: `priority:${p}`, label: t(`priority.${p}`), type: "radio", checked: task.priority === p })),
      },
      {
        label: t("issue.assignees"),
        accelerator: "A",
        submenu: people.length
          ? people.map((m) => ({ id: `assignee:${m.user_id}`, label: m.email, type: "checkbox", checked: (task.assignee_ids ?? []).includes(m.user_id) }))
          : [{ label: t("common.none"), enabled: false }],
      },
      ...(labels.length
        ? [
            {
              label: t("issue.labels"),
              accelerator: "L",
              submenu: labels.map((l) => ({ id: `label:${l.id}`, label: l.name, type: "checkbox" as const, checked: (task.label_ids ?? []).includes(l.id) })),
            },
          ]
        : []),
      { type: "separator" },
      timer.isRunning(task) ? { id: "timer:stop", label: t("issue.stopTimer"), accelerator: "T" } : { id: "timer:start", label: t("issue.startTimer"), accelerator: "T" },
      { type: "separator" },
      { id: "window", label: t("issue.openInWindow") },
      { id: "share", label: t("issue.share") },
      { id: "copy", label: t("issue.copyKey"), accelerator: "CmdOrCtrl+Shift+C" },
      { id: "browser", label: t("common.openInBrowser") },
      { type: "separator" },
      { id: "delete", label: t("issue.delete"), accelerator: "CmdOrCtrl+Backspace" },
    ];
    const id = await nativeMenu(items);
    if (!id) return;
    const [kind, arg] = [id.slice(0, id.indexOf(":") < 0 ? id.length : id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
    if (kind === "status") {
      const s = statuses.find((x) => x.id === arg);
      if (s) void actions.setStatus(task, s);
    } else if (kind === "priority") void actions.setPriority(task, arg as Task["priority"]);
    else if (kind === "assignee") void actions.toggleAssignee(task, arg);
    else if (kind === "label") void actions.toggleLabel(task, arg);
    else if (id === "timer:stop") void timer.stop();
    else if (id === "timer:start") void timer.start(task);
    else if (id === "window") void openIssueWindow(task.key);
    else if (id === "share") void nativeShare(`${session?.apiUrl ?? ""}/en/w/${session?.workspace?.slug ?? ""}/issues/${task.key}`, `${task.key} · ${task.title}`);
    else if (id === "copy") void actions.copyKey(task);
    else if (id === "browser") actions.openInBrowser(task);
    else if (id === "delete") onConfirmDelete(task);
  }

  return (
    <>
      <div
        className={className}
        {...rest}
        onContextMenu={(e) => {
          const hit = (e.target as HTMLElement).closest("[data-task-id]")?.getAttribute("data-task-id");
          const task = hit ? resolve(hit) : undefined;
          if (!task) return;
          e.preventDefault();
          e.stopPropagation();
          onTarget?.(task);
          void open(task);
        }}
      >
        {children}
      </div>
      <DeleteIssueDialog task={confirmDelete} onClose={() => onConfirmDelete(null)} actions={actions} />
    </>
  );
}

/** Asks with the platform's own alert (a sheet on macOS) when `task` is set; renders nothing. */
export function DeleteIssueDialog({ task, onClose, actions, onDeleted }: { task: Task | null; onClose: () => void; actions: IssueActions; onDeleted?: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    if (!task) return;
    let live = true;
    void nativeConfirm({
      message: t("issue.deleteConfirm", { key: task.key }),
      detail: t("issue.deleteBody"),
      confirm: t("common.delete"),
      cancel: t("common.cancel"),
      destructive: true,
    }).then((yes) => {
      if (!live) return;
      onClose();
      if (yes) void actions.remove(task).then((ok) => ok && onDeleted?.());
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);
  return null;
}
