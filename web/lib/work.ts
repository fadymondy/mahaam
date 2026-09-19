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
  /** data: URL of the project's image; null = coloured initials. */
  avatar?: string | null
  /** Items per issue status (lists only). */
  issues?: Record<string, number> | null
  share_board: boolean
  share_team: boolean
  share_money: boolean
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
  /** Set when the card is an issue (SDK, portal, MCP, in-app or imported): the same MH-n item. */
  issue?: TaskIssue | null
}

export type TaskIssue = {
  /** true = the issue row only mirrors this card (made on the board); false = a real issue (SDK, portal, MCP…). */
  from_board: boolean
  type: string
  source: string
  screenshot: boolean
  diagnostics: boolean
  request_state: string | null
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
  company?: string | null
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

// ── issues (the workspace's own issue tracker: /api/w/issues) ───────────────

export const ISSUE_STATUSES = ["backlog", "todo", "in_progress", "waiting_approval", "in_review", "done"] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]
export const ISSUE_PRIORITIES = ["highest", "high", "medium", "low", "lowest"] as const
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number]
export const ISSUE_TYPES = ["bug", "feature", "task", "story", "epic"] as const
export type IssueType = (typeof ISSUE_TYPES)[number]

export type Issue = {
  key: string
  title: string
  status: IssueStatus
  priority: IssuePriority
  state: string | null
  issue_type: IssueType | string
  body: string | null
  resolution: string | null
  route: string | null
  page_url: string | null
  selector: string | null
  screenshot: string | null
  console_log: string | null
  network_log: string | null
  viewport: string | null
  user_agent: string | null
  reporter_id: string | null
  project_id: string | null
  source: string
  human_only: boolean
  request_state?: "pending" | "accepted" | "declined" | "converted" | null
  ai_model: string | null
  ai_effort: string | null
  agent: string | null
  skill: string | null
  sort_order: number
  agent_seconds: number
  comment_count: number
  started_at: string | null
  finished_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
}

export type IssueComment = {
  id: string
  author_id: string | null
  author_kind: "user" | "agent" | "admin" | string
  body: string
  created_at: string
}

export type IssueDetail = Issue & { comments: IssueComment[] }

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
export const useClient = (ws: string, id: string | null, enabled = true) =>
  useW<Client>(id && enabled ? `/api/w/clients/${encodeURIComponent(id)}` : null, ws)
export const useTeams = (ws: string, enabled = true) => useW<{ teams: Team[] }>(enabled ? "/api/w/teams" : null, ws)
export const useLabels = (ws: string) => useW<{ labels: Label[] }>("/api/w/labels", ws)

export type IssueQuery = { status?: string; priority?: string; type?: string; q?: string; project?: string; state?: string; include_board?: string }
function issueQs(q: IssueQuery) {
  const s = new URLSearchParams()
  for (const k of ["status", "priority", "type", "q", "project", "state", "include_board"] as const) if (q[k]) s.set(k, q[k]!)
  const str = s.toString()
  return str ? `?${str}` : ""
}
export const useIssues = (ws: string, query: IssueQuery = {}, enabled = true) =>
  useW<{ issues: Issue[] }>(enabled ? `/api/w/issues${issueQs(query)}` : null, ws)
export const useIssue = (ws: string, key: string | null, enabled = true) =>
  useW<IssueDetail>(key && enabled ? `/api/w/issues/${encodeURIComponent(key)}` : null, ws)

export type IssuePatch = {
  title?: string
  body?: string
  issue_type?: IssueType
  status?: IssueStatus
  priority?: IssuePriority
  resolution?: string
  human_only?: boolean
  ai_model?: string
  ai_effort?: string
  agent?: string
  skill?: string
}
export type NewIssue = { title: string; body?: string; issue_type?: IssueType; priority?: IssuePriority; status?: IssueStatus; project?: string }

// ── project agents & skills (the catalogue behind the Agent / Skill pickers and @-mentions) ──
export type CatalogueItem = { id: string; kind: "agent" | "skill"; name: string; description: string; source: string }
export type Catalogue = { agents: CatalogueItem[] | null; skills: CatalogueItem[] | null }
export const useProjectCatalogue = (ws: string, projectId: string | null) =>
  useW<Catalogue>(projectId ? `/api/w/projects/${encodeURIComponent(projectId)}/catalogue` : null, ws)
export const catalogueApi = {
  add: (ws: string, projectId: string, body: { kind: "agent" | "skill"; name: string; description?: string }) =>
    w.post<CatalogueItem>(ws, `/api/w/projects/${encodeURIComponent(projectId)}/catalogue`, body),
}

