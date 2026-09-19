"use client"

// The platform admin panel and the workspace "Plan & usage" page: contract types, SWR hooks and
// the mutating calls. /api/admin/* is platform-admin only (everyone else gets 404) and never takes
// X-Workspace-ID; /api/w/plan is workspace-scoped (owners/admins).
import useSWR from "swr"

import { api, ApiError, type Role } from "@/lib/api"
import type { Locale } from "@/lib/i18n-locale"
import { intlTag } from "@/lib/i18n-locale"

const noRetryOn4xx = {
  shouldRetryOnError: (err: unknown) => !(err instanceof ApiError && err.status < 500),
  revalidateOnFocus: false,
}

// ── Contract types ───────────────────────────────────────────────────────

export type LimitPolicy = "block" | "overage"
export type LimitKind = "count" | "data" | "monthly" | "rate"

export const LIMIT_KEYS = [
  "members",
  "projects",
  "clients",
  "tasks",
  "issues",
  "teams",
  "feedback_keys",
  "mcp_tokens",
  "storage_mb",
  "issues_per_month",
  "tasks_per_month",
  "api_calls_per_month",
  "api_rate_per_minute",
] as const
export type LimitKey = (typeof LIMIT_KEYS)[number]

export const LIMIT_KINDS: Record<LimitKey, LimitKind> = {
  members: "count",
  projects: "count",
  clients: "count",
  tasks: "count",
  issues: "count",
  teams: "count",
  feedback_keys: "count",
  mcp_tokens: "count",
  storage_mb: "data",
  issues_per_month: "monthly",
  tasks_per_month: "monthly",
  api_calls_per_month: "monthly",
  api_rate_per_minute: "rate",
}

export const INTEGRATIONS = ["github", "jira", "linear"] as const
export const BOOL_FEATURES = ["ai_usage_tracking", "customer_portal", "vault", "kpi"] as const
export type BoolFeature = (typeof BOOL_FEATURES)[number]

export type LimitRule = { limit: number | null; policy: LimitPolicy; unit_price_minor: number; unit_size: number }

export type Features = {
  ai_usage_tracking: boolean
  integrations: string[]
  customer_portal: boolean
  vault: boolean
  kpi: boolean
}

export type Plan = {
  key: string
  name_en: string
  name_ar: string
  description_en: string
  description_ar: string
  currency: string
  base_fee_minor: number
  price_label_en: string
  price_label_ar: string
  active: boolean
  sort: number
  limits: Record<string, LimitRule>
  features: Features
  workspaces: number
}

export type UsageItem = {
  key: string
  kind: LimitKind
  usage: number
  limit: number | null
  policy: LimitPolicy
  over: number
  unit_size: number
  unit_price_minor: number
  overage_minor: number
  overridden: boolean
}

export type WorkspaceStatus = "active" | "suspended"

export type UsageReport = {
  workspace: { id: string; slug: string; name: string; status: WorkspaceStatus; suspended_reason: string | null }
  plan: { key: string; name_en: string; name_ar: string; currency: string; base_fee_minor: number }
  period: string
  items: UsageItem[]
  features: Features
  features_overridden: string[]
  base_fee_minor: number
  overage_minor: number
  estimate_minor: number
  currency: string
  upgrade_contact: string
}

export type AdminUser = {
  id: string
  email: string
  created_at: string
  is_admin: boolean
  status: "active" | "suspended"
  suspended_reason: string | null
  last_seen_at: string | null
  workspaces: { id: string; slug: string; name: string; role: Role; plan: string }[] | null
}

export type AdminWorkspace = {
  id: string
  slug: string
  name: string
  plan: string
  status: WorkspaceStatus
  suspended_reason: string | null
  created_at: string
  owner_email: string | null
  members: number
  projects: number
  usage: UsageItem[] | null
}

export type AdminStats = {
  users: number
  admins: number
  suspended_users: number
  workspaces: number
  suspended_workspaces: number
  active_users_7d: number
  active_users_30d: number
  active_workspaces_7d: number
  active_workspaces_30d: number
  projects: number
  tasks: number
  issues: number
  time_seconds: number
  storage_bytes: number
  plans: { plan: string; name_en: string; name_ar: string; count: number }[] | null
  signups: { day: string; users: number; workspaces: number }[] | null
}

export type Paged = { total: number; page: number; per_page: number }

