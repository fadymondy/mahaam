-- Hand-written Postgres DDL (togo make:resource emits SQLite; README note 1).
-- A project's catalogue of agents and skills: feeds the issue Agent/Skill pickers and the
-- @-mention list. Rows come from the UI, from MCP, or from a sync of a repo's .claude/ folder.
-- FK, unique name index and RLS live in internal/db/post (19h_project_catalogue.sql, 29b_rls_catalogue.sql).
CREATE TABLE IF NOT EXISTS project_catalogue (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    project_id   text NOT NULL,
    kind         text NOT NULL CHECK (kind IN ('agent', 'skill')),
    name         text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 100
                                      AND name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
    description  text NOT NULL DEFAULT '',
    source       text NOT NULL DEFAULT 'ui' CHECK (source IN ('ui', 'mcp', 'sync')),
    created_by   text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
