-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, uniques, indexes and RLS live in internal/db/post (11_p1_constraints.sql, 21_rls_p1.sql).
-- number/key: MG-<n>, allocated per workspace from key_counters (shared with reports).
-- position: fractional order inside the status column.
CREATE TABLE IF NOT EXISTS tasks (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    project_id       text NOT NULL,
    status_id        text NOT NULL,
    number           bigint NOT NULL,
    key              text NOT NULL,
    title            text NOT NULL CHECK (length(btrim(title)) > 0),
    description      text,
    position         double precision NOT NULL,
    due_at           timestamptz,
    estimate_minutes bigint CHECK (estimate_minutes IS NULL OR estimate_minutes >= 0),
    priority         text NOT NULL DEFAULT 'none' CHECK (priority IN ('none','low','medium','high','urgent')),
    parent_id        text CHECK (parent_id IS NULL OR parent_id <> id),
    created_by       text NOT NULL,
    completed_at     timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
