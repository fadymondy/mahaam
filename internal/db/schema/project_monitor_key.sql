-- Per-project DSN keys for the backend error-monitoring SDKs (sdk/go, sdk/node, sdk/laravel,
-- sdk/python) — Sentry-shaped: https://<public_key>@mcp.mahaam.app/monitor/<project_id>. Server-to-
-- server only (unlike project_feedback_keys, no allowed_origins/CORS — nothing here is ever meant
-- to reach a browser), so it is deliberately low-power the same way: it can only file into the
-- one project it belongs to, and it is revocable. Stored in the clear (it is meant to sit in a
-- config file/env var, not a session secret).
CREATE TABLE IF NOT EXISTS project_monitor_keys (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    project_id   text NOT NULL,
    name         text NOT NULL DEFAULT '',
    public_key   text NOT NULL,
    created_by   text,
    last_used_at timestamptz,
    revoked_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (public_key)
);
