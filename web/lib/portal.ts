"use client"

// The customer portal (roadmap 5): the client's project panel, their issue control and the
// request portal, plus the staff Requests inbox. Mirrors internal/work/portal_panel.go and
// internal/reports/{portal_panel,requests}.go.
import useSWR from "swr"

import { ApiError, api } from "@/lib/api"
import type { TaskCounts } from "@/lib/work"

export type PortalProject = {
  id: string
  name: string
  description: string | null
  color: string
  status: string
  starts_on: string | null
  ends_on: string | null
  client_name: string | null
  archived: boolean
  tasks: TaskCounts
  percent_done: number
  budget_minutes: number | null
  used_minutes: number
  open_issues: number
  pending_requests: number
}

export type PortalWeek = { week: string; minutes: number }

export type PortalInvoice = {
  id: string
  number: string
  status: string
  currency: string
  total_minor: number
  paid_minor: number
  issue_date: string
  due_date: string | null
}

export type PortalIssue = {
  key: string
  title: string
  body: string | null
  status: string
  state: string
  priority: string
  issue_type: string
  source: string
  resolution: string | null
  project_id: string | null
  screenshot: string | null
  mine: boolean
  comment_count: number
  can_accept: boolean
  can_reopen: boolean
  closed_at: string | null
  created_at: string
  updated_at: string
}

export type PortalComment = { id: string; author_kind: string; mine: boolean; body: string; created_at: string }
export type PortalIssueDetail = PortalIssue & { comments: PortalComment[] }

export const REQUEST_KINDS = ["feature", "change", "bug"] as const
export type RequestKind = (typeof REQUEST_KINDS)[number]
export type RequestState = "pending" | "accepted" | "declined" | "converted"

export type CustomerRequest = {
  key: string
  title: string
  body: string | null
  kind: RequestKind
  state: RequestState
  reply: string | null
  desired_on: string | null
  project_id: string | null
  project_name: string | null
  reporter_id: string | null
  mine: boolean
  status: string
  priority: string
  issue_type: string
  screenshot: string | null
  issue_state: string
  task_key: string | null
  decided_at: string | null
  created_at: string
  updated_at: string
}

export type RequestEvent = { state: RequestState; at: string; by: string | null; note: string | null }
export type RequestComment = { id: string; author_id: string | null; author_kind: string; body: string; created_at: string }
export type RequestDetail = CustomerRequest & {
  reporter_email: string | null
  history: RequestEvent[]
  comments: RequestComment[]
  task_project_id: string | null
}
export type RequestCounts = { pending: number; accepted: number; declined: number; converted: number; all: number }

export type PortalShare = { board: boolean; team: boolean; money: boolean }
export type PortalPerson = { name: string; initials: string; role?: string }
export type PortalColumn = { id: string; name: string; color: string; category: string; task_count: number }
export type PortalLabel = { name: string; color: string }
export type PortalTask = {
  key: string
  title: string
  status_id: string
  status_name: string
  category: string
  priority: string
  due_at: string | null
  completed_at: string | null
  assignees: PortalPerson[]
  labels: PortalLabel[]
  checklist_done: number
  checklist_total: number
  position: number
  updated_at: string
}
export type PortalTaskDetail = PortalTask & {
  description: string | null
  checklist: { title: string; done: boolean }[]
  created_at: string
}
export type PortalBoard = { columns: PortalColumn[]; tasks: PortalTask[] }
export type PortalTimeReport = {
  used_minutes: number
  budget_minutes: number | null
  weeks: PortalWeek[]
  by_task: { key: string | null; title: string | null; minutes: number }[]
}
export type PortalActivityItem = { kind: string; key: string; title: string; from?: string; to?: string; at: string; project?: string; project_id?: string }

// The portal dashboard and time page across all the customer's projects (MH-1167, internal/work/portal_home.go).
export type PortalDueTask = { key: string; title: string; project_id: string; project: string; due_at: string; overdue: boolean }
export type PortalOverview = {
  projects: PortalProject[]
  active_projects: number
  completed_projects: number
  open_tasks: number
  overdue_tasks: number
  completed_7d: number
  open_issues: number
  pending_requests: number
  month_minutes: number
  weeks: PortalWeek[]
  due_tasks: PortalDueTask[]
  activity: PortalActivityItem[]
  unpaid_invoices: number
}
export type PortalProjectTime = {
  id: string
  name: string
  color: string
  status: string
  used_minutes: number
  month_minutes: number
  budget_minutes: number | null
}
export type PortalTimeOverview = {
  total_minutes: number
  month_minutes: number
  weeks: PortalWeek[]
  projects: PortalProjectTime[]
  people: { name: string; initials: string; minutes: number }[]
}