export type AuditEntry = {
  id: string
  actor_id: string | null
  actor_email: string | null
  action: string
  target_type: string
  target_id: string | null
  target_label: string | null
  changes: Record<string, unknown> | null
  ip: string | null
  via: string | null
  at: string
}

export type Overrides = { limits: Record<string, LimitRule>; features: Partial<Features> }

export type WorkspaceDetail = {
  workspace: AdminWorkspace
  members: { user_id: string; email: string; role: Role; status: string; joined_at: string | null }[] | null
  usage: UsageReport
  overrides: Overrides
  billing?: Billing | null
}

export type PlansResponse = {
  plans: Plan[] | null
  catalog: { key: string; kind: LimitKind; default_unit?: number }[] | null
  integrations: string[] | null
  features?: string[] | null
  polar_products?: Record<string, string> | null
}

// ── Queries ──────────────────────────────────────────────────────────────

function qs(params: Record<string, string | number | undefined | null>) {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v))
  const out = s.toString()
  return out ? `?${out}` : ""
}

function useGet<T>(path: string | null) {
  return useSWR<T>(path, (p: string) => api<T>(p), noRetryOn4xx)
}

/** Whether the signed-in user is a platform admin. 401/404 read as "not an admin". */
export function usePlatform(enabled = true) {
  return useSWR<{ is_admin: boolean }>(
    enabled ? "/api/me/platform" : null,
    async () => {
      try {
        return await api<{ is_admin: boolean }>("/api/me/platform")
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 404 || err.status === 403)) return { is_admin: false }
        throw err
      }
    },
    noRetryOn4xx,
  )
}

export const useAdminStats = () => useGet<AdminStats>("/api/admin/stats")

export const useAdminUsers = (p: { q?: string; status?: string; page: number; per_page?: number }) =>
  useGet<{ users: AdminUser[] | null } & Paged>(`/api/admin/users${qs({ per_page: 25, ...p })}`)

export const useAdminUser = (id: string | undefined) =>
  useGet<{ user: AdminUser; mcp_tokens: number; admin_tokens: number }>(id ? `/api/admin/users/${encodeURIComponent(id)}` : null)

export const useAdminWorkspaces = (p: { q?: string; plan?: string; status?: string; page: number; per_page?: number }) =>
  useGet<{ workspaces: AdminWorkspace[] | null } & Paged>(`/api/admin/workspaces${qs({ per_page: 25, ...p })}`)

export const useAdminWorkspace = (id: string | undefined) =>
  useGet<WorkspaceDetail>(id ? `/api/admin/workspaces/${encodeURIComponent(id)}` : null)

export const useAdminWorkspaceUsage = (id: string | undefined, month: string | null) =>
  useGet<UsageReport>(id && month ? `/api/admin/workspaces/${encodeURIComponent(id)}/usage${qs({ month })}` : null)

export const useAdminPlans = () => useGet<PlansResponse>("/api/admin/plans")

export const useAdminAudit = (p: { q?: string; page: number; per_page?: number }) =>
  useGet<{ entries: AuditEntry[] | null } & Paged>(`/api/admin/audit${qs({ per_page: 50, ...p })}`)

/** The workspace's own plan & usage (owners/admins; others get 403). */
export function useWorkspacePlan(workspaceId: string | undefined) {
  return useSWR<UsageReport>(
    workspaceId ? ["/api/w/plan", workspaceId] : null,
    ([p, id]: [string, string]) => api<UsageReport>(p, { workspaceId: id }),
    noRetryOn4xx,
  )
}

// ── Mutations ────────────────────────────────────────────────────────────

const u = (id: string) => `/api/admin/users/${encodeURIComponent(id)}`
const w = (id: string) => `/api/admin/workspaces/${encodeURIComponent(id)}`

