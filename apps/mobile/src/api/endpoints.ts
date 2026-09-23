// Typed wrappers over the REST routes the apps use. Paths match the API's OpenAPI document; the two
// multipart intakes (POST /api/w/portal/issues, /api/w/portal/requests) are raw routes outside it.
import type { MahaamClient } from "./client";
import type {
  ChecklistItem,
  Comment,
  Activity,
  Budget,
  Inbox,
  Invoice,
  Issue,
  IssueDetail,
  IssueRow,
  Label,
  Member,
  PortalActivityItem,
  Profile,
  TwoFAState,
  VerifyState,
  PortalBoard,
  PortalTimeReport,
  ProjectReport,
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

/** GET /api/auth/tokens: one per signed-in device or app. */
export interface AccessToken {
  id: string;
  name: string;
  abilities: string[] | null;
  created_at: string;
  /** "" when it never expires. */
  expires_at: string;
}

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
    /** A new workspace with the caller as its owner (needs a verified email: 403 otherwise). */
    createWorkspace: (name: string, locale: string) => c.post<{ workspace: Workspace }>("/api/me/workspaces", { name, locale }, { workspace: false }),

    /** Signed-out account routes (CSRF double-submit, like sign-in). */
    auth: {
      forgot: (email: string, locale: string) => c.publicPost("/api/auth/password/forgot", { email, locale }),
      reset: (input: { email: string; code: string; new_password: string; locale: string }) => c.publicPost("/api/auth/password/reset", input),
      changePassword: (old_password: string, new_password: string) =>
        c.post<unknown>("/api/auth/change-password", { old_password, new_password }, { workspace: false }),
    },

    /** The signed-in person (no workspace). */
    me: {
      profile: () => c.get<Profile>("/api/me/profile", { workspace: false }),
      update: (patch: { name?: string; locale?: string; timezone?: string }) => c.patch<Profile>("/api/me/profile", patch),
      uploadAvatar: (photo: Attachment) => {
        const form = new FormData();
        if (photo.blob) form.append("file", photo.blob, photo.name);
        else form.append("file", { uri: photo.uri, name: photo.name, type: photo.type } as unknown as Blob);
        return c.request<Profile>("/api/me/avatar", { method: "POST", form, workspace: false });
      },
      removeAvatar: () => c.del<Profile>("/api/me/avatar"),
      changeEmail: (email: string, password: string, locale: string) => c.post<unknown>("/api/me/email", { email, password, locale }, { workspace: false }),
      confirmEmail: (code: string, locale: string) => c.post<Profile>("/api/me/email/confirm", { code, locale }, { workspace: false }),
      verifyState: () => c.get<VerifyState>("/api/me/verify-email", { workspace: false }),
      verifyEmail: (code: string) => c.post<VerifyState>("/api/me/verify-email", { code }, { workspace: false }),
      resendVerify: (locale: string) => c.post<unknown>("/api/me/verify-email/resend", { locale }, { workspace: false }),
      twoFA: () => c.get<TwoFAState>("/api/me/2fa", { workspace: false }),
      twoFAEnroll: (password: string) => c.post<{ secret: string; otpauth_url: string }>("/api/me/2fa/enroll", { password }, { workspace: false }),
      twoFAConfirm: (code: string) => c.post<{ recovery_codes: string[] | null }>("/api/me/2fa/confirm", { code }, { workspace: false }),
      twoFADisable: (input: { password: string; code?: string; recovery_code?: string }) => c.post<unknown>("/api/me/2fa/disable", input, { workspace: false }),
      twoFARecovery: (password: string, code: string) =>
        c.post<{ recovery_codes: string[] | null }>("/api/me/2fa/recovery-codes", { password, code }, { workspace: false }),
      /** The account's signed-in devices: its personal access tokens (phones, desktops, the extension). */
      devices: async () => ((await c.get<AccessToken[] | null>("/api/auth/tokens", { workspace: false })) ?? []),
      revokeDevice: (id: string) => c.del<unknown>(`/api/auth/tokens/${encodeURIComponent(id)}`),
      deleteAccount: (input: { password: string; code?: string; recovery_code?: string; locale: string }) =>
        c.post<{ purge_after: string }>("/api/me/delete", input, { workspace: false }),
    },

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
      search: (text: string) => c.get<{ tasks: Task[] | null }>(`/api/w/tasks${q({ q: text, limit: 30 })}`),
      get: (key: string) => c.get<TaskDetail>(`/api/w/tasks/${e(key)}`),
      comments: (key: string) => c.get<{ comments: Comment[] | null }>(`/api/w/tasks/${e(key)}/comments`),
      comment: (key: string, body: string) => c.post<Comment>(`/api/w/tasks/${e(key)}/comments`, { body }),
      toggleChecklist: (item: string, done: boolean) => c.patch<ChecklistItem>(`/api/w/checklist/${e(item)}`, { done }),
    },

    projects: {
      list: (archived = false) => c.get<{ projects: Project[] | null }>(`/api/w/projects${q({ archived: archived ? "true" : undefined })}`),
      get: (id: string) => c.get<ProjectDetail>(`/api/w/projects/${e(id)}`),
      /** % done, tasks by status, budget, hours by member and week, open issues, activity. */
      report: (id: string) => c.get<ProjectReport>(`/api/w/projects/${e(id)}/report${q({ format: "json" })}`),
      reportText: (id: string, format: "md", lang: string) =>
        c.request<string>(`/api/w/projects/${e(id)}/report${q({ format, lang })}`, { text: true }),
      budget: (id: string) => c.get<Budget>(`/api/w/projects/${e(id)}/budget`),
      activity: (id: string) => c.get<{ activity: Activity[] | null }>(`/api/w/projects/${e(id)}/activity`),
    },

    members: () => c.get<{ members: Member[] | null }>("/api/w/members"),
    labels: () => c.get<{ labels: Label[] | null }>("/api/w/labels"),

    issues: {
      list: () => c.get<{ issues: Issue[] | null }>(`/api/w/issues${q({ state: "open" })}`),
      /** One project's board (include_board: items made on the board too), or a filtered queue. */
      query: (p: { project?: string; q?: string; type?: string; priority?: string; state?: string; status?: string; board?: boolean }) =>
        c.get<{ issues: IssueRow[] | null }>(
          `/api/w/issues${q({ project: p.project, q: p.q, type: p.type, priority: p.priority, state: p.state, status: p.status, include_board: p.board ? "true" : undefined })}`,
        ),
      /** Into a board column (status id), as the web board does; the issue's stage follows the column. */
      toColumn: (key: string, status: string) => c.post<unknown>(`/api/w/tasks/${e(key)}/move`, { status }),
      update: (
        key: string,
        patch: { title?: string; body?: string; priority?: string; issue_type?: string; state?: string; resolution?: string; human_only?: boolean },
      ) => c.patch<IssueDetail>(`/api/w/issues/${e(key)}`, patch),
      assignees: (key: string, userIds: string[]) => c.put<unknown>(`/api/w/tasks/${e(key)}/assignees`, { user_ids: userIds }),
      // The team side was read-only: a list, with nothing behind it. These are what turn it into
      // something a member can work from. All four routes already exist on the server — only the
      // client was missing them.
      get: (key: string) => c.get<IssueDetail>(`/api/w/issues/${e(key)}`),
      comment: (key: string, body: string) => c.post<unknown>(`/api/w/issues/${e(key)}/comments`, { body }),
      move: (key: string, status: string) => c.patch<IssueDetail>(`/api/w/issues/${e(key)}`, { status }),
      create: (input: { title: string; body?: string; project?: string; issue_type?: string; priority?: string; status?: string }) =>
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
      board: (project: string) => c.optional<PortalBoard>(`/api/w/portal/projects/${e(project)}/tasks`),
      time: (project: string) => c.optional<PortalTimeReport>(`/api/w/portal/projects/${e(project)}/time`),
      activity: (project: string) => c.optional<{ items: PortalActivityItem[] | null }>(`/api/w/portal/projects/${e(project)}/activity`),
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
