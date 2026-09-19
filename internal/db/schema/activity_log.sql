-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, uniques, indexes and RLS live in internal/db/post (11_p1_constraints.sql, 21_rls_p1.sql).
-- The activity feed / audit trail. Mahaam writes it itself, inside the transaction of the change
-- (internal/work/activity.go), with the actor taken from the session or the MCP token and never
-- from a header: togo's audit plugin takes the causer from X-User-Id, which any client can set.
-- Append-only for the app role (RLS: no UPDATE/DELETE policy).
CREATE TABLE IF NOT EXISTS activity_logs (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    project_id   text,
    task_id      text,
    actor_id     text NOT NULL,
    actor_via    text NOT NULL CHECK (actor_via IN ('session','mcp','system')),
    action       text NOT NULL,
    subject_type text NOT NULL,
    subject_id   text NOT NULL,
    changes      text NOT NULL DEFAULT '{}',
    ip           text NOT NULL DEFAULT '',
    user_agent   text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
