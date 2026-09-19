// Client-portal data. The richer portal endpoints are feature-detected (null = not on this server):
// the projects list falls back to /api/w/projects (a customer sees only their projects there) with
// progress computed from task counts.
import { useQuery } from "@tanstack/react-query";

import type { PortalProject, Project } from "@/api/types";
import { useWs } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { mahaam } from "@/lib/session";

export function percentDone(t: { todo: number; doing: number; done: number }): number {
  const total = t.todo + t.doing + t.done;
  return total ? Math.round((t.done / total) * 100) : 0;
}

export function fromProject(p: Project): PortalProject {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    status: p.status,
    description: null,
    client_name: p.client_name,
    archived: !!p.archived_at,
    tasks: p.tasks,
    percent_done: percentDone(p.tasks),
    budget_minutes: null,
    used_minutes: 0,
    open_issues: 0,
    pending_requests: 0,
    starts_on: null,
    ends_on: null,
  };
}

export function usePortalProjects() {
  const ws = useWs();
  return useQuery({
    queryKey: qk.portalProjects(ws),
    enabled: !!ws,
    queryFn: async (): Promise<{ projects: PortalProject[]; rich: boolean }> => {
      const rich = await mahaam.portal.projects();
      if (rich) return { projects: rich.projects ?? [], rich: true };
      const plain = (await mahaam.projects.list()).projects ?? [];
      return { projects: plain.map(fromProject), rich: false };
    },
  });
}

export function usePortalProject(id: string) {
  const ws = useWs();
  return useQuery({ queryKey: qk.portalProject(ws, id), queryFn: () => mahaam.portal.project(id), enabled: !!ws && !!id });
}

export function usePortalIssues(project?: string, enabled = true) {
  const ws = useWs();
  return useQuery({
    queryKey: qk.portalIssues(ws, project),
    queryFn: async () => (await mahaam.portal.issues(project)).issues ?? [],
    enabled: !!ws && enabled,
  });
}

export function useInvoices() {
  const ws = useWs();
  return useQuery({ queryKey: qk.invoices(ws), queryFn: async () => (await mahaam.portal.invoices()).invoices ?? [], enabled: !!ws });
}
