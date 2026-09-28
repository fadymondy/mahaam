// API methods owned by the project GitHub, vault and billing tabs. Spread into makeApi (api.ts); the keys join the IPC allowlist.
// Shapes mirror internal/integrations (github.go, routes.go), internal/work/vault.go and internal/work/billing_sources.go.
import type { MahaamClient } from "@mahaam/client";

const e = encodeURIComponent;

// ── GitHub ──
export interface Integration {
  id: string;
  project_id: string;
  provider: "github" | "jira" | "linear";
  status: "pending" | "active" | "error" | "disabled";
  config: Record<string, string | undefined>;
  has_secret: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
export interface GhCommit { sha: string; message: string; author_name: string; author_email: string; author_login: string; date: string; url: string }
export interface GhPull { number: number; title: string; state: string; draft: boolean; author: string; head: string; base: string; url: string; created_at: string; updated_at: string; merged_at: string | null }
export interface GhRun { id: number; name: string; branch: string; event: string; status: string; conclusion: string; sha: string; actor: string; url: string; created_at: string }
export interface GhDeployment { id: number; environment: string; ref: string; sha: string; creator: string; state: string; url: string; created_at: string }
export interface GhWorkflow { id: number; name: string; path: string; state: string; url: string }
export interface DeployInput { workflow: string; ref?: string; inputs?: Record<string, string> }

// ── Vault ──
export type VaultKind = "memory" | "secret";
export interface VaultItem {
  id: string;
  project_id: string;
  kind: VaultKind;
  title: string;
  body: string;
  tags: string[] | null;
  has_value: boolean;
  value?: string;
  created_by: string | null;
  updated_by: string | null;
  last_revealed_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface VaultInput { kind?: VaultKind; title?: string; body?: string; tags?: string[]; value?: string }

// ── Billing ──
export interface AIUsageRow {
  key: string;
  project_id?: string;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  requests: number;
  cost_minor: number;
  billed_minor: number;
  unbilled_cost_minor: number;
  currency: string;
}
export const SUB_CATEGORIES = ["infrastructure", "ai", "marketing", "software", "domain", "support", "other"] as const;
export const SUB_INTERVALS = ["month", "quarter", "year", "one_time"] as const;
export interface Subscription {
  id: string;
  project_id: string;
  project_name: string;
  name: string;
  category: (typeof SUB_CATEGORIES)[number];
  vendor: string | null;
  price_minor: number;
  cost_minor: number;
  currency: string;
  interval: (typeof SUB_INTERVALS)[number];
  starts_on: string;
  ends_on: string | null;
  billable: boolean;
  active: boolean;
  notes: string | null;
  billed_until: string | null;
  next_period: string | null;
}
export interface SubscriptionInput {
  name?: string;
  category?: string;
  vendor?: string;
  price?: string;
  cost?: string;
  currency?: string;
  interval?: string;
  starts_on?: string;
  ends_on?: string;
  billable?: boolean;
  active?: boolean;
  notes?: string;
}

export function projectMoneyApi(c: MahaamClient) {
  const get = <T>(path: string, query?: Record<string, string | number | boolean | undefined>) => c.request<T>("GET", path, { query });
  const send = <T>(method: string, path: string, body?: unknown) => c.request<T>(method, path, { body: body ?? {} });
  const gh = <T>(project: string, what: string, query?: Record<string, string | undefined>) => get<T>(`/api/w/projects/${e(project)}/github/${what}`, query);

  return {
    // GitHub (internal/integrations/routes.go)
    projectIntegrations: async (project: string) =>
      (await get<{ integrations: Integration[] | null }>(`/api/w/projects/${e(project)}/integrations`)).integrations ?? [],
    githubCommits: async (project: string, branch?: string) => (await gh<{ commits: GhCommit[] | null }>(project, "commits", { branch: branch || undefined })).commits ?? [],
    githubPulls: async (project: string) => (await gh<{ pulls: GhPull[] | null }>(project, "pulls", { state: "all" })).pulls ?? [],
    githubRuns: async (project: string) => (await gh<{ runs: GhRun[] | null }>(project, "runs")).runs ?? [],
    githubDeployments: async (project: string) => (await gh<{ deployments: GhDeployment[] | null }>(project, "deployments")).deployments ?? [],
    githubWorkflows: async (project: string) => (await gh<{ workflows: GhWorkflow[] | null }>(project, "workflows")).workflows ?? [],
    // With no GitHub row the API falls back to the workspace's existing App installation.
    githubRepos: async (project: string) =>
      (await get<{ repos: { full_name: string; private: boolean }[] | null }>(`/api/w/projects/${e(project)}/integrations/github/repos`)).repos ?? [],
    githubLinkRepo: (project: string, repo: string) => send<Integration>("PUT", `/api/w/projects/${e(project)}/integrations/github/repo`, { repo }),
    githubDeploy: (project: string, input: DeployInput) => send<void>("POST", `/api/w/projects/${e(project)}/github/deploy`, input),

    // Vault (internal/work/routes_portal.go, vault())
    vaultList: async (project: string, q: { kind?: VaultKind; q?: string } = {}) =>
      (await get<{ items: VaultItem[] | null }>(`/api/w/projects/${e(project)}/vault`, { kind: q.kind, q: q.q || undefined })).items ?? [],
    vaultCreate: (project: string, input: VaultInput) => send<VaultItem>("POST", `/api/w/projects/${e(project)}/vault`, input),
    vaultUpdate: (id: string, input: VaultInput) => send<VaultItem>("PATCH", `/api/w/vault/${e(id)}`, input),
    vaultDelete: (id: string) => c.request<void>("DELETE", `/api/w/vault/${e(id)}`),
    vaultReveal: (id: string) => send<VaultItem>("POST", `/api/w/vault/${e(id)}/reveal`),

    // Billing (internal/work/routes_billing.go)
    aiUsage: async (project: string, groupBy: "day" | "model") =>
      (await get<{ rows: AIUsageRow[] | null }>("/api/w/ai-usage", { project, group_by: groupBy })).rows ?? [],
    aiMarkup: (project: string) => get<{ ai_markup_bp: number }>(`/api/w/projects/${e(project)}/ai-markup`),
    setAiMarkup: (project: string, percent: string) => send<{ ai_markup_bp: number }>("PUT", `/api/w/projects/${e(project)}/ai-markup`, { percent }),
    subscriptions: async (project: string) =>
      (await get<{ subscriptions: Subscription[] | null }>("/api/w/subscriptions", { project })).subscriptions ?? [],
    createSubscription: (project: string, input: SubscriptionInput) => send<Subscription>("POST", `/api/w/projects/${e(project)}/subscriptions`, input),
    updateSubscription: (id: string, input: SubscriptionInput) => send<Subscription>("PATCH", `/api/w/subscriptions/${e(id)}`, input),
    deleteSubscription: (id: string) => c.request<void>("DELETE", `/api/w/subscriptions/${e(id)}`),
  };
}
