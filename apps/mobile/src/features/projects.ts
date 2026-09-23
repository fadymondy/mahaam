// Team-side projects: the list (home), one project, its report, and its issue board.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { IssueRow, ProjectDetail } from "@/api/types";
import { useWs } from "@/lib/hooks";
import { usePolling } from "@/lib/live";
import { qk } from "@/lib/query";
import { mahaam } from "@/lib/session";

export function useProjectList(archived: boolean) {
  const ws = useWs();
  return useQuery({
    queryKey: qk.projectsList(ws, archived),
    queryFn: async () => (await mahaam.projects.list(archived)).projects ?? [],
    enabled: !!ws,
    refetchInterval: usePolling() ? 60_000 : false,
  });
}

export function useProject(id: string) {
  const ws = useWs();
  return useQuery({ queryKey: qk.project(ws, id), queryFn: () => mahaam.projects.get(id), enabled: !!ws && !!id });
}

export function useProjectReport(id: string, enabled = true) {
  const ws = useWs();
  return useQuery({ queryKey: qk.report(ws, id), queryFn: () => mahaam.projects.report(id), enabled: !!ws && !!id && enabled, staleTime: 60_000 });
}

export function useMembers() {
  const ws = useWs();
  return useQuery({
    queryKey: qk.members(ws),
    queryFn: async () => (await mahaam.members()).members ?? [],
    enabled: !!ws,
    staleTime: 10 * 60_000,
  });
}

export type BoardFilters = { q?: string; type?: string; priority?: string; state?: string };

/** One project's issues in board order (items made on the board included), filtered server-side. */
export function useProjectIssues(project: string, f: BoardFilters) {
  const ws = useWs();
  return useQuery({
    queryKey: qk.board(ws, project, JSON.stringify(f)),
    queryFn: async () => (await mahaam.issues.query({ project, board: true, ...f })).issues ?? [],
    enabled: !!ws && !!project,
    refetchInterval: usePolling() ? 30_000 : false,
  });
}

/** The column an issue sits in: its card's column, else the first column of its stage. */
export function columnOf(i: IssueRow, statuses: ProjectDetail["statuses"]): string {
  const cols = statuses ?? [];
  return i.column_id ?? cols.find((c) => c.stage === i.status)?.id ?? cols[0]?.id ?? "";
}

/** Move an issue to a board column. Optimistic across every cached board of the project. */
export function useMoveToColumn(project: string) {
  const ws = useWs();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, column }: { key: string; column: string }) => mahaam.issues.toColumn(key, column),
    onMutate: async ({ key, column }) => {
      const prefix = ["issues", ws, "board", project];
      await qc.cancelQueries({ queryKey: prefix });
      const prev = qc.getQueriesData<IssueRow[]>({ queryKey: prefix });
      qc.setQueriesData<IssueRow[]>({ queryKey: prefix }, (list) => list?.map((i) => (i.key === key ? { ...i, column_id: column } : i)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev.forEach(([k, v]) => qc.setQueryData(k, v)),
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: ["issues", ws] });
      void qc.invalidateQueries({ queryKey: qk.issue(ws, v.key) });
      void qc.invalidateQueries({ queryKey: ["projects", ws] });
      void qc.invalidateQueries({ queryKey: qk.project(ws, project) });
      void qc.invalidateQueries({ queryKey: qk.report(ws, project) });
    },
  });
}
