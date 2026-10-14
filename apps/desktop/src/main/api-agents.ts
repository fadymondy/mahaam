// API methods owned by the agents feature. Spread into makeApi (api.ts); the keys join the IPC allowlist.
//
// Contract: internal/mcp/tokens.go (/api/w/mcp_tokens) and internal/mcp/oauth.go (the RFC 9728
// metadata at /.well-known/oauth-protected-resource, which names the public MCP endpoint — MCP_URL,
// else APP_URL — so the URL shown is the one remote connectors will discover).
import type { MahaamClient } from "@mahaam/client";

export interface McpToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[] | null;
  project_ids: string[] | null;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface McpScope {
  scope: string;
  description: string;
  min_role: string;
  allowed: boolean;
}

export interface McpTokenList {
  tokens: McpToken[];
  scopes: McpScope[];
}

export interface McpTokenInput {
  name: string;
  scopes: string[];
  /** Project ids; omit for every project the person can see. */
  projects?: string[];
  /** 1–365; omit for no expiry. */
  expires_in_days?: number;
}

export interface McpTokenCreated {
  token: McpToken;
  plaintext: string;
}

export interface McpServerInfo {
  /** The MCP endpoint, e.g. https://mcp.mahaam.app/api/mcp. */
  url: string;
  /** The server advertises OAuth (remote connectors can sign in without a token). */
  oauth: boolean;
}

export function agentsApi(c: MahaamClient) {
  return {
    mcpTokens: async (): Promise<McpTokenList> => {
      const r = await c.request<{ tokens: McpToken[] | null; scopes: McpScope[] | null }>("GET", "/api/w/mcp_tokens");
      return { tokens: r.tokens ?? [], scopes: r.scopes ?? [] };
    },
    createMcpToken: (input: McpTokenInput) => c.request<McpTokenCreated>("POST", "/api/w/mcp_tokens", { body: input }),
    revokeMcpToken: (id: string) => c.request<void>("DELETE", `/api/w/mcp_tokens/${encodeURIComponent(id)}`),
    mcpServer: async (): Promise<McpServerInfo> => {
      const fallback = `${c.baseUrl}/api/mcp`;
      try {
        const res = await fetch(`${c.baseUrl}/.well-known/oauth-protected-resource`, { cache: "no-store" });
        if (!res.ok) return { url: fallback, oauth: false };
        const d = (await res.json()) as { resource?: string; authorization_servers?: string[] };
        const url = d.resource && /^https?:\/\//.test(d.resource) ? d.resource : fallback;
        return { url, oauth: !!d.authorization_servers?.length };
      } catch {
        return { url: fallback, oauth: false };
      }
    },
  };
}
