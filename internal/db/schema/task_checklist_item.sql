-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, uniques, indexes and RLS live in internal/db/post (11_p1_constraints.sql, 21_rls_p1.sql).
CREATE TABLE IF NOT EXISTS task_checklist_items (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    task_id      text NOT NULL,
    title        text NOT NULL CHECK (length(btrim(title)) > 0),
    done         boolean NOT NULL DEFAULT false,
    position     double precision NOT NULL,
    done_at      timestamptz,
    done_by      text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
