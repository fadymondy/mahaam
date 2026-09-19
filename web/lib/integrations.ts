"use client"

// Contract types (mirror internal/integrations JSON) and SWR hooks for the project integrations
// and GitHub endpoints under /api/w/projects/{project}/…
import useSWR from "swr"

import { api } from "@/lib/api"

export const PROVIDERS = ["github", "jira", "linear"] as const
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

const opts = { shouldRetryOnError: false, revalidateOnFocus: false }

export function useIntegrations(ws: string, project: string, enabled = true) {
  return useSWR<{ integrations: Integration[] | null }>(enabled ? [`/api/w/projects/${project}/integrations`, ws] : null, ([p, id]: [string, string]) => api<{ integrations: Integration[] | null }>(p, { workspaceId: id }), opts)
}

/** GET …/github/<what>; null key disables the request. */
export function useGitHub<T>(ws: string, project: string, what: string | null) {
  return useSWR<T>(what ? [`/api/w/projects/${project}/github/${what}`, ws] : null, ([p, id]: [string, string]) => api<T>(p, { workspaceId: id }), opts)
}
