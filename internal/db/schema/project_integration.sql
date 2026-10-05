-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, uniques, indexes and RLS live in internal/db/post (16_integrations_constraints.sql,
-- 26_rls_integrations.sql). Not exposed through generated CRUD (authz.Generated: None) —
-- every read and write goes through /api/w/projects/{project}/integrations* (internal/integrations).
--
-- project_integrations: one external system connected to one project.
--   provider  github | jira | linear | hosbah (one of each per project)
--   status    pending (GitHub installed, no repo picked yet) | active | error | disabled
--   config    NON-secret settings only: GitHub {installation_id, repo, default_branch},
--             Jira {base_url, email, project_key, jql}, Linear {team_id},
--             Hosbah {base_url, app_id, app_name, app_title, server_id, server_name, panel_url,
--             app_status, domains}
--   secret    the provider credential (Jira API token, Linear API key, Hosbah app token) SEALED with
--             internal/secretbox (AES-256-GCM, MAHAAM_SECRET_KEY). Never returned by the API.
--             GitHub stores none: installation tokens are minted from the App key per call.
CREATE TABLE IF NOT EXISTS project_integrations (
    id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id   text NOT NULL,
    project_id     text NOT NULL,
    provider       text NOT NULL CHECK (provider IN ('github', 'jira', 'linear', 'hosbah')),
    status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'error', 'disabled')),
    config         jsonb NOT NULL DEFAULT '{}'::jsonb,
    secret         text,
    last_synced_at timestamptz,
    last_error     text,
    created_by     text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