export const issuesApi = {
  create: (ws: string, body: NewIssue) => w.post<IssueDetail>(ws, "/api/w/issues", body),
  patch: (ws: string, key: string, body: IssuePatch) => w.patch<IssueDetail>(ws, `/api/w/issues/${encodeURIComponent(key)}`, body),
  move: (ws: string, key: string, to: { before?: string; after?: string; status?: IssueStatus }) =>
    w.post<IssueDetail>(ws, `/api/w/issues/${encodeURIComponent(key)}/move`, to),
  comment: (ws: string, key: string, body: string) =>
    w.post<IssueComment>(ws, `/api/w/issues/${encodeURIComponent(key)}/comments`, { body }),
}

// ── invoices (P6) ────────────────────────────────────────────────────────────

export const INVOICE_STATUSES = ["draft", "sent", "paid", "void"] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export type Invoice = {
  id: string
  number: string
  client_id: string
  client_name: string | null
  status: InvoiceStatus
  currency: string
  issue_date: string
  due_date: string | null
  subtotal_minor: number
  tax_rate: string
  tax_minor: number
  total_minor: number
  paid_minor: number
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export type InvoiceLine = {
  id: string
  description: string
  quantity: string
  unit_minor: number
  amount_minor: number
  source_time_entry_ids: string[]
}

export type InvoicePayment = {
  id: string
  amount_minor: number
  paid_at: string
  ref: string | null
  created_by: string
  created_at: string
}

export type InvoiceDetail = Invoice & { lines: InvoiceLine[]; payments: InvoicePayment[] }

export type Unbilled = { currency: string; seconds: number; amount_minor: number; entry_count: number }

export type InvoiceQuery = { client?: string; status?: string }
function invoiceQs(q: InvoiceQuery) {
  const s = new URLSearchParams()
  if (q.client) s.set("client", q.client)
  if (q.status) s.set("status", q.status)
  const str = s.toString()
  return str ? `?${str}` : ""
}

export const useInvoices = (ws: string, query: InvoiceQuery = {}, enabled = true) =>
  useW<{ invoices: Invoice[] }>(enabled ? `/api/w/invoices${invoiceQs(query)}` : null, ws)
export const useInvoice = (ws: string, ref: string | null, enabled = true) =>
  useW<InvoiceDetail>(ref && enabled ? `/api/w/invoices/${encodeURIComponent(ref)}` : null, ws)
export const useClientInvoices = (ws: string, id: string | null, enabled = true) =>
  useW<{ invoices: Invoice[] }>(id && enabled ? `/api/w/clients/${encodeURIComponent(id)}/invoices` : null, ws)
export const useClientUnbilled = (ws: string, id: string | null, enabled = true) =>
  useW<Unbilled>(id && enabled ? `/api/w/clients/${encodeURIComponent(id)}/unbilled` : null, ws)

export type DraftInvoiceBody = {
  client_id: string
  from?: string
  to?: string
  project_ids?: string[]
  group_by?: "project" | "task"
  tax_rate?: string
  due_date?: string
  notes?: string
}

export const invoicesApi = {
  draft: (ws: string, body: DraftInvoiceBody) => w.post<InvoiceDetail>(ws, "/api/w/invoices/from-time", body),
  setStatus: (ws: string, ref: string, status: InvoiceStatus) =>
    w.patch<InvoiceDetail>(ws, `/api/w/invoices/${encodeURIComponent(ref)}`, { status }),
  pay: (ws: string, ref: string, body: { amount_minor: number; paid_at?: string; ref?: string }) =>
    w.post<InvoiceDetail>(ws, `/api/w/invoices/${encodeURIComponent(ref)}/payments`, body),
  del: (ws: string, ref: string) => w.del(ws, `/api/w/invoices/${encodeURIComponent(ref)}`),
}

/** Fetch a workspace-scoped file (needs the X-Workspace-ID header a plain link can't set). */
async function fetchWithWs(ws: string, path: string) {
  const res = await fetch(path, { headers: { "X-Workspace-ID": ws }, credentials: "same-origin", cache: "no-store" })
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg
    } catch {}
    throw new ApiError(res.status, msg || `Request failed (${res.status})`)
  }
  return res
}

export async function downloadInvoice(ws: string, ref: string, format: "csv" | "xlsx", lang: string) {
  const res = await fetchWithWs(ws, `/api/w/invoices/${encodeURIComponent(ref)}/export?format=${format}&lang=${lang}`)
  const cd = res.headers.get("content-disposition") ?? ""
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  const name = star ? decodeURIComponent(star[1]) : `${ref}.${format}`
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export async function openInvoicePrint(ws: string, ref: string, lang: string) {
  const res = await fetchWithWs(ws, `/api/w/invoices/${encodeURIComponent(ref)}/print?lang=${lang}`)
  const url = URL.createObjectURL(await res.blob())
  const win = window.open(url, "_blank")
  if (win) win.addEventListener("load", () => setTimeout(() => win.print(), 300))
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

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
