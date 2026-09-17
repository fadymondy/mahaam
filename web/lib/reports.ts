"use client"

// P5 reports: contract types (mirror internal/work/reports.go, saved.go, email.go), SWR hooks for
// /api/w/report/*, saved views and notification settings, the URL <-> filter mapping and the
// cell formatting shared with the export (internal/work/export.go: HM, Hours, Money).
import useSWR from "swr"

import { api, ApiError } from "@/lib/api"
import { addDays } from "@/lib/time"

// ── contract ─────────────────────────────────────────────────────────────────

export const GROUPS = ["project", "member", "client", "label", "task", "day", "week"] as const
export type GroupBy = (typeof GROUPS)[number]

export type ReportRow = {
  key: string
  name: string
  color?: string | null
  seconds: number
  rounded_s: number
  billable_s: number
  billable_rounded_s: number
  entries: number
  billable_minor?: number | null
  cost_minor?: number | null
  profit_minor?: number | null
}

export type ReportPoint = { day: string; rounded_s: number; billable_rounded_s: number; non_billable_rounded_s: number }

export type TimeReport = {
  from: string
  to: string
  group_by: GroupBy
  timezone: string
  week_start: number
  rounding_minutes: number
  currency: string
  finance: boolean
  own_time_only: boolean
  rows: ReportRow[]
  total: ReportRow
  series: ReportPoint[]
  other_currency_entries: number
  generated_at: string
}

export type BudgetLevel = "none" | "ok" | "warning" | "over"

export type Budget = {
  project_id: string
  project_name: string
  project_color: string
  client_name: string | null
  billing_mode: string
  archived: boolean
  budget_minutes: number | null
  spent_s: number
  hours_percent: number | null
  budget_minor?: number | null
  spent_minor?: number | null
  money_percent?: number | null
  currency: string
  level: BudgetLevel
}

export type BudgetList = { finance: boolean; budgets: Budget[] }

export type ProfitRow = {
  key: string
  name: string
  color?: string | null
  rounded_s: number
  billable_rounded_s: number
  billable_minor: number
  cost_minor: number
  profit_minor: number
  margin_percent: number | null
}

export type Profitability = {
  from: string
  to: string
  currency: string
  rounding_minutes: number
  projects: ProfitRow[]
  clients: ProfitRow[]
  total: ProfitRow
  other_currency_entries: number
}

export type ReportKind = "time" | "budget" | "profitability"

export type Filters = {
  from?: string
  to?: string
  group_by?: GroupBy
  users?: string[]
  projects?: string[]
  clients?: string[]
  labels?: string[]
  billable?: "billable" | "non_billable" | ""
  rounding?: number | null
}

export type SavedReport = {
  id: string
  owner_id: string
  name: string
  kind: ReportKind
  filters: Filters
  shared: boolean
  mine: boolean
  created_at: string
  updated_at: string
}

export type NotificationSettings = {
  email_enabled: boolean
  digest_enabled: boolean
  digest_hour: number
  muted_kinds: string[]
  kinds: string[]
  timezone: string
  email: { configured: boolean; driver: string }
  address: string
}

// ── filters <-> query string ─────────────────────────────────────────────────

const list = (v: string | null) => (v ? v.split(",").filter(Boolean) : [])

/** The page's filters from its URL (the URL is the state: shareable, reloadable, printable). */
export function filtersFrom(params: URLSearchParams): Filters {
  const g = params.get("group_by")
  const b = params.get("billable")
  const r = params.get("rounding")
  return {
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    group_by: GROUPS.includes(g as GroupBy) ? (g as GroupBy) : "project",
    users: list(params.get("users")),
    projects: list(params.get("projects")),
    clients: list(params.get("clients")),
    labels: list(params.get("labels")),
    billable: b === "billable" || b === "non_billable" ? b : "",
    rounding: r != null && r !== "" && Number(r) >= 0 ? Number(r) : null,
  }
}

/** Filters as API query parameters (also the page URL). */
export function filterQuery(f: Filters, extra: Record<string, string> = {}) {
  const s = new URLSearchParams()
  if (f.from) s.set("from", f.from)
  if (f.to) s.set("to", f.to)
  if (f.group_by) s.set("group_by", f.group_by)
  for (const k of ["users", "projects", "clients", "labels"] as const) if (f[k]?.length) s.set(k, f[k]!.join(","))
  if (f.billable) s.set("billable", f.billable)
  if (f.rounding != null && f.rounding >= 0) s.set("rounding", String(f.rounding))
  for (const [k, v] of Object.entries(extra)) s.set(k, v)
  return s.toString()
}

/** A saved view's filters with empty parts dropped (what the API stores). */
export function cleanFilters(f: Filters): Filters {
  const out: Filters = {}
  if (f.from) out.from = f.from
  if (f.to) out.to = f.to
  if (f.group_by) out.group_by = f.group_by
  for (const k of ["users", "projects", "clients", "labels"] as const) if (f[k]?.length) out[k] = f[k]
  if (f.billable) out.billable = f.billable
  if (f.rounding != null && f.rounding >= 0) out.rounding = f.rounding
  return out
}

// ── date presets (calendar days in the workspace timezone) ───────────────────

export type Preset = "this_week" | "last_week" | "this_month" | "last_month" | "custom"
export const PRESETS: Preset[] = ["this_week", "last_week", "this_month", "last_month", "custom"]

function weekday(day: string) {
  return new Date(day + "T00:00:00Z").getUTCDay()
}

