// API methods owned by the project feature (Overview, Settings and Reports tabs). Spread into
// makeApi (api.ts); the keys join the IPC allowlist.
import { ApiError, type MahaamClient } from "@mahaam/client";

import type { components } from "../../../shared/src/openapi";
import type { ProjectDetail, Status } from "../shared/types";

type S = components["schemas"];
type Clean<T> = Omit<T, "$schema">;

export type ProjectInput = Omit<Clean<S["ProjectInput"]>, "$schema">;
export type StatusInput = Omit<Clean<S["StatusInput"]>, "$schema">;
export type ProjectLabel = Clean<S["ProjectLabel"]>;
export type Team = Clean<S["Team"]>;
export type Budget = Clean<S["Budget"]>;
export type ReportRow = Clean<S["ReportRow"]>;
export type TimeReport = Clean<S["TimeReport"]>;

export type ReportGroup = "member" | "task" | "label" | "day" | "week";

export interface ProjectTimeQuery {
  from?: string;
  to?: string;
  group_by?: ReportGroup;
  billable?: "billable" | "non_billable";
}

/** A downloaded file, carried over IPC as base64. */
export interface DownloadedFile {
  name: string;
  type: string;
  base64: string;
}

const e = encodeURIComponent;

export function projectApi(c: MahaamClient) {
  const get = <T>(path: string, query?: Record<string, string | number | boolean | undefined>) => c.request<T>("GET", path, { query });
  const send = <T>(method: string, path: string, body?: unknown) => c.request<T>(method, path, { body: body ?? {} });

  /** Binary-safe GET (the client's request() reads text, which would mangle XLSX/PDF). */
  const download = async (path: string, query: Record<string, string | undefined>, fallbackName: string): Promise<DownloadedFile> => {
    // Refresh a token about to expire, the client's own way (the method is private to its class).
    await (c as unknown as { ensureFresh?: () => Promise<void> }).ensureFresh?.();
    const u = new URL(c.baseUrl + path);
    for (const [k, v] of Object.entries(query)) if (v) u.searchParams.set(k, v);
    const headers: Record<string, string> = {};
    if (c.token) headers.Authorization = `Bearer ${c.token}`;
    if (c.workspace) headers["X-Workspace-ID"] = c.workspace;
    const res = await fetch(u, { headers });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const d = JSON.parse(buf.toString("utf8")) as { detail?: string; title?: string; error?: string };
        msg = d.error ?? d.detail ?? d.title ?? msg;
      } catch {
        /* not JSON */
      }
      throw new ApiError(res.status, msg);
    }
    const disp = res.headers.get("content-disposition") ?? "";
    const m = /filename\*=UTF-8''([^;]+)/i.exec(disp) ?? /filename="?([^";]+)"?/i.exec(disp);
    const name = m ? decodeURIComponent(m[1]!) : fallbackName;
    return { name, type: res.headers.get("content-type") ?? "application/octet-stream", base64: buf.toString("base64") };
  };

  return {
    // ── settings ──
    updateProject: (id: string, patch: ProjectInput) => send<ProjectDetail>("PATCH", `/api/w/projects/${e(id)}`, patch),
    archiveProject: (id: string) => send<ProjectDetail>("POST", `/api/w/projects/${e(id)}/archive`),
    restoreProject: (id: string) => send<ProjectDetail>("POST", `/api/w/projects/${e(id)}/restore`),
    putProjectMember: (id: string, userId: string, role: "lead" | "member") =>
      send<ProjectDetail>("PUT", `/api/w/projects/${e(id)}/members/${e(userId)}`, { role }),
    removeProjectMember: (id: string, userId: string) => c.request<ProjectDetail>("DELETE", `/api/w/projects/${e(id)}/members/${e(userId)}`),
    attachProjectTeam: (id: string, teamId: string) => send<ProjectDetail>("PUT", `/api/w/projects/${e(id)}/teams/${e(teamId)}`),
    detachProjectTeam: (id: string, teamId: string) => c.request<ProjectDetail>("DELETE", `/api/w/projects/${e(id)}/teams/${e(teamId)}`),
    projectTeams: async () => (await get<{ teams: Team[] | null }>("/api/w/teams")).teams ?? [],
    createStatus: (projectId: string, input: StatusInput) => send<Status>("POST", `/api/w/projects/${e(projectId)}/statuses`, input),
    updateStatus: (statusId: string, patch: StatusInput) => send<Status>("PATCH", `/api/w/statuses/${e(statusId)}`, patch),
    deleteStatus: (statusId: string, moveTo?: string) => c.request<void>("DELETE", `/api/w/statuses/${e(statusId)}`, { query: { move_to: moveTo } }),
    projectLabels: async (id: string) => (await get<{ labels: ProjectLabel[] | null }>(`/api/w/projects/${e(id)}/project-labels`)).labels ?? [],
    setProjectLabels: async (id: string, labels: string[]) =>
      (await send<{ labels: ProjectLabel[] | null }>("PUT", `/api/w/projects/${e(id)}/project-labels`, { labels })).labels ?? [],

    // ── overview / reports ──
    projectBudget: (id: string) => get<Budget>(`/api/w/projects/${e(id)}/budget`),
    projectTimeReport: (id: string, q: ProjectTimeQuery = {}) => get<TimeReport>("/api/w/report/time", { ...q, projects: id }),
    exportProjectTime: (id: string, q: ProjectTimeQuery & { format: "csv" | "xlsx" | "pdf" | "md"; lang: "en" | "ar" }) =>
      download(
        "/api/w/report/export",
        { kind: "time", projects: id, from: q.from, to: q.to, group_by: q.group_by, billable: q.billable, format: q.format, lang: q.lang },
        `time-report.${q.format}`,
      ),
    exportProjectReport: (id: string, q: { format: "pdf" | "md"; lang: "en" | "ar"; from?: string; to?: string }) =>
      download(`/api/w/projects/${e(id)}/report`, { format: q.format, lang: q.lang, from: q.from, to: q.to }, `project-report.${q.format}`),
  };
}
