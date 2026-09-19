// Team-app data: the timer, today's entries, my tasks. Mutations write the server's answer straight
// into the cache (the API is the source of truth for the one-running-timer invariant).
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import type { Status, TimeEntry } from "@/api/types";
import { useWs } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { mahaam, useSession } from "@/lib/session";
import { localDay } from "@/lib/time";

export function useRunning(polling = false) {
  const ws = useWs();
  return useQuery({
    queryKey: qk.running(ws),
    queryFn: async () => (await mahaam.time.running()).timer ?? null,
    enabled: !!ws,
    refetchInterval: polling ? 30_000 : false,
  });
}

export function useTodayEntries(polling = false) {
  const ws = useWs();
  const tz = useTimeSettings().data?.timezone;
  const today = localDay(new Date(), tz);
  return useQuery({
    queryKey: qk.entries(ws, today),
    // `from`/`to` are inclusive days in the workspace timezone.
    queryFn: async () => (await mahaam.time.entries({ from: today, to: today, limit: 200 })).entries ?? [],
    enabled: !!ws,
    refetchInterval: polling ? 30_000 : false,
  });
}

export function useTimeSettings() {
  const ws = useWs();
  return useQuery({ queryKey: qk.settings(ws), queryFn: mahaam.time.settings, enabled: !!ws, staleTime: 10 * 60_000 });
}

function useTimeInvalidate() {
  const ws = useWs();
  const qc = useQueryClient();
  return (running: TimeEntry | null) => {
    qc.setQueryData(qk.running(ws), running);
    void qc.invalidateQueries({ queryKey: ["entries", ws] });
    void qc.invalidateQueries({ queryKey: ["timesheet", ws] });
  };
}

export function useStartTimer() {
  const done = useTimeInvalidate();
  return useMutation({
    mutationFn: mahaam.time.start,
    onSuccess: (r) => done(r.started),
  });
}

export function useStopTimer() {
  const done = useTimeInvalidate();
  return useMutation({ mutationFn: mahaam.time.stop, onSuccess: () => done(null) });
}

export function useProjects() {
  const ws = useWs();
  return useQuery({
    queryKey: qk.projects(ws),
    queryFn: async () => (await mahaam.projects.list()).projects ?? [],
    enabled: !!ws,
    staleTime: 5 * 60_000,
  });
}

/** My tasks plus a status map (from each project's columns) for board ordering. */
export function useMyTasks() {
  const ws = useWs();
  const { user } = useSession();
  const tasks = useQuery({
    queryKey: qk.tasks(ws),
    queryFn: async () => (await mahaam.tasks.mine(user!.id)).tasks ?? [],
    enabled: !!ws && !!user,
  });
  const projectIds = useMemo(() => [...new Set((tasks.data ?? []).map((t) => t.project_id))], [tasks.data]);
  const projects = useQueries({
    queries: projectIds.map((id) => ({
      queryKey: qk.project(ws, id),
      queryFn: () => mahaam.projects.get(id),
      staleTime: 5 * 60_000,
    })),
  });
  const statuses = useMemo(() => {
    const m = new Map<string, Status>();
    for (const p of projects) for (const s of p.data?.statuses ?? []) m.set(s.id, s);
    return m;
  }, [projects]);
  const projectNames = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    for (const p of projects) if (p.data) m.set(p.data.id, { name: p.data.name, color: p.data.color });
    return m;
  }, [projects]);
  return { tasks, statuses, projectNames };
}

export function useOpenIssues() {
  const ws = useWs();
  return useQuery({
    queryKey: qk.issues(ws),
    queryFn: async () => (await mahaam.issues.list()).issues ?? [],
    enabled: !!ws,
  });
}
