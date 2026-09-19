-- Hand-written Postgres DDL (README note 1). FKs/indexes in post/18c_kpi_constraints.sql, RLS in
-- post/29a_rls_kpi.sql.
--
-- user_github_accounts: which GitHub account is which workspace member, so github_events
-- (commits, PRs, deployments from the GitHub App webhook) can be attributed to a person for
-- the employee KPI. Attribution is computed at query time by matching github_events.author_login
-- (case-insensitive) or author_email against login / emails — no event row is rewritten, so
-- connecting an account "backfills" every event already logged.
--   connected_via  oauth  — the member connected it themselves (GitHub App user authorization);
--                           emails are GitHub's VERIFIED addresses, token_sealed their user token
--                  manual — a manager mapped the member to a login + emails
CREATE TABLE IF NOT EXISTS user_github_accounts (
    id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id  text NOT NULL,
    user_id       text NOT NULL,
    login         text NOT NULL CHECK (login ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'),
    github_id     bigint,
    emails        text[] NOT NULL DEFAULT '{}',
    connected_via text NOT NULL CHECK (connected_via IN ('oauth', 'manual')),
    token_sealed  text,
    connected_by  text NOT NULL,
    connected_at  timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
);
