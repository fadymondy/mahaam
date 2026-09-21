import type { Issue, IssueDetail, Inbox, LiveEvent, LogInput, NextItem, Project, StartInput, TimeEntry, TimerChange, Workspace, CreateIssueInput, EntryPatch } from "../types";

/** The API surface the panel uses. The extension passes a MahaamClient; the tray proxies to its main process. */
export interface PanelApi {
  workspaces(): Promise<Workspace[]>;
  running(): Promise<TimeEntry | null>;
  start(input: StartInput): Promise<TimerChange>;
  startOn(item: NextItem, description?: string): Promise<TimerChange>;
  stop(): Promise<TimeEntry>;
  updateEntry(id: string, patch: EntryPatch): Promise<TimeEntry>;
  logTime(input: LogInput): Promise<TimeEntry>;
  entriesToday(): Promise<TimeEntry[]>;
  nextUp(limit?: number): Promise<NextItem[]>;
  notifications(limit?: number): Promise<Inbox>;
  markAllRead(): Promise<{ read: number }>;
  projects(): Promise<Project[]>;
  /** Open issues for the issues view. */
  issues(q?: { state?: "open" | "closed" }): Promise<Issue[]>;
  createIssue(input: CreateIssueInput): Promise<IssueDetail>;
}

export interface Session {
  apiUrl: string;
  email: string;
  workspace: Workspace | null;
}

export type LiveStatus = "open" | "reconnecting" | "closed";

export interface PanelHost {
  platform: "tray" | "extension";
  defaultApiUrl: string;
  /** Whether "keep me signed in" (a stored password for silent re-login) is offered. */
  canRemember: boolean;
  session(): Promise<Session | null>;
  signIn(apiUrl: string, email: string, password: string, remember: boolean): Promise<Session>;
  signOut(): Promise<void>;
  selectWorkspace(ws: Workspace): Promise<void>;
  api: PanelApi;
  /** Live events for the selected workspace. `onAuth` fires when the session can no longer be renewed. */
  subscribe(onEvent: (e: LiveEvent) => void, onStatus: (s: LiveStatus) => void, onAuth: () => void): () => void;
  openUrl(url: string): void;
  /** The panel tells the host whenever the running timer changes (tray title, toolbar badge). */
  timerChanged?(running: TimeEntry | null): void;
  autoLaunch?: { get(): Promise<boolean>; set(on: boolean): Promise<void> };
  shortcut?: string;
  quit?(): void;
  /** Extension: the page the context menu was used on. */
  pageContext?(): Promise<{ url: string; title?: string; mode: "issue" | "log" } | null>;
}
