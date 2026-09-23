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

export type ProjectDetail = components["schemas"]["ProjectDetail"];

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
  /** What the workspace shares with its customers on this project. */
  share?: { board: boolean; team: boolean; money: boolean };
  team?: { name: string; initials: string; role?: string }[] | null;
  columns?: { id: string; name: string; color: string; category: string; task_count: number }[] | null;
  budget_amount_minor?: number | null;
  budget_currency?: string | null;
}

// ---- Projects, reports, the issue board (team) -------------------------------------------------

/** A workspace issue as the list/board returns it (generated; issues are task cards on a board). */
export type IssueRow = components["schemas"]["Issue"];
export type Budget = components["schemas"]["Budget"];
export type Activity = components["schemas"]["Activity"];
export type Member = components["schemas"]["Member"];
export type Label = components["schemas"]["Label"];

export interface ReportRow {
  key: string;
  name: string;
  color?: string;
  seconds: number;
  rounded_s: number;
  billable_s: number;
  entries: number;
}

export interface TimeReportSummary {
  from: string;
  to: string;
  rows: ReportRow[] | null;
  total: ReportRow;
}

/** GET /api/w/projects/{p}/report?format=json (internal/work/project_report.go). */
export interface ProjectReport {
  project: ProjectDetail;
  from: string;
  to: string;
  timezone: string;
  total_tasks: number;
  percent_done: number;
  statuses: Status[] | null;
  budget: Budget | null;
  by_member: TimeReportSummary | null;
  by_week: TimeReportSummary | null;
  issues_visible: boolean;
  open_issue_count: number;
  open_issues: { key: string; title: string; type: string; status: string; priority: string; created_at: string }[] | null;
  activity: { at: string; actor: string; action: string; subject: string }[] | null;
  generated_at: string;
}

// ---- Portal extras -------------------------------------------------------------------------------

export type PortalBoard = components["schemas"]["PortalBoard"];
export type PortalBoardTask = components["schemas"]["PortalTask"];
export type PortalTimeReport = components["schemas"]["PortalTimeReport"];
export type PortalActivityItem = components["schemas"]["PortalActivityItem"];

// ---- Account ------------------------------------------------------------------------------------

export type Profile = components["schemas"]["Profile"];
export type TwoFAState = components["schemas"]["TwoFAState"];
export type VerifyState = components["schemas"]["VerifyStateBody"];
