// Typed wrappers over the REST routes the apps use. Paths match the API's OpenAPI document; the two
// multipart intakes (POST /api/w/portal/issues, /api/w/portal/requests) are raw routes outside it.
import type { MahaamClient } from "./client";
import type {
  ChecklistItem,
  Comment,
  Inbox,
  Invoice,
  Issue,
  IssueDetail,
  PortalComment,
  PortalIssueDetail,
  PortalProject,
  PortalProjectPage,
  PortalRequest,
  Project,
  ProjectDetail,
  Task,
  TaskDetail,
  TimeEntry,
  TimerChange,
  Timesheet,
  TimeSettings,
  Workspace,
} from "./types";

const q = (params: Record<string, string | number | undefined | null>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return s ? `?${s}` : "";
};
const e = encodeURIComponent;

export interface Attachment {
  uri: string;
  name: string;
  type: string;
  /** Web: the picked file as a Blob (RN's {uri,name,type} form part does not exist in browsers). */
  blob?: Blob;
}

export function api(c: MahaamClient) {
  return {
    workspaces: () => c.get<{ workspaces: Workspace[] | null }>("/api/me/workspaces", { workspace: false }),

    time: {
      running: () => c.get<{ timer: TimeEntry | null }>("/api/w/time/running"),
      start: (input: { project?: string; task?: string; description?: string; billable?: boolean }) =>
        c.post<TimerChange>("/api/w/time/start", input),
      stop: () => c.post<TimeEntry>("/api/w/time/stop", {}),
      entries: (p: { from?: string; to?: string; project?: string; limit?: number } = {}) =>
        c.get<{ entries: TimeEntry[] | null }>(`/api/w/time/entries${q(p)}`),
      log: (input: {
        project?: string;
        task?: string;
        description?: string;
        date?: string;
        minutes?: number;
        started_at?: string;
        ended_at?: string;
        billable?: boolean;
      }) => c.post<TimeEntry>("/api/w/time/entries", input),
      timesheet: (week?: string) => c.get<Timesheet>(`/api/w/time/timesheet${q({ week })}`),
      settings: () => c.get<TimeSettings>("/api/w/time/settings"),
    },

    tasks: {
      mine: (userId: string) => c.get<{ tasks: Task[] | null }>(`/api/w/tasks${q({ assignee: userId, limit: 200 })}`),
      get: (key: string) => c.get<TaskDetail>(`/api/w/tasks/${e(key)}`),
      comments: (key: string) => c.get<{ comments: Comment[] | null }>(`/api/w/tasks/${e(key)}/comments`),
      comment: (key: string, body: string) => c.post<Comment>(`/api/w/tasks/${e(key)}/comments`, { body }),
      toggleChecklist: (item: string, done: boolean) => c.patch<ChecklistItem>(`/api/w/checklist/${e(item)}`, { done }),
    },

    projects: {
      list: () => c.get<{ projects: Project[] | null }>("/api/w/projects"),
      get: (id: string) => c.get<ProjectDetail>(`/api/w/projects/${e(id)}`),
    },

    issues: {
      list: () => c.get<{ issues: Issue[] | null }>(`/api/w/issues${q({ state: "open" })}`),
      // The team side was read-only: a list, with nothing behind it. These are what turn it into
      // something a member can work from. All four routes already exist on the server — only the
      // client was missing them.
      get: (key: string) => c.get<IssueDetail>(`/api/w/issues/${e(key)}`),
      comment: (key: string, body: string) => c.post<unknown>(`/api/w/issues/${e(key)}/comments`, { body }),
      move: (key: string, status: string) => c.patch<IssueDetail>(`/api/w/issues/${e(key)}`, { status }),
      create: (input: { title: string; body?: string; project?: string; issue_type?: string; priority?: string }) =>
        c.post<IssueDetail>("/api/w/issues", input),
    },

    notifications: {
      list: () => c.get<Inbox>("/api/w/notifications?limit=50"),
      read: (id: string) => c.post<unknown>(`/api/w/notifications/${e(id)}/read`, {}),
      readAll: () => c.post<unknown>("/api/w/notifications/read-all", {}),
    },

    portal: {
      // The richer portal (projects, requests, accept / reopen) is newer than the issue + invoice
      // intake: feature-detected, so an older server just hides those sections.
      projects: () => c.optional<{ projects: PortalProject[] | null }>("/api/w/portal/projects"),
      project: (id: string) => c.optional<PortalProjectPage>(`/api/w/portal/projects/${e(id)}`),
      issues: (project?: string) => c.get<{ issues: Issue[] | null }>(`/api/w/portal/issues${q({ project })}`),
      issue: (key: string) => c.optional<PortalIssueDetail>(`/api/w/portal/issues/${e(key)}`),
      updateIssue: (key: string, status: "done" | "todo") => c.patch<PortalIssueDetail>(`/api/w/portal/issues/${e(key)}`, { status }),
      commentIssue: (key: string, body: string) => c.post<PortalComment>(`/api/w/portal/issues/${e(key)}/comments`, { body }),
      requests: (project?: string) => c.optional<{ requests: PortalRequest[] | null }>(`/api/w/portal/requests${q({ project })}`),
      invoices: () => c.get<{ invoices: Invoice[] | null }>("/api/w/portal/invoices"),
      /** File an issue ("bug" | "feature" | "task") or a request, optionally with a photo. */
      file: (
        kind: "issue" | "request",
        fields: { project_id: string; title: string; body?: string; issue_type?: string; kind?: string; desired_on?: string },
        photo?: Attachment,
      ) => {
        const form = new FormData();
        for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
        if (photo) {
          if (photo.blob) form.append("screenshot", photo.blob, photo.name);
          else form.append("screenshot", { uri: photo.uri, name: photo.name, type: photo.type } as unknown as Blob);
        }
        return c.request<{ key: string }>(kind === "issue" ? "/api/w/portal/issues" : "/api/w/portal/requests", {
          method: "POST",
          form,
        });
      },
      /** The printable invoice HTML. Staff-only on current servers (clients get 403). */
      invoiceHtml: (id: string, lang: string) => c.request<string>(`/api/w/invoices/${e(id)}/print${q({ lang })}`, { text: true }),
    },
  };
}

export type Api = ReturnType<typeof api>;
