-- MCP OAuth (internal/mcp/oauth.go): lets a remote connector (Claude.ai, ChatGPT, ...) "Connect"
-- with just the server URL and its own sign-in screen, instead of a user pasting a token. The
-- flow's only job is to get consent and mint a normal mcp_tokens row — everything after that
-- (auth, scope narrowing, project scoping, rate limits) is the code every other MCP token runs
-- through. Platform data (not tenant-scoped): owner pool only, no RLS, no app-role grant.

-- Dynamically registered clients (RFC 7591). Public clients only — no secret; PKCE (S256) is
-- mandatory on every authorization, so a stolen client_id alone is useless.
CREATE TABLE IF NOT EXISTS oauth_clients (
    id            text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    client_id     text        NOT NULL UNIQUE,
    client_name   text        NOT NULL DEFAULT '',
    redirect_uris jsonb       NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- One authorization code per consent: single-use, ~2 minutes, hashed like mcp_tokens (never
-- stored in the clear).
CREATE TABLE IF NOT EXISTS oauth_codes (
    code_hash      text        PRIMARY KEY,
    client_id      text        NOT NULL,
    redirect_uri   text        NOT NULL,
    code_challenge text        NOT NULL,
    workspace_id   text        NOT NULL,
    user_id        text        NOT NULL,
    scopes         text        NOT NULL,
    project_ids    text        NOT NULL DEFAULT '[]',
    expires_at     timestamptz NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- One refresh grant per issued connection, rotated on every use; mcp_token_id is the access
-- token currently live under it, revoked and replaced on rotation.
CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
    token_hash   text        PRIMARY KEY,
    client_id    text        NOT NULL,
    workspace_id text        NOT NULL,
    user_id      text        NOT NULL,
    scopes       text        NOT NULL,
    project_ids  text        NOT NULL DEFAULT '[]',
    mcp_token_id text,
    revoked_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz
);
