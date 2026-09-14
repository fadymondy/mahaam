"use client"

// P1 contract types (mirror internal/work JSON) and SWR hooks for /api/w/*.
import useSWR, { type KeyedMutator } from "swr"

import { api, ApiError } from "@/lib/api"

export type TaskCounts = { todo: number; doing: number; done: number }

export type Project = {
  id: string
  name: string
  description: string | null
  color: string
  status: ProjectStatus
  billing_mode: BillingMode
  budget_minutes: number | null
  budget_minor: number | null
  currency: string | null
  visibility: "workspace" | "members"
  starts_on: string | null
  ends_on: string | null
  archived_at: string | null
  client_id: string | null
  client_name: string | null
  created_by: string
  created_at: string
  updated_at: string
  tasks: TaskCounts
  member_count: number
}

export const PROJECT_STATUSES = ["planned", "active", "on_hold", "completed", "cancelled"] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]
export const BILLING_MODES = ["non_billable", "hourly", "fixed"] as const
export type BillingMode = (typeof BILLING_MODES)[number]
export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const
export type Priority = (typeof PRIORITIES)[number]
export const CATEGORIES = ["todo", "doing", "done"] as const
export type Category = (typeof CATEGORIES)[number]

export type Status = {
  id: string
  project_id: string
  name: string
  color: string
  category: Category
  position: number
  task_count: number
}

export type ProjectMember = { user_id: string; role: "lead" | "member" }
export type ProjectTeam = { team_id: string; name: string; color: string; member_ids: string[] }

export type ProjectDetail = Project & {
  members: ProjectMember[]
  teams: ProjectTeam[]
  statuses: Status[]
  can_manage: boolean
  can_write: boolean
}

export type Task = {
  id: string
  key: string
  number: number
  project_id: string
  status_id: string
  title: string
  description: string | null
  position: number
  due_at: string | null
  estimate_minutes: number | null
  priority: Priority
  parent_id: string | null
  created_by: string
  completed_at: string | null
  created_at: string
  updated_at: string
  assignee_ids: string[]
  label_ids: string[]
  checklist_done: number
  checklist_total: number
  comment_count: number
  attachment_count: number
  subtask_count: number
  subtask_done: number
}

export type TaskBrief = { id: string; key: string; title: string; status_id: string; done: boolean }
export type ChecklistItem = {
  id: string
  title: string
  done: boolean
  position: number
  done_at: string | null
  done_by: string | null
}

export type TaskDetail = Task & {
  project: { id: string; name: string; color: string; archived: boolean }
  status: Status
  parent: TaskBrief | null
  subtasks: TaskBrief[]
  checklist: ChecklistItem[]
  can_write: boolean
  can_delete: boolean
}

export type Board = { statuses: Status[]; tasks: Task[] }

export type Comment = {
  id: string
  task_id: string
  author_id: string
  author_kind: "user" | "agent"
  body: string
  mentions: string[]
  edited_at: string | null
  created_at: string
}

export type Attachment = {
  id: string
  task_id: string
  file_name: string
  content_type: string
  size: number
  uploaded_by: string
  created_at: string
}

export type Activity = {
  id: string
  project_id: string | null
  task_id: string | null
  actor_id: string
  via: "session" | "mcp" | "system"
  action: string
  subject_type: string
  subject_id: string
  changes: Record<string, unknown>
  created_at: string
}

export type Client = {
  id: string
  name: string
  email: string | null
  phone: string | null
  country: string | null
  currency: string
  default_rate_minor: number | null
  notes: string | null
  archived_at: string | null
  project_count: number
  created_at: string
}

export type Team = {
  id: string
  name: string
  description: string | null
  color: string
  member_ids: string[]
  project_count: number
  created_at: string
}

export type Label = { id: string; name: string; color: string; task_count: number }

// ── hooks ──────────────────────────────────────────────────────────────────

const opts = {
  shouldRetryOnError: (err: unknown) => !(err instanceof ApiError && err.status < 500),
  revalidateOnFocus: false,
}

function useW<T>(path: string | null, workspaceId: string | null | undefined) {
  return useSWR<T>(
    path && workspaceId ? [path, workspaceId] : null,
    ([p, id]: [string, string]) => api<T>(p, { workspaceId: id }),
    opts,
  )
}

export const useProjects = (ws: string, archived = false) =>
  useW<{ projects: Project[] }>(`/api/w/projects${archived ? "?archived=true" : ""}`, ws)
export const useProject = (ws: string, id: string | null) =>
  useW<ProjectDetail>(id ? `/api/w/projects/${encodeURIComponent(id)}` : null, ws)
export const useBoard = (ws: string, id: string | null) =>
  useW<Board>(id ? `/api/w/projects/${encodeURIComponent(id)}/board` : null, ws)
export const useTask = (ws: string, ref: string | null) =>
  useW<TaskDetail>(ref ? `/api/w/tasks/${encodeURIComponent(ref)}` : null, ws)
export const useComments = (ws: string, ref: string | null) =>
  useW<{ comments: Comment[] }>(ref ? `/api/w/tasks/${encodeURIComponent(ref)}/comments` : null, ws)
export const useAttachments = (ws: string, ref: string | null) =>
  useW<{ attachments: Attachment[] }>(ref ? `/api/w/tasks/${encodeURIComponent(ref)}/attachments` : null, ws)
export const useTaskActivity = (ws: string, ref: string | null) =>
  useW<{ activity: Activity[] }>(ref ? `/api/w/tasks/${encodeURIComponent(ref)}/activity?limit=100` : null, ws)
export const useProjectActivity = (ws: string, id: string | null) =>
  useW<{ activity: Activity[] }>(id ? `/api/w/projects/${encodeURIComponent(id)}/activity?limit=30` : null, ws)
export const useWorkspaceActivity = (ws: string, enabled: boolean) =>
  useW<{ activity: Activity[] }>(enabled ? `/api/w/activity?limit=20` : null, ws)
export const useClients = (ws: string, archived = false, enabled = true) =>
  useW<{ clients: Client[] }>(enabled ? `/api/w/clients${archived ? "?archived=true" : ""}` : null, ws)
export const useTeams = (ws: string, enabled = true) => useW<{ teams: Team[] }>(enabled ? "/api/w/teams" : null, ws)
export const useLabels = (ws: string) => useW<{ labels: Label[] }>("/api/w/labels", ws)

export type { KeyedMutator }

/** Mutations: one place, always scoped to the workspace. */
export const w = {
  post: <T>(ws: string, path: string, json?: unknown) => api<T>(path, { method: "POST", json: json ?? {}, workspaceId: ws }),
  patch: <T>(ws: string, path: string, json: unknown) => api<T>(path, { method: "PATCH", json, workspaceId: ws }),
  put: <T>(ws: string, path: string, json?: unknown) => api<T>(path, { method: "PUT", json: json ?? {}, workspaceId: ws }),
  del: (ws: string, path: string) => api<void>(path, { method: "DELETE", workspaceId: ws }),
  upload: <T>(ws: string, path: string, file: File) => {
    const form = new FormData()
    form.append("file", file)
    return api<T>(path, { method: "POST", form, workspaceId: ws })
  },
}

export function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback
}
