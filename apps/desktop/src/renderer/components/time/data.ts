// Server state for the Time view: the week (timesheet) and the writes to it. Every write refreshes
// everything under "time" — the live stream does the same for changes made elsewhere (the web, the
// menu bar, another device), so the view is current either way.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { EntryPatch, LogInput, StartInput, TimeEntry } from "../../../shared/types";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { qk } from "@/lib/query";

export function useTimesheet(week?: string) {
  const { ws } = useApp();
  return useQuery({
    queryKey: qk.timesheet(ws, week),
    queryFn: () => api.timesheet(week),
    enabled: !!ws,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useRefreshTime() {
  const { ws } = useApp();
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["w", ws, "time"] });
}

export function useTimeWrites() {
  const refresh = useRefreshTime();
  const opts = { onSettled: () => void refresh() };
  return {
    update: useMutation({ mutationFn: ({ id, patch }: { id: string; patch: EntryPatch }) => api.updateEntry(id, patch), ...opts }),
    remove: useMutation({ mutationFn: (id: string) => api.deleteEntry(id), ...opts }),
    log: useMutation({ mutationFn: (input: LogInput) => api.logTime(input), ...opts }),
    start: useMutation({ mutationFn: (input: StartInput) => api.start(input), ...opts }),
    stop: useMutation({ mutationFn: () => api.stop(), ...opts }),
  };
}

/** Start a new timer on what an entry was about ("continue"). */
export const continueInput = (e: TimeEntry): StartInput => ({
  ...(e.task_id ? { task: e.task_id } : e.project_id ? { project: e.project_id } : {}),
  ...(e.description ? { description: e.description } : {}),
  billable: e.billable,
});