export function presetRange(p: Exclude<Preset, "custom">, today: string, weekStart: number): { from: string; to: string } {
  const back = (weekday(today) - weekStart + 7) % 7
  const monday = addDays(today, -back)
  switch (p) {
    case "this_week":
      return { from: monday, to: addDays(monday, 6) }
    case "last_week":
      return { from: addDays(monday, -7), to: addDays(monday, -1) }
    case "this_month": {
      const first = today.slice(0, 8) + "01"
      return { from: first, to: lastOfMonth(first) }
    }
    case "last_month": {
      const first = today.slice(0, 8) + "01"
      const prev = addDays(first, -1)
      return { from: prev.slice(0, 8) + "01", to: prev }
    }
  }
}

function lastOfMonth(first: string) {
  const d = new Date(first + "T00:00:00Z")
  d.setUTCMonth(d.getUTCMonth() + 1, 0)
  return d.toISOString().slice(0, 10)
}

/** Which preset a range is, or "custom". */
export function presetOf(from: string | undefined, to: string | undefined, today: string, weekStart: number): Preset {
  if (!from || !to) return "this_month"
  for (const p of PRESETS) {
    if (p === "custom") continue
    const r = presetRange(p, today, weekStart)
    if (r.from === from && r.to === to) return p
  }
  return "custom"
}

// ── cell formatting: identical to the export (internal/work/export.go) ───────

/** h:mm, minutes truncated; 0 -> "0:00" (Go: HM). */
export function hmCell(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`
}

/** Decimal hours with two places (Go: Hours). */
export function hoursCell(sec: number) {
  return (sec / 3600).toFixed(2)
}

/** Minor units as "1234.50" / "-12.00" (Go: Money). No grouping, so it matches the file. */
export function moneyCell(minor: number | null | undefined) {
  if (minor == null) return ""
  const sign = minor < 0 ? "-" : ""
  const m = Math.abs(Math.trunc(minor))
  return `${sign}${Math.floor(m / 100)}.${String(m % 100).padStart(2, "0")}`
}

export function percentCell(p: number | null | undefined) {
  return p == null ? "" : p.toFixed(1)
}

// ── hooks ────────────────────────────────────────────────────────────────────

const opts = {
  shouldRetryOnError: (err: unknown) => !(err instanceof ApiError && err.status < 500),
  revalidateOnFocus: false,
  keepPreviousData: true,
}

function useW<T>(path: string | null, ws: string | null | undefined) {
  return useSWR<T>(path && ws ? [path, ws] : null, ([p, id]: [string, string]) => api<T>(p, { workspaceId: id }), opts)
}

export const useTimeReport = (ws: string, q: string, enabled = true) => useW<TimeReport>(enabled ? `/api/w/report/time?${q}` : null, ws)
export const useBudgets = (ws: string, enabled = true) => useW<BudgetList>(enabled ? "/api/w/report/budgets" : null, ws)
export const useProjectBudget = (ws: string, project: string | null) =>
  useW<Budget>(project ? `/api/w/projects/${encodeURIComponent(project)}/budget` : null, ws)
export const useProfitability = (ws: string, q: string, enabled: boolean) =>
  useW<Profitability>(enabled ? `/api/w/report/profitability?${q}` : null, ws)
export const useSavedReports = (ws: string, enabled = true) => useW<{ reports: SavedReport[] }>(enabled ? "/api/w/saved-reports" : null, ws)
export const useSavedReport = (ws: string, id: string | null, enabled = true) =>
  useW<SavedReport>(id && enabled ? `/api/w/saved-reports/${encodeURIComponent(id)}` : null, ws)
export const useNotificationSettings = (ws: string) => useW<NotificationSettings>("/api/w/notification-settings", ws)

export type SavedInput = { name?: string; kind?: ReportKind; filters?: Filters; shared?: boolean }

export const reportsApi = {
  save: (ws: string, body: SavedInput) => api<SavedReport>("/api/w/saved-reports", { method: "POST", json: body, workspaceId: ws }),
  update: (ws: string, id: string, body: SavedInput) =>
    api<SavedReport>(`/api/w/saved-reports/${encodeURIComponent(id)}`, { method: "PATCH", json: body, workspaceId: ws }),
  remove: (ws: string, id: string) => api<void>(`/api/w/saved-reports/${encodeURIComponent(id)}`, { method: "DELETE", workspaceId: ws }),
  notificationSettings: (ws: string, body: Partial<Pick<NotificationSettings, "email_enabled" | "digest_enabled" | "digest_hour" | "muted_kinds">>) =>
    api<NotificationSettings>("/api/w/notification-settings", { method: "PATCH", json: body, workspaceId: ws }),
}

export const exportPath = (query: string) => `/api/w/report/export?${query}`

/*
  The export is a GET, but the workspace travels only in X-Workspace-ID (internal/tenant.Require
  reads no query parameter), so a plain <a href download> answers 404. It is fetched with the header
  and saved from a blob under the server's Content-Disposition file name.
*/
export async function downloadExport(ws: string, query: string): Promise<string> {
  const res = await fetch(exportPath(query), {
    headers: { "X-Workspace-ID": ws },
    credentials: "same-origin",
    cache: "no-store",
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = ((await res.json()) as { error?: string; detail?: string }).error ?? msg
    } catch {}
    throw new ApiError(res.status, msg || `Export failed (${res.status})`)
  }
  const cd = res.headers.get("content-disposition") ?? ""
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  const plain = /filename="?([^";]+)"?/i.exec(cd)
  const name = star ? decodeURIComponent(star[1]) : (plain?.[1] ?? "managy-report")
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return name
}
