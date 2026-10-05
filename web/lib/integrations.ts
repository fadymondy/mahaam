"use client"

// Contract types (mirror internal/integrations JSON) and SWR hooks for the project integrations
// and GitHub endpoints under /api/w/projects/{project}/…
import useSWR from "swr"

import { api } from "@/lib/api"

export const PROVIDERS = ["github", "jira", "linear", "hosbah"] as const
export type Provider = (typeof PROVIDERS)[number]

export type Integration = {
  id: string
  project_id: string
  provider: Provider
  status: "pending" | "active" | "error" | "disabled"
  config: Record<string, string | undefined>
  has_secret: boolean
  last_synced_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type SyncResult = { provider: Provider; fetched: number; created: number; updated: number; mirrored: number }
export type Repo = { full_name: string; private: boolean; default_branch: string; html_url: string }
export type Commit = { sha: string; message: string; author_name: string; author_email: string; author_login: string; date: string; url: string }
export type Pull = { number: number; title: string; state: string; draft: boolean; author: string; head: string; base: string; url: string; created_at: string; updated_at: string; merged_at: string | null }
export type Run = { id: number; name: string; branch: string; event: string; status: string; conclusion: string; sha: string; actor: string; url: string; created_at: string }
export type Deployment = { id: number; environment: string; ref: string; sha: string; creator: string; state: string; url: string; created_at: string }
export type Workflow = { id: number; name: string; path: string; state: string; url: string }

// Hosbah hosting (internal/integrations/hosbah.go): the one app a project is linked to.
export type HosbahApp = {
  id: string
  name: string
  title?: string | null
  status: "new" | "deploying" | "running" | "failed" | "stopped" | string
  server_id: string
  server_name?: string
  domains: string[] | null
  logo_url?: string | null
  panel_url?: string
}
export type HosbahDeployment = {
  id: string
  number: number
  kind: string
  status: string
  ref?: string
  commit?: string
  message?: string
  queued_at: string
  finished_at?: string | null
}
export type Hosting = { app: HosbahApp; deployments: HosbahDeployment[] | null }
export type PortalHosting = { connected: boolean; name?: string; status?: string; domains: string[] | null; can_open: boolean }
export type PanelLink = { url: string; expires_at?: string | null }

const opts = { shouldRetryOnError: false, revalidateOnFocus: false }

export function useIntegrations(ws: string, project: string, enabled = true) {
  return useSWR<{ integrations: Integration[] | null }>(enabled ? [`/api/w/projects/${project}/integrations`, ws] : null, ([p, id]: [string, string]) => api<{ integrations: Integration[] | null }>(p, { workspaceId: id }), opts)
}

/** GET …/github/<what>; null key disables the request. */
export function useGitHub<T>(ws: string, project: string, what: string | null) {
  return useSWR<T>(what ? [`/api/w/projects/${project}/github/${what}`, ws] : null, ([p, id]: [string, string]) => api<T>(p, { workspaceId: id }), opts)
}

/** GET …/hosting (members+); null project disables the request. */
export function useHosting(ws: string, project: string | null) {
  return useSWR<Hosting>(project ? [`/api/w/projects/${project}/hosting`, ws] : null, ([p, id]: [string, string]) => api<Hosting>(p, { workspaceId: id }), opts)
}

/** The customer's view of the project's hosting (portal). */
export function usePortalHosting(ws: string, project: string | null) {
  return useSWR<PortalHosting>(project ? [`/api/w/portal/projects/${encodeURIComponent(project)}/hosting`, ws] : null, ([p, id]: [string, string]) => api<PortalHosting>(p, { workspaceId: id }), opts)
}

/** A one-time auto-login link into the app's hosting panel. */
export const openHostingPanel = (ws: string, project: string, locale: string) =>
  api<PanelLink>(`/api/w/portal/projects/${encodeURIComponent(project)}/hosting/panel`, { method: "POST", json: { locale }, workspaceId: ws })

/** "running" → success, "failed" → danger, deploying → warning, else neutral. */
export function hostingVariant(status?: string) {
  return status === "running" ? "success" : status === "failed" ? "danger" : status === "deploying" ? "warning" : "neutral"
}

/** A Hosbah app status in the reader's language; a status Mahaam has no word for shows as Hosbah sent it. */
export function hostingStatus(t: (key: string) => string, status?: string) {
  if (!status) return "—"
  const key = `hosting.status.${status}`
  const s = t(key)
  return s === key ? status : s
}
