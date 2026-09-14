-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, uniques, indexes and RLS live in internal/db/post (11_p1_constraints.sql, 21_rls_p1.sql).
-- author_kind: user | agent (an MCP token acting for author_id). mentions: JSON array of user ids.
CREATE TABLE IF NOT EXISTS task_comments (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    task_id      text NOT NULL,
    author_id    text NOT NULL,
    author_kind  text NOT NULL DEFAULT 'user' CHECK (author_kind IN ('user','agent')),
    body         text NOT NULL CHECK (length(btrim(body)) > 0),
    mentions     text,
    edited_at    timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
