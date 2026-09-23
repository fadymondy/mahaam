// Server state. Every key starts with the workspace id, so switching workspaces can never show
// one workspace's issues in another. The live stream (main process → "live" events) invalidates
// what an event touches, so every view is current without polling.
import { QueryClient } from "@tanstack/react-query";

import type { LiveEvent } from "../../shared/types";
import { ApiError } from "./bridge";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

/** Query keys. `ws` is the workspace id. */
export const qk = {
  all: (ws: string) => ["w", ws] as const,
  projects: (ws: string, archived = false) => ["w", ws, "projects", archived] as const,
  project: (ws: string, id: string) => ["w", ws, "project", id] as const,
  board: (ws: string, id: string) => ["w", ws, "board", id] as const,
  projectActivity: (ws: string, id: string) => ["w", ws, "project-activity", id] as const,
  members: (ws: string) => ["w", ws, "members"] as const,
  labels: (ws: string) => ["w", ws, "labels"] as const,
  tasks: (ws: string, q: Record<string, unknown> = {}) => ["w", ws, "tasks", q] as const,
  task: (ws: string, key: string) => ["w", ws, "task", key] as const,
  comments: (ws: string, key: string) => ["w", ws, "comments", key] as const,
  taskActivity: (ws: string, key: string) => ["w", ws, "task-activity", key] as const,
  inbox: (ws: string) => ["w", ws, "inbox"] as const,
  entries: (ws: string, q: Record<string, unknown> = {}) => ["w", ws, "time", "entries", q] as const,
  timesheet: (ws: string, week?: string) => ["w", ws, "time", "timesheet", week ?? ""] as const,
  timeSettings: (ws: string) => ["w", ws, "time", "settings"] as const,
};

const WORK = ["projects", "project", "board", "project-activity", "tasks", "task", "comments", "task-activity", "labels"];

/** What a live event makes stale. */
export function invalidateFor(ws: string, e: LiveEvent): void {
  const under = (segments: string[]) =>
    void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "w" && q.queryKey[1] === ws && segments.includes(String(q.queryKey[2])) });
  switch (e.type) {
    case "timer.state":
    case "timer.started":
    case "timer.stopped":
    case "entry.changed":
      return under(["time"]);
    case "notification":
      return under(["inbox"]);
    case "other": {
      const n = e.name;
      if (/^(task|issue|comment|checklist|status|project)\./.test(n)) under(WORK);
      if (n.startsWith("project.member")) under(["members"]);
    }
  }
}
