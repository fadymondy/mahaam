// API methods owned by the team feature. Spread into makeApi (api.ts); the keys join the IPC allowlist.
// Invitations: internal/workspaces/workspaces.go. Teams: internal/work/routes.go + teams.go.
import type { MahaamClient } from "@mahaam/client";

const e = encodeURIComponent;

export type InviteRole = "admin" | "manager" | "member" | "client";

export interface Invitation {
  id: string;
  email: string;
  role: InviteRole;
  expires_at: string;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  color: string;
  member_ids: string[] | null;
  project_count: number;
  created_at: string;
}

export interface TeamInput {
  name?: string;
  description?: string;
  color?: string;
  member_ids?: string[];
}

export function teamApi(c: MahaamClient) {
  const get = <T>(path: string) => c.request<T>("GET", path);
  const send = <T>(method: string, path: string, body?: unknown) => c.request<T>(method, path, { body: body ?? {} });
  return {
    // ── invitations (owners and admins) ──
    invitations: async () => (await get<{ invitations: Invitation[] | null }>("/api/w/invitations")).invitations ?? [],
    invite: (email: string, role: InviteRole) =>
      send<{ invitation: Invitation; accept_url: string }>("POST", "/api/w/invitations", { email, role }),
    revokeInvitation: (id: string) => c.request<void>("DELETE", `/api/w/invitations/${e(id)}`),

    // ── teams ──
    teams: async () => (await get<{ teams: Team[] | null }>("/api/w/teams")).teams ?? [],
    createTeam: (input: TeamInput) => send<Team>("POST", "/api/w/teams", input),
    updateTeam: (id: string, input: TeamInput) => send<Team>("PATCH", `/api/w/teams/${e(id)}`, input),
    deleteTeam: (id: string) => c.request<void>("DELETE", `/api/w/teams/${e(id)}`),
  };
}
