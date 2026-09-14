-- Hand-written Postgres DDL (togo 0.2.31 make:resource emits SQLite; README note 1).
-- FKs, uniques, indexes and RLS live in internal/db/post (11_p1_constraints.sql, 21_rls_p1.sql).
-- Files live in togo storage at storage_path (attachments/<workspace>/<id>); only ever served
-- through the authorised download endpoint, never by path.
CREATE TABLE IF NOT EXISTS attachments (
    id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workspace_id text NOT NULL,
    task_id      text NOT NULL,
    file_name    text NOT NULL,
    content_type text NOT NULL,
    size         bigint NOT NULL CHECK (size >= 0),
    storage_path text NOT NULL,
    uploaded_by  text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
