-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, indexes and RLS live in internal/db/post (17_vault_constraints.sql, 27_rls_vault.sql).
--
-- A project's vault: its SECRETS (credentials, keys — sealed with internal/secretbox,
-- never returned by a list, revealed one at a time and every reveal recorded in the
-- activity feed) and its MEMORY (plain notes about the project — decisions, access
-- paths, conventions — searchable, so a person or an agent can recall them, like a
-- cabrain namespace per project).
CREATE TABLE IF NOT EXISTS project_vault_items (
    id               text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id     text NOT NULL,
    project_id       text NOT NULL,
    kind             text NOT NULL CHECK (kind IN ('secret', 'memory')),
    title            text NOT NULL,
    -- secret: sealed value (v<id>:…); memory: NULL
    sealed_value     text,
    -- secret: a non-secret hint (username, URL, env var name); memory: the note (markdown)
    body             text NOT NULL DEFAULT '',
    tags             text[] NOT NULL DEFAULT '{}',
    created_by       text,
    updated_by       text,
    last_revealed_at timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind = 'secret') = (sealed_value IS NOT NULL))
);
