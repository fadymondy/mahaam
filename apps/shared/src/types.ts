// Types are derived from the API's OpenAPI spec (src/openapi.d.ts, regenerated with
// `npm run gen:types` against a running API). The `$schema` link Huma adds to every body is dropped.
import type { components } from "./openapi";

type S = components["schemas"];
type Clean<T> = Omit<T, "$schema">;

export type TimeEntry = Clean<S["TimeEntry"]>;
export type Running = Clean<S["Running"]>;
export type TimerChange = Clean<S["TimerChange"]>;
export type StartInput = Clean<S["StartInput"]>;
export type LogInput = Clean<S["LogInput"]>;
export type EntryPatch = Clean<S["EntryPatch"]>;
export type Task = Clean<S["Task"]>;
export type Project = Clean<S["Project"]>;
export type Issue = Clean<S["Issue"]>;
export type IssueDetail = Clean<S["IssueDetail"]>;
export type CreateIssueInput = Clean<S["W-create-issueRequest"]>;
export type Notification = Clean<S["Notification"]>;
export type Inbox = Clean<S["Inbox"]>;
export type Workspace = Clean<S["WorkspaceOut"]>;

/** GET /api/auth/me (auth plugin; not part of the Huma spec). */
export interface Identity {
  id: string;
  email: string;
}

export interface Credentials {
  email: string;
  password: string;
}

/** A task or an issue the person can start a timer on, in the order the panel lists them. */
export type NextItem =
  | { kind: "task"; key: string; title: string; projectId: string; projectName: string; doing: boolean; priority: string; task: Task }
  | { kind: "issue"; key: string; title: string; projectId: string | null; projectName: string | null; doing: boolean; priority: string; issue: Issue };

/** Events on GET /api/w/events that the clients act on. Anything else arrives as `other`. */
export type LiveEvent =
  | { type: "timer.state"; running: TimeEntry | null }
  | { type: "timer.started"; entry: TimeEntry }
  | { type: "timer.stopped"; entry: TimeEntry }
  | { type: "entry.changed"; data: unknown }
  | { type: "notification"; name: string; data: unknown }
  | { type: "other"; name: string; data: unknown };