export type PortalProjectPage = PortalProject & {
  weeks: PortalWeek[]
  completed_7d: number
  completed_30d: number
  invoices_visible: boolean
  invoices: PortalInvoice[]
  issues: PortalIssue[]
  requests: CustomerRequest[]
  share: PortalShare
  team: PortalPerson[]
  columns: PortalColumn[]
  budget_amount_minor: number | null
  budget_currency: string | null
}

const opts = {
  shouldRetryOnError: (err: unknown) => !(err instanceof ApiError && err.status < 500),
  revalidateOnFocus: false,
}

function useW<T>(path: string | null, ws: string | null | undefined) {
  return useSWR<T>(path && ws ? [path, ws] : null, ([p, id]: [string, string]) => api<T>(p, { workspaceId: id }), opts)
}

const enc = encodeURIComponent

export const usePortalProjects = (ws: string) => useW<{ projects: PortalProject[] }>("/api/w/portal/projects", ws)
export const usePortalProject = (ws: string, id: string | null) =>
  useW<PortalProjectPage>(id ? `/api/w/portal/projects/${enc(id)}` : null, ws)
export const usePortalIssue = (ws: string, key: string | null) =>
  useW<PortalIssueDetail>(key ? `/api/w/portal/issues/${enc(key)}` : null, ws)
export const usePortalOverview = (ws: string) => useW<PortalOverview>("/api/w/portal/overview", ws)
export const usePortalTimeAll = (ws: string) => useW<PortalTimeOverview>("/api/w/portal/time", ws)
export const usePortalRequests = (ws: string) => useW<{ requests: CustomerRequest[] }>("/api/w/portal/requests", ws)
export const usePortalInvoices = (ws: string) => useW<{ invoices: PortalInvoice[] }>("/api/w/portal/invoices", ws)
export const usePortalBoard = (ws: string, id: string | null) =>
  useW<PortalBoard>(id ? `/api/w/portal/projects/${enc(id)}/tasks` : null, ws)
export const usePortalTask = (ws: string, id: string | null, task: string | null) =>
  useW<PortalTaskDetail>(id && task ? `/api/w/portal/projects/${enc(id)}/tasks/${enc(task)}` : null, ws)
export const usePortalTime = (ws: string, id: string | null) =>
  useW<PortalTimeReport>(id ? `/api/w/portal/projects/${enc(id)}/time` : null, ws)
export const usePortalActivity = (ws: string, id: string | null) =>
  useW<{ items: PortalActivityItem[] }>(id ? `/api/w/portal/projects/${enc(id)}/activity` : null, ws)
export const useRequest = (ws: string, key: string | null) => useW<RequestDetail>(key ? `/api/w/requests/${enc(key)}` : null, ws)
export const useRequests = (ws: string, state: string, enabled = true) =>
  useW<{ requests: CustomerRequest[]; counts?: RequestCounts }>(enabled ? `/api/w/requests?state=${enc(state)}` : null, ws)

export const portalApi = {
  patchIssue: (ws: string, key: string, body: { status?: string; priority?: string }) =>
    api<PortalIssueDetail>(`/api/w/portal/issues/${enc(key)}`, { method: "PATCH", json: body, workspaceId: ws }),
  comment: (ws: string, key: string, body: string) =>
    api<PortalComment>(`/api/w/portal/issues/${enc(key)}/comments`, { method: "POST", json: { body }, workspaceId: ws }),
  fileRequest: (ws: string, form: FormData) => api<CustomerRequest>("/api/w/portal/requests", { method: "POST", form, workspaceId: ws }),
}

export const requestsApi = {
  accept: (ws: string, key: string, body: { status?: string; priority?: string; issue_type?: string; reply?: string }) =>
    api<CustomerRequest>(`/api/w/requests/${enc(key)}/accept`, { method: "POST", json: body, workspaceId: ws }),
  decline: (ws: string, key: string, reason: string) =>
    api<CustomerRequest>(`/api/w/requests/${enc(key)}/decline`, { method: "POST", json: { reason }, workspaceId: ws }),
  reopen: (ws: string, key: string, note?: string) =>
    api<CustomerRequest>(`/api/w/requests/${enc(key)}/reopen`, { method: "POST", json: note ? { note } : {}, workspaceId: ws }),
  convert: (ws: string, key: string, project?: string) =>
    api<{ request: CustomerRequest; task_key: string }>(`/api/w/requests/${enc(key)}/convert-to-task`, {
      method: "POST",
      json: project ? { project } : {},
      workspaceId: ws,
    }),
}

/** Hours (one decimal) from minutes. */
export const hours = (m: number | null | undefined) => Math.round(((m ?? 0) / 60) * 10) / 10
