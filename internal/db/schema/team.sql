-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, uniques, indexes and RLS live in internal/db/post (11_p1_constraints.sql, 21_rls_p1.sql).
CREATE TABLE IF NOT EXISTS teams (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    name         text NOT NULL CHECK (length(btrim(name)) > 0),
    description  text,
    color        text NOT NULL DEFAULT 'teal' CHECK (color ~ '^[a-z]+$'),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
