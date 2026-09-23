// Workspace-wide data every view leans on: projects, members, labels, statuses. Cached per
// workspace (lib/query.ts) and refreshed by the live stream.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { Member, Project } from "../../shared/types";
import { useApp } from "./app";
import { api } from "./bridge";
import { qk } from "./query";

export function useProjects(archived = false) {
  const { ws } = useApp();
  return useQuery({ queryKey: qk.projects(ws, archived), queryFn: () => api.projects(archived), enabled: !!ws, staleTime: 60_000 });
}

export function useProjectMap(): Map<string, Project> {
  const { data } = useProjects();
  return useMemo(() => new Map((data ?? []).map((p) => [p.id, p])), [data]);
}

export function useMembers() {
  const { ws } = useApp();
  return useQuery({ queryKey: qk.members(ws), queryFn: () => api.members(), enabled: !!ws, staleTime: 5 * 60_000 });
}

export function useMemberMap(): Map<string, Member> {
  const { data } = useMembers();
  return useMemo(() => new Map((data ?? []).map((m) => [m.user_id, m])), [data]);
}

export function useLabels() {
  const { ws } = useApp();
  return useQuery({ queryKey: qk.labels(ws), queryFn: () => api.labels(), enabled: !!ws, staleTime: 5 * 60_000 });
}

/** A project's statuses and tasks (the board), used by the project views and the issue editor. */
export function useBoard(projectId: string | null | undefined) {
  const { ws } = useApp();
  return useQuery({ queryKey: qk.board(ws, projectId ?? ""), queryFn: () => api.board(projectId!), enabled: !!ws && !!projectId });
}

export function useInbox() {
  const { ws } = useApp();
  return useQuery({ queryKey: qk.inbox(ws), queryFn: () => api.notifications(50), enabled: !!ws, staleTime: 60_000 });
}

export const useUserId = () => useApp().session?.userId ?? "";

/** Whether the signed-in person can see staff views (a client only has the portal, on the web). */
export const useIsStaff = () => useApp().workspace?.role !== "client";
