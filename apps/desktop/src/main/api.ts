// Everything the renderer can ask of the API. The object's keys are the allowlist: the renderer
// names a method, the main process runs it with the device token. Nothing else crosses.
import type { MahaamClient } from "@mahaam/client";

import type {
  Activity,
  Board,
  ChecklistItem,
  Comment,
  EntryPatch,
  Inbox,
  Label,
  LogInput,
  Member,
  Project,
  ProjectDetail,
  StartInput,
  Task,
  TaskDetail,
  TaskInput,
  TimeEntry,
  TimerChange,
  Timesheet,
  TimeSettings,
} from "../shared/types";

import { accountApi } from "./api-account";
import { issuesApi } from "./api-issues";
import { timeApi } from "./api-time";

const e = encodeURIComponent;

export function makeApi(c: MahaamClient, hooks: { timerChanged: (running: TimeEntry | null) => void }) {
  const get = <T>(path: string, query?: Record<string, string | number | boolean | undefined>) => c.request<T>("GET", path, { query });
  const send = <T>(method: string, path: string, body?: unknown) => c.request<T>(method, path, { body: body ?? {} });

  return {
    // ── identity ──
    me: () => c.me(),
    workspaces: () => c.workspaces(),

    // ── projects ──
    projects: async (archived = false) =>
      (await get<{ projects: Project[] | null }>("/api/w/projects", { archived: archived ? "true" : undefined })).projects ?? [],
    project: (id: string) => get<ProjectDetail>(`/api/w/projects/${e(id)}`),
    board: (id: string) => get<Board>(`/api/w/projects/${e(id)}/board`),
    projectActivity: async (id: string) => (await get<{ activity: Activity[] | null }>(`/api/w/projects/${e(id)}/activity`)).activity ?? [],
    members: async () => (await get<{ members: Member[] | null }>("/api/w/members")).members ?? [],
    labels: async () => (await get<{ labels: Label[] | null }>("/api/w/labels")).labels ?? [],

    // ── issues (tasks on the board) ──
    tasks: async (q: { project?: string; status?: string; category?: "todo" | "doing" | "done"; assignee?: string; label?: string; q?: string; limit?: number } = {}) =>
      (await get<{ tasks: Task[] | null }>("/api/w/tasks", q)).tasks ?? [],
    task: (key: string) => get<TaskDetail>(`/api/w/tasks/${e(key)}`),
    createTask: (projectId: string, input: TaskInput) => send<TaskDetail>("POST", `/api/w/projects/${e(projectId)}/tasks`, input),
    updateTask: (key: string, patch: TaskInput) => send<TaskDetail>("PATCH", `/api/w/tasks/${e(key)}`, patch),
    deleteTask: (key: string) => c.request<void>("DELETE", `/api/w/tasks/${e(key)}`),
    moveTask: (key: string, status: string, index?: number) =>
      send<TaskDetail>("POST", `/api/w/tasks/${e(key)}/move`, { status, ...(index === undefined ? {} : { index }) }),
    setAssignees: (key: string, userIds: string[]) => send<unknown>("PUT", `/api/w/tasks/${e(key)}/assignees`, { user_ids: userIds }),
    setLabels: (key: string, labelIds: string[]) => send<unknown>("PUT", `/api/w/tasks/${e(key)}/labels`, { label_ids: labelIds }),
    comments: async (key: string) => (await get<{ comments: Comment[] | null }>(`/api/w/tasks/${e(key)}/comments`)).comments ?? [],
    comment: (key: string, body: string) => send<Comment>("POST", `/api/w/tasks/${e(key)}/comments`, { body }),
    taskActivity: async (key: string) => (await get<{ activity: Activity[] | null }>(`/api/w/tasks/${e(key)}/activity`)).activity ?? [],
    addChecklistItem: (key: string, title: string) => send<ChecklistItem>("POST", `/api/w/tasks/${e(key)}/checklist`, { title }),
    updateChecklistItem: (id: string, patch: { title?: string; done?: boolean }) => send<ChecklistItem>("PATCH", `/api/w/checklist/${e(id)}`, patch),
    deleteChecklistItem: (id: string) => c.request<void>("DELETE", `/api/w/checklist/${e(id)}`),

    // ── time ──
    running: () => c.running(),
    start: async (input: StartInput) => {
      const out = await c.start(input);
      hooks.timerChanged(out.started);
      return out as TimerChange;
    },
    stop: async () => {
      const out = await c.stop();
      hooks.timerChanged(null);
      return out;
    },
    entries: async (q: { from?: string; to?: string; project?: string; limit?: number } = {}) =>
      (await get<{ entries: TimeEntry[] | null }>("/api/w/time/entries", q)).entries ?? [],
    timesheet: (week?: string) => get<Timesheet>("/api/w/time/timesheet", { week }),
    timeSettings: () => get<TimeSettings>("/api/w/time/settings"),
    logTime: (input: LogInput) => send<TimeEntry>("POST", "/api/w/time/entries", input),
    updateEntry: (id: string, patch: EntryPatch) => send<TimeEntry>("PATCH", `/api/w/time/entries/${e(id)}`, patch),
    deleteEntry: (id: string) => c.request<void>("DELETE", `/api/w/time/entries/${e(id)}`),

    // ── inbox ──
    notifications: (limit = 50) => get<Inbox>("/api/w/notifications", { limit }),
    readNotification: (id: string) => send<unknown>("POST", `/api/w/notifications/${e(id)}/read`),
    readAllNotifications: () => send<{ read: number }>("POST", "/api/w/notifications/read-all"),

    // Per-feature additions, one file each so features never edit the same lines.
    ...issuesApi(c),
    ...timeApi(c),
    ...accountApi(c),
  };
}

export type Api = ReturnType<typeof makeApi>;
export type ApiMethod = keyof Api;
