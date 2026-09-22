import type { components } from "./openapi";

// Response shapes, transcribed from the API's OpenAPI document (GET /openapi.json on the dev API).
// Only the fields the apps read are typed; the API returns more.

export type Role = "owner" | "admin" | "manager" | "member" | "client";

export interface User {
  id: string;
  email: string;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  role: Role;
  locale: string;
}

// Derived from the API's OpenAPI document rather than hand-written, so a field renamed or
// removed server-side becomes a compile error here instead of undefined at runtime.
export type TimeEntry = components["schemas"]["TimeEntry"];

export interface TimerChange {
  started: TimeEntry;
  stopped?: TimeEntry | null;
}

export interface TimesheetRow {
  project_id?: string | null;
  project_name?: string | null;
  task_key?: string | null;
  task_title?: string | null;
  days?: number[];
  total_s?: number;
}

export interface Timesheet {
  user_id: string;
  timezone: string;
  week_start: number;
  days: string[] | null;
  day_totals: number[] | null;
  rows: TimesheetRow[] | null;
  entries: TimeEntry[] | null;
  running: TimeEntry | null;
  total_s: number;
  billable_s: number;
  rounded_total_s: number;
  now: string;
}

export interface TimeSettings {
  timezone: string;
  week_start: number;
  reminder_running_hours: number;
  currency: string;
}

export type Priority = "none" | "low" | "medium" | "high" | "urgent";

export type Task = components["schemas"]["Task"];

export type Status = components["schemas"]["Status"];

export type ChecklistItem = components["schemas"]["ChecklistItem"];

export type Comment = components["schemas"]["Comment"];

export interface TaskDetail extends Task {
  description: string | null;
  can_write: boolean;
  checklist: ChecklistItem[];
  project: { id: string; name: string; color: string; archived: boolean };
  status: Status;
}

export interface TaskCounts {
  todo: number;
  doing: number;
  done: number;
}

export type Project = components["schemas"]["Project"];

export interface ProjectDetail extends Project {
  statuses: Status[];
}

export interface Issue {
  key: string;
  title: string;
  body: string | null;
  status: string;
  state: string;
  priority: string;
  issue_type: string;
  project_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** One workspace issue in full, as the team side reads it. Generated shape; only what we use. */
export type IssueDetail = components["schemas"]["IssueDetail"];
export type IssueComment = components["schemas"]["IssueComment"];
export type Notification = components["schemas"]["Notification"];

export interface Inbox {
  notifications: Notification[] | null;
  unread: number;
}

// ---- Client portal -----------------------------------------------------------------------------

export interface PortalProject {
  id: string;
  name: string;
  color: string;
  status: string;
  description: string | null;
  client_name: string | null;
  archived: boolean;
  tasks: TaskCounts;
  percent_done: number;
  budget_minutes: number | null;
  used_minutes: number;
  open_issues: number;
  pending_requests: number;
  starts_on: string | null;
  ends_on: string | null;
}

export interface PortalIssue {
  key: string;
  title: string;
  body: string | null;
  status: string;
  state: string;
  priority: string;
  issue_type: string;
  project_id: string | null;
  resolution: string | null;
  can_accept: boolean;
  can_reopen: boolean;
  mine: boolean;
  comment_count: number;
  created_at: string;
  updated_at: string;
}

export interface PortalComment {
  id: string;
  author_kind: string;
  body: string;
  mine: boolean;
  created_at: string;
}

export interface PortalIssueDetail extends PortalIssue {
  comments: PortalComment[] | null;
}

export interface PortalRequest {
  key: string;
  title: string;
  body: string | null;
  kind: string;
  status: string;
  state: string;
  reply: string | null;
  desired_on: string | null;
  project_id: string | null;
  project_name: string | null;
  mine: boolean;
  created_at: string;
}

export interface Invoice {
  id: string;
  number: string;
  status: string;
  currency: string;
  issue_date: string;
  due_date: string | null;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  paid_minor: number;
  client_name: string | null;
  notes: string | null;
}

export interface PortalProjectPage extends PortalProject {
  completed_7d: number;
  completed_30d: number;
  issues: PortalIssue[] | null;
  requests: PortalRequest[] | null;
  invoices: Invoice[] | null;
  invoices_visible: boolean;
  weeks: { week: string; minutes: number }[] | null;
}
