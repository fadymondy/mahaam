// TanStack Query with an AsyncStorage persister: screens render the last good data instantly and
// offline, then refresh. Mutations are online-only (the API owns the timer's invariants).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/api/client";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: "offlineFirst",
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24,
      // The client already retries transport failures; don't hammer 4xx.
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 1,
    },
    mutations: { networkMode: "online", retry: false },
  },
});

export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: "mahaam.query-cache", throttleTime: 2000 });

/** Query keys are scoped by workspace so switching never shows another workspace's data. */
export const qk = {
  running: (ws: string) => ["running", ws] as const,
  entries: (ws: string, day: string) => ["entries", ws, day] as const,
  timesheet: (ws: string, week: string) => ["timesheet", ws, week] as const,
  tasks: (ws: string) => ["tasks", ws] as const,
  task: (ws: string, key: string) => ["task", ws, key] as const,
  comments: (ws: string, key: string) => ["comments", ws, key] as const,
  projects: (ws: string) => ["projects", ws] as const,
  projectsList: (ws: string, archived: boolean) => ["projects", ws, archived ? "archived" : "active"] as const,
  report: (ws: string, id: string) => ["project-report", ws, id] as const,
  board: (ws: string, id: string, filters: string) => ["issues", ws, "board", id, filters] as const,
  members: (ws: string) => ["members", ws] as const,
  portalBoard: (ws: string, id: string) => ["portal-board", ws, id] as const,
  portalTime: (ws: string, id: string) => ["portal-time", ws, id] as const,
  portalActivity: (ws: string, id: string) => ["portal-activity", ws, id] as const,
  project: (ws: string, id: string) => ["project", ws, id] as const,
  issues: (ws: string) => ["issues", ws] as const,
  issue: (ws: string, key: string) => ["issue", ws, key] as const,
  inbox: (ws: string) => ["inbox", ws] as const,
  settings: (ws: string) => ["time-settings", ws] as const,
  portalProjects: (ws: string) => ["portal-projects", ws] as const,
  portalProject: (ws: string, id: string) => ["portal-project", ws, id] as const,
  portalIssues: (ws: string, project?: string) => ["portal-issues", ws, project ?? ""] as const,
  portalIssue: (ws: string, key: string) => ["portal-issue", ws, key] as const,
  portalRequests: (ws: string, project?: string) => ["portal-requests", ws, project ?? ""] as const,
  invoices: (ws: string) => ["invoices", ws] as const,
};
