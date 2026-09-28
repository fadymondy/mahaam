// API methods owned by the reports feature. Spread into makeApi (api.ts); the keys join the IPC allowlist.
//
// Contract: internal/work/routes_reports.go, reports.go, saved.go. Lists travel comma-separated in
// the query; the saved views store them as arrays (ReportQuery). The export is binary (XLSX/PDF), so
// it is fetched here with the session's token and handed to the renderer as bytes plus the server's
// Content-Disposition file name.
import { ApiError, type MahaamClient } from "@mahaam/client";

export const REPORT_GROUPS = ["project", "member", "client", "label", "task", "day", "week"] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];
export type ReportKind = "time" | "budget" | "profitability";
export type ExportFormat = "csv" | "xlsx" | "pdf" | "md";

/** The filters (ReportQuery). Empty parts are dropped before they travel. */
export interface ReportFilters {
  from?: string;
  to?: string;
  group_by?: ReportGroup;
  users?: string[];
  projects?: string[];
  clients?: string[];
  labels?: string[];
  billable?: "billable" | "non_billable" | "";
  /** Minutes; null = the workspace setting. */
  rounding?: number | null;
}

export interface ReportRow {
  key: string;
  name: string;
  color?: string | null;
  seconds: number;
  rounded_s: number;
  billable_s: number;
  billable_rounded_s: number;
  entries: number;
  billable_minor?: number | null;
  cost_minor?: number | null;
  profit_minor?: number | null;
}

export interface ReportPoint {
  day: string;
  rounded_s: number;
  billable_rounded_s: number;
  non_billable_rounded_s: number;
}

export interface TimeReport {
  from: string;
  to: string;
  group_by: ReportGroup;
  timezone: string;
  week_start: number;
  rounding_minutes: number;
  currency: string;
  finance: boolean;
  own_time_only: boolean;
  rows: ReportRow[] | null;
  total: ReportRow;
  series: ReportPoint[] | null;
  other_currency_entries: number;
  generated_at: string;
}

export type BudgetLevel = "none" | "ok" | "warning" | "over";

export interface Budget {
  project_id: string;
  project_name: string;
  project_color: string;
  client_name: string | null;
  billing_mode: string;
  archived: boolean;
  budget_minutes: number | null;
  spent_s: number;
  hours_percent: number | null;
  budget_minor?: number | null;
  spent_minor?: number | null;
  money_percent?: number | null;
  currency: string;
  level: BudgetLevel;
}

export interface BudgetList {
  budgets: Budget[] | null;
  finance: boolean;
}

export interface ProfitRow {
  key: string;
  name: string;
  color?: string | null;
  rounded_s: number;
  billable_rounded_s: number;
  billable_minor: number;
  cost_minor: number;
  profit_minor: number;
  margin_percent: number | null;
}

export interface Profitability {
  from: string;
  to: string;
  currency: string;
  rounding_minutes: number;
  projects: ProfitRow[] | null;
  clients: ProfitRow[] | null;
  total: ProfitRow;
  other_currency_entries: number;
}

export interface SavedReport {
  id: string;
  owner_id: string;
  name: string;
  kind: ReportKind;
  filters: ReportFilters;
  shared: boolean;
  mine: boolean;
  created_at: string;
  updated_at: string;
}

export interface SavedReportInput {
  name?: string;
  kind?: ReportKind;
  filters?: ReportFilters;
  shared?: boolean;
}

export interface ExportRequest {
  kind?: "time" | "profitability";
  by?: "project" | "client";
  format: ExportFormat;
  lang?: "en" | "ar";
  filters: ReportFilters;
}

export interface ExportFile {
  name: string;
  contentType: string;
  data: Uint8Array;
}

export interface ReportClient {
  id: string;
  name: string;
}

/** Filters as the API's query parameters (ReportParams). */
export function reportQuery(f: ReportFilters): Record<string, string | undefined> {
  const list = (v?: string[]) => (v && v.length ? v.join(",") : undefined);
  return {
    from: f.from || undefined,
    to: f.to || undefined,
    group_by: f.group_by || undefined,
    users: list(f.users),
    projects: list(f.projects),
    clients: list(f.clients),
    labels: list(f.labels),
    billable: f.billable || undefined,
    rounding: f.rounding != null && f.rounding >= 0 ? String(f.rounding) : undefined,
  };
}

const e = encodeURIComponent;

export function reportsApi(c: MahaamClient) {
  const send = <T>(method: string, path: string, body?: unknown) => c.request<T>(method, path, { body: body ?? {} });

  async function fetchExport(req: ExportRequest, retried = false): Promise<ExportFile> {
    const u = new URL(c.baseUrl + "/api/w/report/export");
    const q: Record<string, string | undefined> = {
      ...reportQuery(req.filters),
      kind: req.kind,
      by: req.by,
      format: req.format,
      lang: req.lang,
    };
    for (const [k, v] of Object.entries(q)) if (v) u.searchParams.set(k, v);
    if (!c.workspace) throw new ApiError(0, "no workspace selected");
    const headers: Record<string, string> = { "X-Workspace-ID": c.workspace };
    if (c.token) headers.Authorization = `Bearer ${c.token}`;
    const res = await fetch(u.toString(), { headers, cache: "no-store" });
    if (res.status === 401 && !retried) {
      // A cheap authenticated call lets the client re-log in (it owns that), then try once more.
      await c.request("GET", "/api/auth/me").catch(() => undefined);
      return fetchExport(req, true);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = `HTTP ${res.status}`;
      let body: unknown = text;
      try {
        const d = JSON.parse(text) as { error?: string; detail?: string; title?: string };
        body = d;
        msg = d.error ?? d.detail ?? d.title ?? msg;
      } catch {
        /* not JSON */
      }
      throw new ApiError(res.status, msg, body);
    }
    const cd = res.headers.get("content-disposition") ?? "";
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const plain = /filename="?([^";]+)"?/i.exec(cd);
    const name = star?.[1] ? decodeURIComponent(star[1]) : (plain?.[1] ?? `mahaam-report.${req.format}`);
    return { name, contentType: res.headers.get("content-type") ?? "application/octet-stream", data: new Uint8Array(await res.arrayBuffer()) };
  }

  return {
    timeReport: (f: ReportFilters) => c.request<TimeReport>("GET", "/api/w/report/time", { query: reportQuery(f) }),
    budgets: () => c.request<BudgetList>("GET", "/api/w/report/budgets"),
    profitability: (f: ReportFilters) =>
      c.request<Profitability>("GET", "/api/w/report/profitability", {
        query: reportQuery({ from: f.from, to: f.to, projects: f.projects, clients: f.clients, rounding: f.rounding }),
      }),
    exportReport: (req: ExportRequest) => fetchExport(req),
    savedReports: async () => (await c.request<{ reports: SavedReport[] | null }>("GET", "/api/w/saved-reports")).reports ?? [],
    createSavedReport: (input: SavedReportInput) => send<SavedReport>("POST", "/api/w/saved-reports", input),
    updateSavedReport: (id: string, input: SavedReportInput) => send<SavedReport>("PATCH", `/api/w/saved-reports/${e(id)}`, input),
    deleteSavedReport: (id: string) => c.request<void>("DELETE", `/api/w/saved-reports/${e(id)}`),
    /** Clients for the filter (clients:read — manager+; others get 403 and no client filter). */
    reportClients: async () =>
      ((await c.request<{ clients: ReportClient[] | null }>("GET", "/api/w/clients")).clients ?? []).map((x) => ({ id: x.id, name: x.name })),
  };
}
