// Response shapes, derived from the API's OpenAPI document (apps/shared/src/openapi.d.ts), so a
// field renamed server-side is a compile error here. Shared by the main process and the renderer.
import type { components } from "../../../shared/src/openapi";

type S = components["schemas"];
type Clean<T> = Omit<T, "$schema">;

export type { Identity, LiveEvent, Workspace } from "@mahaam/client";

export type TimeEntry = Clean<S["TimeEntry"]>;
export type TimerChange = Clean<S["TimerChange"]>;
export type StartInput = Clean<S["StartInput"]>;
export type LogInput = Clean<S["LogInput"]>;
export type EntryPatch = Clean<S["EntryPatch"]>;
export type Project = Clean<S["Project"]>;
export type ProjectDetail = Clean<S["ProjectDetail"]>;
export type Status = Clean<S["Status"]>;
export type Task = Clean<S["Task"]>;
export type TaskDetail = Clean<S["TaskDetail"]>;
export type TaskInput = Clean<S["TaskInput"]>;
export type ChecklistItem = Clean<S["ChecklistItem"]>;
export type Comment = Clean<S["Comment"]>;
export type Board = Clean<S["Board"]>;
export type Label = Clean<S["Label"]>;
export type Activity = Clean<S["Activity"]>;
export type Notification = Clean<S["Notification"]>;
export type Inbox = Clean<S["Inbox"]>;
export type Timesheet = Clean<S["Timesheet"]>;
export type TimeSettings = Clean<S["TimeSettings"]>;

export type Priority = "none" | "low" | "medium" | "high" | "urgent";

export interface Member {
  user_id: string;
  email: string;
  role: "owner" | "admin" | "manager" | "member" | "client";
  status: string;
  joined_at: string;
}

/** The session as the renderer sees it: no token, ever. */
export interface SessionOut {
  apiUrl: string;
  email: string;
  userId: string;
  workspace: import("@mahaam/client").Workspace | null;
  workspaces: import("@mahaam/client").Workspace[];
}

export type SignInResult = { ok: true; session: SessionOut } | { ok: false; mfa: true };

export interface Prefs {
  theme: "system" | "light" | "dark";
  locale: "en" | "ar";
  notify: boolean;
  idle: boolean;
  sidebar: "open" | "collapsed";
}

export interface AppConfig {
  platform: NodeJS.Platform;
  version: string;
  defaultApiUrl: string;
  lastEmail: string;
  prefs: Prefs;
  canAutoLaunch: boolean;
  /** This device's token name, to mark it in the list of devices. */
  deviceName: string;
  /** macOS laid the app out right-to-left at launch: the traffic lights are top-right. */
  nativeRtl: boolean;
}

/** Things the main process tells the renderer to do: menu items, the tray, deep links. */
export type Command =
  | { type: "navigate"; to: Route }
  | { type: "palette" }
  | { type: "create" }
  | { type: "toggle-sidebar" }
  | { type: "timer-palette" }
  | { type: "settings"; section?: string };

/** Every screen in the app. Views register themselves in renderer/routes.tsx. */
export type Route =
  | { name: "inbox" }
  | { name: "my-issues" }
  | { name: "projects" }
  | { name: "project"; id: string; view?: "list" | "board" }
  | { name: "issue"; key: string }
  | { name: "time" }
  | { name: "settings"; section?: string };
