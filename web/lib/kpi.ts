"use client"

// Contract types (mirror internal/work/kpi.go, github_accounts.go) and SWR hooks for the employee
// KPI, manager reviews and per-user GitHub accounts.
import useSWR from "swr"

import { api, ApiError } from "@/lib/api"

export type KPIKeyed = {
  key: string
  name: string
  seconds?: number
  billable_s?: number
  count?: number
  tokens?: number
  cost_minor?: number
  commits?: number
  pull_requests?: number
  deployments?: number
}

export type GitHubAccount = {
  user_id: string
  login: string
  github_id: number | null
  emails: string[] | null
  connected_via: "oauth" | "manual"
  connected_at: string
}

export type GitHubStatus = { account: GitHubAccount | null; oauth_available: boolean }

export type MemberReview = {
  id: string
  user_id: string
  author_id: string
  author_email: string
  period_start: string
  period_end: string
  rating: number | null
  body: string
  created_at: string
}

export type KPI = {
  member: { user_id: string; email: string; role: string }
  from: string
  to: string
  timezone: string
  github_account: GitHubAccount | null
  time: { tracked_s: number; billable_s: number; entries: number; days_tracked: number; by_project: KPIKeyed[] | null; by_week: KPIKeyed[] | null }
  tasks: { completed: number; completed_late: number; open_assigned: number; overdue: number }
  issues: {
    started: number
    reviewed: number
    approvals_requested: number
    finished: number
    worked: number
    agent_seconds: number
    agent_comments: number
    mentions_answered: number
  }
  ai: {
    input_tokens: number
    output_tokens: number
    cache_tokens: number
    requests: number
    cost_minor: number | null
    currency: string
    by_model?: KPIKeyed[] | null
    by_project?: KPIKeyed[] | null
  }
  github: {
    connected: boolean
    login?: string
    commits: number
    pull_requests: number
    prs_merged: number
    deployments: number
    deployments_succeeded: number
    workflow_runs: number
    by_project?: KPIKeyed[] | null
    by_repo?: KPIKeyed[] | null
  }
  activity: { actions: number; mcp_actions: number; mcp_tokens: number; by_action?: KPIKeyed[] | null }
  reviews: { count: number; avg_rating: number | null; items?: MemberReview[] | null }
  finance: boolean
}

export type TeamKPIRow = {
  member: { user_id: string; email: string; role: string }
  github_login?: string
  tracked_s: number
  billable_s: number
  days_tracked: number
  tasks_completed: number
  tasks_open: number
  tasks_overdue: number
  issues_finished: number
  agent_seconds: number
  ai_tokens: number
  ai_cost_minor: number | null
  commits: number
  pull_requests: number
  prs_merged: number
  deployments: number
  mcp_actions: number
  reviews: number
  avg_rating: number | null
}

export type TeamKPI = { from: string; to: string; timezone: string; currency: string; finance: boolean; rows: TeamKPIRow[] | null }

const opts = {
  shouldRetryOnError: (err: unknown) => !(err instanceof ApiError && err.status < 500),
  revalidateOnFocus: false,
}

const range = (from: string, to: string) => `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`

function useW<T>(path: string | null, ws: string) {
  return useSWR<T>(path ? [path, ws] : null, ([p, id]: [string, string]) => api<T>(p, { workspaceId: id }), opts)
}

export const useMemberKPI = (ws: string, user: string | null, from: string, to: string) =>
  useW<KPI>(user ? `/api/w/members/${encodeURIComponent(user)}/kpi${range(from, to)}` : null, ws)

export const useTeamKPI = (ws: string, from: string, to: string, enabled = true) =>
  useW<TeamKPI>(enabled ? `/api/w/kpi/team${range(from, to)}` : null, ws)

export const useGitHubStatus = (ws: string, user: string | null) =>
  useW<GitHubStatus>(user ? (user === "me" ? "/api/w/me/github" : `/api/w/members/${encodeURIComponent(user)}/github`) : null, ws)

export const kpiApi = {
  dossier: (ws: string, user: string, from: string, to: string) =>
    api<{ markdown: string; prompt: string }>(`/api/w/members/${encodeURIComponent(user)}/kpi/dossier${range(from, to)}`, { workspaceId: ws }),
  connect: (ws: string, locale: string) => api<{ url: string }>(`/api/w/me/github/connect?locale=${locale}`, { workspaceId: ws }),
  disconnectMine: (ws: string) => api<void>("/api/w/me/github", { method: "DELETE", workspaceId: ws }),
  mapMember: (ws: string, user: string, login: string, emails: string[]) =>
    api<GitHubStatus>(`/api/w/members/${encodeURIComponent(user)}/github`, { method: "PUT", json: { login, emails }, workspaceId: ws }),
  unmapMember: (ws: string, user: string) => api<void>(`/api/w/members/${encodeURIComponent(user)}/github`, { method: "DELETE", workspaceId: ws }),
  addReview: (ws: string, user: string, body: { period_start: string; period_end: string; rating?: number; body: string }) =>
    api<MemberReview>(`/api/w/members/${encodeURIComponent(user)}/reviews`, { method: "POST", json: body, workspaceId: ws }),
  deleteReview: (ws: string, id: string) => api<void>(`/api/w/reviews/${encodeURIComponent(id)}`, { method: "DELETE", workspaceId: ws }),
}

/** The default range: the 1st of this month to today (local calendar). */
export function defaultRange(): { from: string; to: string } {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const to = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return { from: `${to.slice(0, 8)}01`, to }
}

/** 1234567 -> "1.2M" (Latin digits). */
export function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}
