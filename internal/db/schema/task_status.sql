-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, uniques, indexes and RLS live in internal/db/post (11_p1_constraints.sql, 21_rls_p1.sql).
-- Kanban columns, per project. category: todo | doing | done (drives completed_at).
CREATE TABLE IF NOT EXISTS task_statuses (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    project_id   text NOT NULL,
    name         text NOT NULL CHECK (length(btrim(name)) > 0),
    color        text NOT NULL DEFAULT 'slate' CHECK (color ~ '^[a-z]+$'),
    category     text NOT NULL CHECK (category IN ('todo','doing','done')),
    position     double precision NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
