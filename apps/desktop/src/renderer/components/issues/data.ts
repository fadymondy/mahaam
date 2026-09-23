// Issue data: statuses across projects, and every change to an issue — applied to the cache first
// (every list, board and detail that holds the issue), sent to the API, rolled back with a toast
// if the API says no. The live stream and a final invalidation settle whatever the server decided.
import { useQueries, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";

import type { Board, Priority, ProjectDetail, Status, Task, TaskDetail, TaskInput } from "../../../shared/types";
import { useApp } from "@/lib/app";
import { api, desktop } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";

import { between, byPosition, copyText, sortStatuses, webPath } from "./util";

/** Statuses of several projects (from their details, which every issue view already caches). */
export function useStatuses(projectIds: string[]) {
  const { ws } = useApp();
  const ids = useMemo(() => [...new Set(projectIds)].sort(), [projectIds]);
  const results = useQueries({
    queries: ids.map((id) => ({ queryKey: qk.project(ws, id), queryFn: () => api.project(id), enabled: !!ws, staleTime: 60_000 })),
  });
  const loading = results.some((r) => r.isPending);
  const stamp = results.map((r) => `${r.dataUpdatedAt}`).join(",");
  const datas = results.map((r) => r.data as ProjectDetail | undefined);
  return useMemo(() => {
    const byId = new Map<string, Status>();
    const byProject = new Map<string, Status[]>();
    for (const d of datas) {
      if (!d) continue;
      const list = sortStatuses(d.statuses);
      byProject.set(d.id, list);
      for (const s of list) byId.set(s.id, s);
    }
    return { byId, byProject, loading };
    // `stamp` changes exactly when any detail does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, stamp, ids.join(",")]);
}

// ── the optimistic engine ────────────────────────────────────────────────────

type Edit = (t: Task) => Task | null; // null removes it
const WORK = new Set(["tasks", "board", "task"]);
let inflight = 0;

function apply(qc: QueryClient, ws: string, id: string, edit: Edit, detail?: (d: TaskDetail) => TaskDetail) {
  qc.setQueriesData<unknown>({ predicate: (q) => q.queryKey[0] === "w" && q.queryKey[1] === ws && WORK.has(String(q.queryKey[2])) }, (old: unknown) => {
    if (!old) return old;
    if (Array.isArray(old)) {
      let hit = false;
      const out: Task[] = [];
      for (const t of old as Task[]) {
        if (t.id !== id) out.push(t);
        else {
          hit = true;
          const n = edit(t);
          if (n) out.push(n);
        }
      }
      return hit ? out : old;
    }
    const o = old as Partial<Board> & Partial<TaskDetail>;
    if (Array.isArray(o.tasks) && "statuses" in o) {
      const b = o as Board;
      if (!b.tasks?.some((t) => t.id === id)) return old;
      return { ...b, tasks: b.tasks.flatMap((t) => (t.id === id ? (edit(t) ?? []) : [t])) };
    }
    if (o.id === id && o.key) {
      const n = edit(o as TaskDetail);
      if (!n) return old;
      const merged = { ...(o as TaskDetail), ...n } as TaskDetail;
      return detail ? detail(merged) : merged;
    }
    return old;
  });
}

function settle(qc: QueryClient, ws: string) {
  inflight = Math.max(0, inflight - 1);
  if (inflight) return; // a later change is still on its way; its answer settles both
  void qc.invalidateQueries({
    predicate: (q) => q.queryKey[0] === "w" && q.queryKey[1] === ws && ["tasks", "board", "task", "task-activity", "project", "projects"].includes(String(q.queryKey[2])),
  });
}

/** The end of a status column as the cache knows it (for an optimistic status change). */
function columnEnd(qc: QueryClient, ws: string, projectId: string, statusId: string): number {
  const b = qc.getQueryData<Board>(qk.board(ws, projectId));
  const last = (b?.tasks ?? []).filter((t) => t.status_id === statusId).sort(byPosition).at(-1);
  return between(last?.position, undefined);
}

export function useIssueActions() {
  const qc = useQueryClient();
  const { ws } = useApp();
  const { t } = useI18n();

  async function run(id: string, edit: Edit, call: () => Promise<unknown>, detail?: (d: TaskDetail) => TaskDetail): Promise<boolean> {
    await qc.cancelQueries({ predicate: (q) => q.queryKey[0] === "w" && q.queryKey[1] === ws && WORK.has(String(q.queryKey[2])) });
    const snapshot = qc.getQueriesData({ predicate: (q) => q.queryKey[0] === "w" && q.queryKey[1] === ws && WORK.has(String(q.queryKey[2])) });
    apply(qc, ws, id, edit, detail);
    inflight++;
    try {
      await call();
      return true;
    } catch (e) {
      for (const [key, data] of snapshot) qc.setQueryData(key, data);
      toast.error(e instanceof Error && e.message ? e.message : t("common.error"));
      return false;
    } finally {
      settle(qc, ws);
    }
  }

  const now = () => new Date().toISOString();

  // Stable across renders (rows are memoised on it); run() only closes over qc, ws and t.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({
    /** Status from a menu: the issue goes to the end of that column. */
    setStatus: (task: Task, status: Status) => {
      if (task.status_id === status.id) return Promise.resolve(true);
      const position = columnEnd(qc, ws, task.project_id, status.id);
      return run(
        task.id,
        (x) => ({ ...x, status_id: status.id, position, completed_at: status.category === "done" ? (x.completed_at ?? now()) : null, updated_at: now() }),
        () => api.moveTask(task.key, status.id),
        (d) => ({ ...d, status: status }),
      );
    },
    /** A drag on the board: into `status` at `index` among the column's other issues. */
    move: (task: Task, status: Status, index: number, position: number) =>
      run(
        task.id,
        (x) => ({ ...x, status_id: status.id, position, completed_at: status.category === "done" ? (x.completed_at ?? now()) : null, updated_at: now() }),
        () => api.moveTask(task.key, status.id, index),
        (d) => ({ ...d, status: status }),
      ),
    setPriority: (task: Task, priority: Priority) =>
      task.priority === priority ? Promise.resolve(true) : run(task.id, (x) => ({ ...x, priority, updated_at: now() }), () => api.updateTask(task.key, { priority })),
    setAssignees: (task: Task, ids: string[]) => run(task.id, (x) => ({ ...x, assignee_ids: ids }), () => api.setAssignees(task.key, ids)),
    toggleAssignee: (task: Task, userId: string) => {
      const cur = task.assignee_ids ?? [];
      const ids = cur.includes(userId) ? cur.filter((x) => x !== userId) : [...cur, userId];
      return run(task.id, (x) => ({ ...x, assignee_ids: ids }), () => api.setAssignees(task.key, ids));
    },
    toggleLabel: (task: Task, labelId: string) => {
      const cur = task.label_ids ?? [];
      const ids = cur.includes(labelId) ? cur.filter((x) => x !== labelId) : [...cur, labelId];
      return run(task.id, (x) => ({ ...x, label_ids: ids }), () => api.setLabels(task.key, ids));
    },
    /** Title, description, due date, estimate, parent. `local` is how it should look meanwhile. */
    update: (task: Task, input: TaskInput, local: Partial<Task>) =>
      run(task.id, (x) => ({ ...x, ...local, updated_at: now() }), () => api.updateTask(task.key, input)),
    remove: async (task: Task) => {
      const ok = await run(task.id, () => null, () => api.deleteTask(task.key));
      if (ok) toast.success(t("issue.deleted", { key: task.key }));
      return ok;
    },
    copyKey: async (task: Pick<Task, "key">) => {
      await copyText(task.key);
      toast.success(t("issue.copied", { key: task.key }));
    },
    openInBrowser: (task: Pick<Task, "key">) => void desktop.openWeb(webPath.issue(task.key)),
  }), [qc, ws, t]);
}

export type IssueActions = ReturnType<typeof useIssueActions>;
