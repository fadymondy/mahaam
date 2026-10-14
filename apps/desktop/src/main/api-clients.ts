// API methods owned by the clients feature. Spread into makeApi (api.ts); the keys join the IPC allowlist.
// Paths and fields mirror internal/work/routes.go (clients), routes_client_import.go, routes_invoices.go
// (client invoices / unbilled) and routes_reports.go (the client's time).
import type { MahaamClient } from "@mahaam/client";

const e = encodeURIComponent;

export type Client = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company?: string | null;
  country: string | null;
  currency: string;
  default_rate_minor: number | null;
  notes: string | null;
  archived_at: string | null;
  project_count: number;
  created_at: string;
};

/** POST/PATCH body. default_rate_minor -1 clears the rate. */
export type ClientInput = {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  country?: string;
  currency?: string;
  notes?: string;
  default_rate_minor?: number;
};

export type ClientInvoice = {
  id: string;
  number: string;
  client_id: string;
  status: string;
  currency: string;
  issue_date: string;
  due_date: string | null;
  total_minor: number;
};

export type Unbilled = { currency: string; seconds: number; amount_minor: number; entry_count: number };

export type ClientTime = { total: { seconds: number; billable_rounded_s: number } };

export type ImportSource = "csv" | "xlsx" | "google_csv" | "vcard" | "google" | "whatsapp_api";
export type ImportRowError = { row: number; column?: string; message: string };
export type ImportRow = {
  row: number;
  action: "create" | "update" | "skip" | "invalid";
  client_id?: string;
  match?: "email" | "phone";
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  changes?: string[];
  reason?: string;
  errors?: ImportRowError[];
};
export type ImportCounts = { total: number; create: number; update: number; skip: number; invalid: number };
export type ImportPreview = { headers: string[] | null; header_row: number; mapping: Record<string, string> | null; fields: string[]; rows: ImportRow[] | null; counts: ImportCounts };
export type ImportResult = { rows: ImportRow[] | null; counts: ImportCounts };
export type ImportSources = { google: boolean; whatsapp_api: boolean; max_rows: number; max_bytes: number };
export type ImportInput = {
  source: ImportSource;
  content?: string;
  content_base64?: string;
  session?: string;
  mapping?: Record<string, string>;
  update_existing?: boolean;
};

export function clientsApi(c: MahaamClient) {
  const send = <T>(method: string, path: string, body?: unknown) => c.request<T>(method, path, { body: body ?? {} });
  return {
    clients: async (archived = false) =>
      (await c.request<{ clients: Client[] | null }>("GET", "/api/w/clients", { query: { archived: archived ? "true" : undefined } })).clients ?? [],
    client: (id: string) => c.request<Client>("GET", `/api/w/clients/${e(id)}`),
    createClient: (input: ClientInput) => send<Client>("POST", "/api/w/clients", input),
    updateClient: (id: string, input: ClientInput) => send<Client>("PATCH", `/api/w/clients/${e(id)}`, input),
    archiveClient: (id: string) => send<Client>("POST", `/api/w/clients/${e(id)}/archive`),
    restoreClient: (id: string) => send<Client>("POST", `/api/w/clients/${e(id)}/restore`),
    clientInvoices: async (id: string) =>
      (await c.request<{ invoices: ClientInvoice[] | null }>("GET", `/api/w/clients/${e(id)}/invoices`)).invoices ?? [],
    clientUnbilled: (id: string) => c.request<Unbilled>("GET", `/api/w/clients/${e(id)}/unbilled`),
    clientTime: (id: string) => c.request<ClientTime>("GET", "/api/w/report/time", { query: { clients: id, group_by: "project" } }),
    clientImportSources: () => c.request<ImportSources>("GET", "/api/w/clients/import/sources"),
    clientImportPreview: (input: ImportInput) => send<ImportPreview>("POST", "/api/w/clients/import/preview", input),
    clientImportCommit: (input: ImportInput) => send<ImportResult>("POST", "/api/w/clients/import/commit", input),
  };
}
