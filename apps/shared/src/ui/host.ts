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
  /** One issue with its comment thread, for the detail view. */
  issue(key: string): Promise<IssueDetail>;
  /** Triage from the detail view. Only status is used today; the rest is what the route accepts. */
  updateIssue(key: string, patch: { status?: string; priority?: string; state?: "open" | "closed" }): Promise<IssueDetail>;
  commentOnIssue(key: string, body: string): Promise<unknown>;
  /**
   * Files an issue with a screenshot. Optional: only a host that can capture one implements it
   * (the extension does, from a context-menu click). The Panel falls back to createIssue when it
   * is absent, so a host without capture is unaffected.
   */
  fileIssueWithScreenshot?(input: { title: string; body?: string; page_url?: string }, shot?: string | null): Promise<{ key: string }>;
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
  /**
   * Extension: the page the context menu was used on. `screenshot` is a data URL, present only
   * when the host captured one for this page.
   */
  pageContext?(): Promise<{ url: string; title?: string; mode: "issue" | "log"; screenshot?: string } | null>;
}