export const adminApi = {
  suspendUser: (id: string, reason: string) => api<{ user: AdminUser }>(`${u(id)}/suspend`, { json: { reason } }),
  reactivateUser: (id: string) => api<{ user: AdminUser }>(`${u(id)}/reactivate`, { method: "POST" }),
  setAdmin: (id: string, admin: boolean) => api<{ user: AdminUser }>(`${u(id)}/admin`, { method: "PUT", json: { admin } }),
  signOutUser: (id: string) => api<{ user: AdminUser }>(`${u(id)}/sign-out`, { method: "POST" }),

  setPlan: (id: string, plan: string) => api<{ usage: UsageReport }>(`${w(id)}/plan`, { method: "PUT", json: { plan } }),
  setOverrides: (id: string, o: Overrides) => api<{ usage: UsageReport }>(`${w(id)}/overrides`, { method: "PUT", json: o }),
  suspendWorkspace: (id: string, reason: string) => api<{ workspace: AdminWorkspace }>(`${w(id)}/suspend`, { json: { reason } }),
  reactivateWorkspace: (id: string) => api<{ workspace: AdminWorkspace }>(`${w(id)}/reactivate`, { method: "POST" }),
  deleteWorkspace: (id: string, confirm: string) => api<void>(`${w(id)}/delete`, { json: { confirm } }),

  createPlan: (p: Omit<Plan, "workspaces">) => api<{ plan: Plan }>("/api/admin/plans", { json: p }),
  updatePlan: (key: string, p: Omit<Plan, "workspaces">) =>
    api<{ plan: Plan }>(`/api/admin/plans/${encodeURIComponent(key)}`, { method: "PUT", json: p }),
  deactivatePlan: (key: string) => api<{ plan: Plan }>(`/api/admin/plans/${encodeURIComponent(key)}/deactivate`, { method: "POST" }),
}

// ── Formatting ───────────────────────────────────────────────────────────

export function num(n: number | null | undefined, locale: Locale): string {
  if (n == null) return "—"
  return new Intl.NumberFormat(intlTag(locale), { numberingSystem: "latn", maximumFractionDigits: 1 }).format(n)
}

/** A usage amount in its kind's unit ("120 MB", "30/min", "4"). */
export function usageAmount(kind: LimitKind, n: number, locale: Locale): string {
  if (kind === "data") return `${num(n, locale)} MB`
  if (kind === "rate") return `${num(n, locale)}/min`
  return num(n, locale)
}

/** Percent of the limit used; null when unlimited. */
export function usagePercent(item: Pick<UsageItem, "usage" | "limit">): number | null {
  if (item.limit == null) return null
  if (item.limit <= 0) return item.usage > 0 ? 100 : 0
  return (item.usage / item.limit) * 100
}

export function planName(p: { name_en: string; name_ar: string } | null | undefined, locale: Locale): string {
  if (!p) return "—"
  return (locale === "ar" ? p.name_ar : p.name_en) || p.name_en || p.name_ar
}

/** "2026-09" for the current month (UTC). */
export function thisMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ["KB", "MB", "GB", "TB"]
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

export function emptyFeatures(): Features {
  return { ai_usage_tracking: false, integrations: [], customer_portal: false, vault: false, kpi: false }
}

export function defaultRule(): LimitRule {
  return { limit: null, policy: "block", unit_price_minor: 0, unit_size: 1 }
}

// ── Billing (Polar) ──────────────────────────────────────────────────────

export type BillingStatus = "active" | "past_due" | "canceled" | "revoked" | "expired"

export type Billing = {
  status: BillingStatus | null
  period_end: string | null
  cancel_at_period_end: boolean
  polar_customer_id: string | null
  polar_subscription_id: string | null
  updated_at: string | null
  last_webhook_at: string | null
  last_webhook_type: string | null
}

export type BillablePlan = {
  key: string
  name_en: string
  name_ar: string
  price_label_en: string
  price_label_ar: string
  base_fee_minor: number
  currency: string
  purchasable: boolean
}

export type BillingResponse = { configured: boolean; billing: Billing | null; plans: BillablePlan[] | null }

export function useWorkspaceBilling(workspaceId: string | undefined) {
  return useSWR<BillingResponse>(
    workspaceId ? ["/api/w/billing", workspaceId] : null,
    ([p, id]: [string, string]) => api<BillingResponse>(p, { workspaceId: id }),
    noRetryOn4xx,
  )
}

export const billingApi = {
  checkout: (workspaceId: string, plan: string, locale: Locale) =>
    api<{ url: string }>("/api/w/billing/checkout", { json: { plan, locale }, workspaceId }),
  portal: (workspaceId: string) => api<{ url: string }>("/api/w/billing/portal", { method: "POST", workspaceId }),
  polarSync: (dryRun: boolean) => api<{ dry_run: boolean; actions: string[] | null }>("/api/admin/billing/polar-sync", { json: { dry_run: dryRun } }),
}

export const POLAR_CUSTOMER_URL = (id: string) => `https://polar.sh/dashboard/3x1io/customers/${encodeURIComponent(id)}`
